'use strict';

/**
 * Megaladon — Microsoft Teams Connection (Bot Framework)
 *
 * Requires an Azure Bot registration (Multi-Tenant or Single-Tenant) with:
 *   - Microsoft App ID
 *   - Microsoft App Password (client secret)
 *   - Messaging endpoint set to  https://<your-host>/api/messages
 *
 * The bot must be sideloaded/installed into Teams (as a personal app,
 * or added to a team) before it can receive messages — see README.md.
 *
 * Mirrors connections/whatsapp/index.js structurally:
 *   - Message queue serialises processing so a long agent task never
 *     races with a second inbound message.
 *   - Policy gate (open / allowlist / owner / pairing) controls who the
 *     bot will respond to.
 *   - Section-themed terminal logging via ./logger.js.
 *   - Two-phase AI bridge via ./aiHandler.js (plan, then execute visibly).
 */

const path = require('path');
const fs   = require('fs');
const os   = require('os');
const http = require('http');
const {
  CloudAdapter,
  ConfigurationBotFrameworkAuthentication,
  TeamsActivityHandler,
  MessageFactory,
  CardFactory,
} = require('botbuilder');

const { teamsGuard } = require('./teamsPolicy');
const { getAIResponse, executeWork } = require('./aiHandler');
const { log, colors } = require('./logger');

// ─── Config paths ─────────────────────────────────────────────────────────────
const CONNECTIONS_PATH = path.join(os.homedir(), '.meg', 'connections.json');

function loadConnections() {
  try { if (fs.existsSync(CONNECTIONS_PATH)) return JSON.parse(fs.readFileSync(CONNECTIONS_PATH, 'utf8')); } catch (_) {}
  return {};
}
function saveConnections(data) {
  try {
    fs.mkdirSync(path.dirname(CONNECTIONS_PATH), { recursive: true });
    fs.writeFileSync(CONNECTIONS_PATH, JSON.stringify(data, null, 2), 'utf8');
  } catch (_) {}
}

function loadTeamsConfig() {
  const data = loadConnections();
  return data.teams || {};
}
function saveTeamsConfig(patch) {
  const data = loadConnections();
  data.teams = { ...(data.teams || {}), ...patch };
  saveConnections(data);
  return data.teams;
}

// ─── Messages ─────────────────────────────────────────────────────────────────
const MSG_ONLINE  = '🦈 **Megaladon is online** — send me any message or terminal request and I\'ll get it done.';
const MSG_OFFLINE = '🎣 **Megaladon is shutting down.** I\'ll message you again when I\'m back online!';

// ─── Module-level state ───────────────────────────────────────────────────────
let _adapter      = null;
let _bot          = null;
let _server        = null;
let _ownerConvRef  = null;   // saved conversation reference, used for proactive owner messages
let _startupSent   = false;
let _isRunning      = false;

// ─── Message queue (serialised processing, same pattern as the WA connector) ─
const _msgQueue = [];
let   _msgBusy  = false;

function _enqueue(fn) {
  _msgQueue.push(fn);
  _drain();
}
async function _drain() {
  if (_msgBusy || !_msgQueue.length) return;
  _msgBusy = true;
  while (_msgQueue.length) {
    const task = _msgQueue.shift();
    try { await task(); } catch (e) { log.error('Teams queue task error: ' + e.message); }
  }
  _msgBusy = false;
}

// ─── Teams activity handler ────────────────────────────────────────────────────
class MegaladonTeamsBot extends TeamsActivityHandler {
  constructor() {
    super();

    this.onMessage(async (context, next) => {
      _enqueue(() => this._processMessage(context));
      await next();
    });

    this.onMembersAdded(async (context, next) => {
      const added = context.activity.membersAdded || [];
      const botId = context.activity.recipient.id;
      for (const member of added) {
        if (member.id === botId) {
          await context.sendActivity(MessageFactory.text(MSG_ONLINE));
        }
      }
      await next();
    });
  }

  async _processMessage(context) {
    const activity = context.activity;
    const text      = (activity.text || '').trim();
    if (!text) return;

    const userId    = activity.from?.aadObjectId || activity.from?.id || 'unknown';
    const userEmail = activity.from?.userPrincipalName || activity.from?.email || '';
    const userName  = activity.from?.name || 'unknown';

    // Save a conversation reference the first time we see the owner, so the
    // terminal side can send proactive messages (farewell, work-done pings).
    const cfg = loadTeamsConfig();
    if (!cfg.ownerId || cfg.ownerId === userId) {
      const { TurnContext } = require('botbuilder');
      _ownerConvRef = TurnContext.getConversationReference(activity);
      if (!cfg.ownerId) saveTeamsConfig({ ownerId: userId, ownerName: userName });
    }

    const policy    = cfg.dmPolicy   || 'owner';
    const allowFrom = cfg.allowFrom  || (cfg.ownerId ? [cfg.ownerId] : []);

    const allowed = await teamsGuard({
      userId, userEmail, text, policy, allowFrom,
      sendReply: async (msg) => { await context.sendActivity(MessageFactory.text(msg)); },
    });
    if (!allowed) return;

    log.incoming(userName, text);

    try {
      await context.sendActivity({ type: 'typing' });

      const { reply, directives, workType } = await getAIResponse(text, userId);

      log.outgoing(userName, reply);
      log.closeSection(workType);

      await context.sendActivity(MessageFactory.text(reply));

      if (workType === 'work' || workType === 'send') {
        const { summary, createdFiles } = await executeWork(directives, userId);

        if (summary.length > 0) {
          const doneText = '✅ **Done!**\n\n' + summary.join('\n');
          log.openSection();
          log.outgoing(userName, doneText);
          log.closeSection('chat');
          await context.sendActivity(MessageFactory.text(doneText));
        }

        for (const absPath of createdFiles) {
          try {
            await this._sendFileAttachment(context, absPath);
          } catch (ferr) {
            log.error(`Could not send file ${path.basename(absPath)}: ${ferr.message}`);
          }
        }
      }
    } catch (err) {
      log.error(`AI handler error: ${err.message}`);
      if (log.sectionOpen) log.closeSection('end');
      try { await context.sendActivity(MessageFactory.text('⚠️ Something went wrong. Try again in a moment.')); } catch (_) {}
    }
  }

  // Teams attachments need a publicly reachable URL or base64 content card —
  // for text-ish files we inline a code block; for binary files we describe
  // the file and point the user at where it lives on the host.
  async _sendFileAttachment(context, absPath) {
    const fileName = path.basename(absPath);
    const ext      = fileName.split('.').pop().toLowerCase();
    const textExts = ['js', 'ts', 'json', 'md', 'txt', 'html', 'css', 'py', 'yml', 'yaml'];

    if (textExts.includes(ext)) {
      const content = fs.readFileSync(absPath, 'utf8');
      const preview = content.length > 6000 ? content.slice(0, 6000) + '\n... (truncated)' : content;
      await context.sendActivity(MessageFactory.text('📄 **' + fileName + '**\n\n```' + ext + '\n' + preview + '\n```'));
    } else {
      const size = fs.statSync(absPath).size;
      await context.sendActivity(MessageFactory.text(
          '📄 **' + fileName + '** (' + (size / 1024).toFixed(1) + ' KB) was created on the host at:\n`' + absPath + '`'
      ));
    }
  }
}

// ─── Main ─────────────────────────────────────────────────────────────────────
async function startTeams(opts = {}) {
  if (_isRunning) {
    log.info('startTeams called but a server is already running — skipping duplicate start.');
    if (typeof opts.onConnected === 'function') opts.onConnected();
    return _server;
  }
  _isRunning = true;

  const { onConnected, onDisconnected, port } = opts;

  const appId       = process.env.TEAMS_APP_ID     || loadTeamsConfig().appId     || '';
  const appPassword = process.env.TEAMS_APP_PASSWORD || loadTeamsConfig().appPassword || '';
  const appType     = process.env.TEAMS_APP_TYPE   || loadTeamsConfig().appType   || 'MultiTenant';
  const listenPort  = port || parseInt(process.env.TEAMS_PORT || '3978', 10);

  if (!appId || !appPassword) {
    log.error('Missing Teams App ID / Password. Run /connection teams in Megaladon to configure, or set TEAMS_APP_ID / TEAMS_APP_PASSWORD.');
    _isRunning = false;
    if (typeof onDisconnected === 'function') onDisconnected('missingCredentials');
    return null;
  }

  log.openStartupBox('Teams startup');
  log.startupLine('info', 'Initialising Bot Framework adapter...');

  const botFrameworkAuth = new ConfigurationBotFrameworkAuthentication({
    MicrosoftAppId: appId,
    MicrosoftAppPassword: appPassword,
    MicrosoftAppType: appType,
  });
  _adapter = new CloudAdapter(botFrameworkAuth);

  _adapter.onTurnError = async (context, error) => {
    log.error('Adapter error: ' + error.message);
    try { await context.sendActivity('⚠️ The bot hit an internal error.'); } catch (_) {}
  };

  _bot = new MegaladonTeamsBot();

  _server = http.createServer(async (req, res) => {
    if (req.method === 'POST' && req.url === '/api/messages') {
      try {
        await _adapter.process(req, res, (context) => _bot.run(context));
      } catch (err) {
        log.error('Adapter process error: ' + err.message);
        if (!res.headersSent) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: err.message }));
        }
      }
      return;
    }
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not found');
  });

  return new Promise((resolve) => {
    _server.listen(listenPort, () => {
      log.startupLine('success', `Listening on port ${listenPort}  (messaging endpoint: /api/messages)`);
      log.startupLine('info', 'Expose this port publicly (e.g. via a reverse proxy or ngrok) and set it as the Azure Bot messaging endpoint.');
      log.closeStartupBox();
      saveTeamsConfig({ connected: true, connectedAt: new Date().toISOString(), appId });
      if (typeof onConnected === 'function') onConnected();
      resolve(_server);
    });
    _server.on('error', (err) => {
      log.error('Server error: ' + err.message);
      _isRunning = false;
      if (typeof onDisconnected === 'function') onDisconnected('serverError');
      resolve(null);
    });
  });
}

// ─── sendToOwner — proactive message from the terminal side ──────────────────
async function sendToOwner(text) {
  if (!_adapter || !_bot || !_ownerConvRef) return;
  try {
    await _adapter.continueConversationAsync(loadTeamsConfig().appId, _ownerConvRef, async (context) => {
      await context.sendActivity(MessageFactory.text(text));
    });
  } catch (err) {
    log.error('Could not send proactive message: ' + err.message);
  }
}

async function sendFarewellMessage() {
  await sendToOwner(MSG_OFFLINE);
}

function resetTeamsConfig() {
  const data = loadConnections();
  delete data.teams;
  saveConnections(data);
  _ownerConvRef = null;
  _startupSent  = false;
}

function stopTeams() {
  if (_server) { try { _server.close(); } catch (_) {} }
  _server = null; _adapter = null; _bot = null; _isRunning = false;
}

function getServer() { return _server; }

// ─── Standalone entry ─────────────────────────────────────────────────────────
if (require.main === module) {
  startTeams({}).catch(err => { console.error(err); process.exit(1); });
}

module.exports = {
  startTeams, stopTeams, sendToOwner, sendFarewellMessage,
  resetTeamsConfig, getServer,
  loadTeamsConfig, saveTeamsConfig,
};
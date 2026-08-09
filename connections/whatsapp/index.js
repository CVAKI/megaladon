'use strict';

// Suppress Baileys "Connection Closed" errors thrown during process exit
// (the WA socket tears down mid-flight when Node exits — this is expected)
process.on('unhandledRejection', (reason) => {
  if (reason && reason.output && reason.output.statusCode === 428) return; // Connection Closed
  if (reason && reason.message === 'Connection Closed') return;
  // Re-throw anything that isn't a WA teardown error
  console.error('Unhandled rejection:', reason);
});

const { dmGuard } = require('./dmPolicy');

/**
 * whyWhale — WhatsApp Connection (Baileys)
 *
 * FIXES & CHANGES in this version:
 *
 *  Fix 1 — Singleton guard reset for auto-reconnects (408/401/403).
 *  Fix 2 — Stdout filter suppresses noisy Baileys signal-protocol dumps.
 *  Fix 3 — Code 440 (session-replaced) auto-retries once after 15s.
 *  Fix 4 — Self-chat allowed through; _sentByBot set prevents reply loops.
 *  Fix 5 — Farewell message one-shot guard (_farewellSent flag).
 *
 *  NEW — Section theme display:
 *    · When WA is connected but idle, terminal shows normal PS1.
 *    · When a message arrives, the logger opens a ┌═══ section block.
 *    · Each message/reply is rendered as ┟══ lines inside the section.
 *    · When the AI decides to do work (file ops, shell commands),
 *      the section closes with @END-> going to terminal for work,
 *      and the terminal returns to its normal PS1 while work runs.
 *    · When the AI sends a file, section closes with @END->to sending.
 *    · If no work is triggered (pure chat), section closes @OnGoing->chatting.
 *    · A new section with an incremented number opens on the next message.
 */

const {
  makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
} = require('@whiskeysockets/baileys');
const { Boom }  = require('@hapi/boom');
const path      = require('path');
const fs        = require('fs');
const os        = require('os');
const pino      = require('pino');
const qrcode    = require('qrcode-terminal');

const { getAIResponse, executeWork } = require('./aiHandler');
const { log, colors }                = require('./logger');

// ─── Config ───────────────────────────────────────────────────────────────────
const AUTH_DIR         = path.join(os.homedir(), '.whyWhale', 'credentials', 'whatsapp');
const SESSION_ID       = 'session';
const CONNECTIONS_PATH = path.join(os.homedir(), '.whyWhale', 'connections.json');
const MAX_RETRIES      = 3;
const RETRY_440_MS     = 15_000;

// ─── Fix 2: Stdout filter ─────────────────────────────────────────────────────
(function installStdoutFilter() {
  const NOISE = [
    'Closing session:', 'Closing open session', 'SessionEntry',
    'Bad MAC', 'Failed to decrypt', 'registrationId:', 'currentRatchet:',
    'indexInfo:', '_chains:', 'chainKey:', 'chainType:', 'messageKeys:',
    'ephemeralKeyPair:', 'lastRemoteEphemeralKey:', 'previousCounter:',
    'rootKey:', 'baseKey:', 'baseKeyType:', 'remoteIdentityKey:',
  ];
  const _orig = process.stdout.write.bind(process.stdout);
  process.stdout.write = function (chunk, encodingOrCb, cb) {
    const s = Buffer.isBuffer(chunk) ? chunk.toString() : String(chunk);
    if (NOISE.some(n => s.includes(n))) {
      if (typeof encodingOrCb === 'function') encodingOrCb();
      else if (typeof cb === 'function') cb();
      return true;
    }
    return _orig(chunk, encodingOrCb, cb);
  };
})();

// ─── Session management ───────────────────────────────────────────────────────
function wipeSession() {
  const sessionPath = path.join(AUTH_DIR, SESSION_ID);
  try {
    if (fs.existsSync(sessionPath)) {
      fs.rmSync(sessionPath, { recursive: true, force: true });
      console.log('  \x1b[38;5;226m⚠ Session wiped — will require fresh QR scan.\x1b[0m');
    }
  } catch (e) {
    console.log('  \x1b[38;5;203m✘ Could not wipe session: ' + e.message + '\x1b[0m');
  }
}

function resetSession() {
  wipeSession();
  _activeSock = null; _startupSent = false; _ownerJid = null;
  _retryCount = 0; _isRunning = false; _farewellSent = false;
  _sentByBot.clear();
  try {
    if (fs.existsSync(CONNECTIONS_PATH)) {
      const data = JSON.parse(fs.readFileSync(CONNECTIONS_PATH, 'utf8'));
      if (data.whatsapp) {
        data.whatsapp.connected = false;
        fs.writeFileSync(CONNECTIONS_PATH, JSON.stringify(data, null, 2), 'utf8');
      }
    }
  } catch (_) {}
}

function loadOwnerNumber() {
  try {
    if (fs.existsSync(CONNECTIONS_PATH)) {
      const data = JSON.parse(fs.readFileSync(CONNECTIONS_PATH, 'utf8'));
      return (data.whatsapp?.ownerNumber || '').replace(/\D/g, '');
    }
  } catch (_) {}
  return '';
}

function toJid(number) {
  const clean = number.replace(/\D/g, '');
  return clean ? clean + '@s.whatsapp.net' : null;
}

// ─── Messages ─────────────────────────────────────────────────────────────────
const MSG_ONLINE  = '🐋 *whyWhale is swimming* 🌊\n\nI\'m online and ready!\nSend me any message or terminal command and I\'ll get it done.';
const MSG_OFFLINE = '🎣 *whyWhale is going to catch fish...* 🐟\n\nI\'m shutting down now. I\'ll message you again when I\'m back online!';

// ─── Module-level state ───────────────────────────────────────────────────────
let _activeSock   = null;
let _ownerJid     = null;
let _startupSent  = false;
let _retryCount   = 0;
let _isRunning    = false;
let _farewellSent = false;
const _sentByBot  = new Set();

// ─── Message queue ────────────────────────────────────────────────────────────
// Serialises all incoming WA messages so a long-running AI/agent task
// never races with a second inbound message (which caused the Boom
// "Connection Closed" crash when sendPresenceUpdate fired concurrently).
const _msgQueue = [];
let   _msgBusy  = false;

function _enqueueMsgTask(fn, sock, sender, queuedText) {
  _msgQueue.push(fn);
  // If the queue already had a task running, send a quick acknowledgement
  // so the user knows their message was received and is waiting its turn.
  if (_msgBusy && sender && sock && queuedText && !queuedText.startsWith('/') && !queuedText.startsWith('!')) {
    const pos = _msgQueue.length;
    const ack  = '⏳ Got it! I\'m finishing a previous task first — your message is queued (#' + pos + ').';
    sock.sendMessage(sender, { text: ack }).then(s => { if (s?.key?.id) _sentByBot.add(s.key.id); }).catch(() => {});
  }
  _drainMsgQueue();
}

async function _drainMsgQueue() {
  if (_msgBusy || !_msgQueue.length) return;
  _msgBusy = true;
  while (_msgQueue.length) {
    const task = _msgQueue.shift();
    try { await task(); } catch (e) { log.error('WA queue task error: ' + e.message); }
  }
  _msgBusy = false;
}

// ─── Farewell ─────────────────────────────────────────────────────────────────
async function sendFarewellMessage() {
  if (!_activeSock || !_ownerJid || _farewellSent) return;
  _farewellSent = true;
  try {
    await _activeSock.sendMessage(_ownerJid, { text: MSG_OFFLINE });
    log.info('Farewell message sent to owner.');
  } catch (err) {
    log.error('Could not send farewell: ' + err.message);
  }
}

// ─── Disconnect notice ────────────────────────────────────────────────────────
function printDisconnectNotice(reason) {
  const Y  = '\x1b[38;5;226m';
  const G  = '\x1b[38;5;35m';
  const GR = '\x1b[38;5;245m';
  const R  = '\x1b[0m';
  console.log('');
  console.log('  ' + Y + '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━' + R);
  console.log('  ' + Y + '⚠  WhatsApp disconnected' + (reason ? ' — ' + reason : '') + R);
  console.log('  ' + GR + '  To reconnect, type:' + R);
  console.log('  ' + G  + '    /wp'          + R + GR + '          — re-link your account (shows QR)' + R);
  console.log('  ' + G  + '    /wa --reset'  + R + GR + '  — wipe session and start fresh' + R);
  console.log('  ' + Y + '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━' + R);
  console.log('');
}




// ─── Main ─────────────────────────────────────────────────────────────────────
async function startWhatsApp(opts = {}) {
  if (_isRunning) {
    log.info('startWhatsApp called but session already active — skipping duplicate start.');
    if (typeof opts.onConnected === 'function' && _activeSock) opts.onConnected();
    return _activeSock;
  }
  _isRunning = true;

  const { onConnected, onDisconnected } = opts;
  const authPath = path.join(AUTH_DIR, SESSION_ID);

  const { state, saveCreds } = await useMultiFileAuthState(authPath);
  const { version }          = await fetchLatestBaileysVersion();

  log.openStartupBox('WA startup');
  log.startupLine('info', `Using WA version ${version.join('.')}`);

  const ownerNumber = loadOwnerNumber();
  _ownerJid     = toJid(ownerNumber);
  _farewellSent = false;

  if (!_ownerJid) {
    log.startupLine('warn', 'No owner number set — replying to ALL messages. Run /wp to set your number.');
  } else {
    log.startupLine('info', `Owner JID: ${_ownerJid}`);
  }

  const sock = makeWASocket({
    version,
    auth:    state,
    logger:  pino({ level: 'silent' }),
    browser: ['whyWhale', 'Chrome', '4.0.0'],
  });

  _activeSock  = sock;
  // Do not reset _startupSent here — it may be a 440 auto-retry.
  // _startupSent is only cleared on explicit logout/reset (see resetSession / wipeSession).
  _sentByBot.clear();

  // Suppress Baileys stderr noise
  const _origStderrWrite = process.stderr.write.bind(process.stderr);
  process.stderr.write = (chunk, ...args) => {
    const s = typeof chunk === 'string' ? chunk : chunk.toString();
    if (
      s.includes('Bad MAC') || s.includes('Failed to decrypt') ||
      s.includes('Closing open session') || s.includes('Closing session:') ||
      s.includes('SessionEntry')
    ) return true;
    return _origStderrWrite(chunk, ...args);
  };

  sock.ev.on('creds.update', saveCreds);

  // ── Connection lifecycle ──────────────────────────────────────────────────
  sock.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      const G = colors.waGreen + colors.bold;
      const R = colors.reset;
      console.log(`\n  ${G}┌──────────────────────────────────────────────┐${R}`);
      console.log(`  ${G}│${R}  ${colors.waLight}📱  Scan QR with WhatsApp:${R}                  ${G}│${R}`);
      console.log(`  ${G}│${R}  ${colors.grey}Settings → Linked Devices → Link a Device${R}  ${G}│${R}`);
      console.log(`  ${G}└──────────────────────────────────────────────┘${R}`);
      console.log('');
      qrcode.generate(qr, { small: true });
      console.log('');
    }

    if (connection === 'open') {
      _retryCount = 0;
      log.startupLine('success', 'WhatsApp connected ✅  — relaying messages to the AI pipeline');
      if (typeof onConnected === 'function') onConnected();

      if (_ownerJid && !_startupSent) {
        _startupSent = true;
        try {
          await sleep(1500);
          const sent = await sock.sendMessage(_ownerJid, { text: MSG_ONLINE });
          if (sent?.key?.id) _sentByBot.add(sent.key.id);
          log.startupLine('info', 'Startup message sent to owner.');
          log.closeStartupBox();
        } catch (err) {
          log.startupLine('error', 'Could not send startup message: ' + err.message);
          log.closeStartupBox();
        }
      }
    }

    if (connection === 'close') {
      const code      = (lastDisconnect?.error instanceof Boom)
        ? lastDisconnect.error.output.statusCode : null;
      const loggedOut = code === DisconnectReason.loggedOut;

      _activeSock  = null;
      // NOTE: _startupSent is intentionally NOT reset here so that
      // auto-reconnects (e.g. code 440) do not re-send the startup DM.
      // It is only reset on true logout / session wipe below.

      if (loggedOut) {
        wipeSession(); _retryCount = 0; _isRunning = false;
        _startupSent = false;   // real logout → allow fresh startup message next time
        printDisconnectNotice('you logged out from your phone');
        if (typeof onDisconnected === 'function') onDisconnected('loggedOut');
        return;
      }

      if (code === 440) {
        const Y = '\x1b[38;5;226m', GR = '\x1b[38;5;245m', R = '\x1b[0m';
        console.log('');
        console.log('  ' + Y + '⚠ WhatsApp: session replaced (code 440).' + R);
        console.log('  ' + GR + 'Another WhatsApp Web / standalone session took over.' + R);
        console.log('  ' + GR + 'Auto-retrying in ' + (RETRY_440_MS / 1000) + 's …' + R);
        console.log('');
        _retryCount = 0; _isRunning = false;
        await sleep(RETRY_440_MS);
        if (!_isRunning) startWhatsApp(opts);
        return;
      }

      if (code === 401 || code === 403) {
        log.warn(`Auth error (code ${code}) — wiping session, will show fresh QR.`);
        wipeSession(); _retryCount = 0; _isRunning = false;
        _startupSent = false;   // genuine fresh auth → allow startup message after QR scan
        await sleep(2000);
        startWhatsApp(opts);
        return;
      }

      _retryCount++;
      if (_retryCount > MAX_RETRIES) {
        _retryCount = 0; _isRunning = false;
        printDisconnectNotice(`connection failed after ${MAX_RETRIES} attempts (code ${code})`);
        if (typeof onDisconnected === 'function') onDisconnected('maxRetries');
        return;
      }
      const delay = 3000 * _retryCount;
      log.warn(`Connection closed (code ${code}). Reconnecting (${_retryCount}/${MAX_RETRIES}) in ${delay / 1000}s…`);
      _isRunning = false;
      await sleep(delay);
      startWhatsApp(opts);
    }
  });

  // ── Incoming messages ─────────────────────────────────────────────────────
  // Messages are pushed to _msgQueue and processed ONE AT A TIME.
  // This prevents the Boom "Connection Closed" crash that happened when a
  // long agent task (Phase 6) was still running while a new WA message
  // arrived and both called sendPresenceUpdate concurrently on the same socket.
  sock.ev.on('messages.upsert', ({ messages, type }) => {
    if (type !== 'notify') return;
    for (const msg of messages) {
      // fromMe = true -> bot's own outgoing reply echoed back by Baileys.
      // Pass null sender/text so _enqueueMsgTask never sends a queue-ack for it.
      // _processOneMessage still runs and discards it silently via _sentByBot.
      const fromMe = !!msg.key.fromMe;
      const sender = fromMe ? null : msg.key?.remoteJid;
      const text   = fromMe ? null : extractText(msg);
      _enqueueMsgTask(() => _processOneMessage(msg, sock), sock, sender, text);
    }
  });

  // ── Queue flush helper — process one message at a time ────────────────────
  async function _processOneMessage(msg, sock) {
    if (!msg.message) return;

    const sender     = msg.key.remoteJid;
    const isSelfChat = !!(_ownerJid && sender === _ownerJid);

    if (msg.key.fromMe) {
      if (_sentByBot.has(msg.key.id)) { _sentByBot.delete(msg.key.id); return; }
      if (!isSelfChat) return;
    }

    const text = extractText(msg);
    if (!text) return;

    // Load dmPolicy config (defaults to 'owner-only' if not set)
    const { whatsapp: waCfg = {} } = require('../../lib/config').loadConfig();
    const policy    = waCfg.dmPolicy   || 'owner';
    const allowFrom = waCfg.allowFrom  || [];

    // 'owner' policy: only the registered owner JID is allowed
    if (policy === 'owner') {
      if (_ownerJid && sender !== _ownerJid) {
        log.info(`Ignored message from non-owner: ${sender}`);
        return;
      }
    } else {
      const allowed = await dmGuard({ sender, text, policy, allowFrom, sock });
      if (!allowed) return;
    }

    // ── PHASE 1: Log incoming, get AI plan (stdout suppressed) ──────────
    log.incoming(sender, text);

    // Safe presence wrapper — swallows errors if socket is mid-reconnect
    const safePresence = async (state) => {
      try { await sock.sendPresenceUpdate(state, sender); } catch (_) {}
    };

    try {
      await safePresence('composing');

      // AI plans the response — returns reply text + parsed directives
      const { reply, directives, workType } = await getAIResponse(text, sender);

      log.outgoing(sender, reply);
      log.closeSection(workType);

      await safePresence('paused');
      const sent = await sock.sendMessage(sender, { text: reply }, { quoted: msg });
      if (sent?.key?.id) _sentByBot.add(sent.key.id);

      // ── PHASE 2: Execute work visibly in the terminal ─────────────────
      if (workType === 'work' || workType === 'send') {
        const { summary, createdFiles } = await executeWork(directives, sender);

        if (summary.length > 0) {
          const doneText = '✅ Done!\n\n' + summary.join('\n');
          log.openSection();
          log.outgoing(sender, doneText);
          log.closeSection('chat');
          const doneSent = await sock.sendMessage(sender, { text: doneText });
          if (doneSent?.key?.id) _sentByBot.add(doneSent.key.id);
        }

        for (const absPath of createdFiles) {
          try {
            const fileName   = path.basename(absPath);
            const fileBuffer = fs.readFileSync(absPath);
            const ext  = fileName.split('.').pop().toLowerCase();
            const mime = { pdf:'application/pdf', zip:'application/zip',
              png:'image/png', jpg:'image/jpeg', jpeg:'image/jpeg' }[ext] || 'text/plain';
            log.info(`Sending file to owner: ${fileName}`);
            const fileSent = await sock.sendMessage(sender, {
              document: fileBuffer, fileName, mimetype: mime, caption: `📄 ${fileName}`,
            });
            if (fileSent?.key?.id) _sentByBot.add(fileSent.key.id);
          } catch (ferr) {
            log.error(`Could not send file ${path.basename(absPath)}: ${ferr.message}`);
          }
        }
      }

    } catch (err) {
      log.error(`AI handler error: ${err.message}`);
      if (log.sectionOpen) log.closeSection('end');
      try {
        await sock.sendPresenceUpdate('paused', sender);
        const errSent = await sock.sendMessage(sender, {
          text: '⚠️ Something went wrong. Try again in a moment.',
        });
        if (errSent?.key?.id) _sentByBot.add(errSent.key.id);
      } catch (_) {}
    }
  }

  return sock;
}




// ─── Helpers ──────────────────────────────────────────────────────────────────
function extractText(msg) {
  return (
    msg.message?.conversation ||
    msg.message?.extendedTextMessage?.text ||
    msg.message?.buttonsResponseMessage?.selectedDisplayText ||
    msg.message?.listResponseMessage?.title ||
    ''
  );
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ─── Standalone entry ─────────────────────────────────────────────────────────
if (require.main === module) {
  startWhatsApp({ headless: !process.stdout.isTTY })
    .catch(err => { console.error(err); process.exit(1); });
}

// ─── sendToOwner ──────────────────────────────────────────────────────────────
// Called from the terminal-side aiHandler to notify the owner after work is done.
async function sendToOwner(text) {
  if (!_activeSock || !_ownerJid) return;
  try {
    const sent = await _activeSock.sendMessage(_ownerJid, { text });
    if (sent?.key?.id) _sentByBot.add(sent.key.id);
  } catch (_) {}
}

function getActiveSock() { return _activeSock; }

module.exports = { startWhatsApp, sendFarewellMessage, resetSession, sendToOwner, getActiveSock };
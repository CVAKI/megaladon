'use strict';

const readline = require('readline');
const path     = require('path');
const fs       = require('fs');

const { ab, cr, dg, kp, rf, wh }              = require('../colors');
const { loadConfig, loadMemory, loadSkills, saveMemory } = require('../config');
const { PROVIDERS }                            = require('../providers');
const { renderPS1 }                            = require('../render');
const { CWD }                                  = require('../filesystem');
const { MODES }                                = require('../modes');

const { VERSION }                              = require('./constants');
const { runSetup }                             = require('./setup');
const { dispatchCommand }                      = require('./commands');
const { autoDetectModeAndSkills }              = require('./autoDetect');
const { handleAiMessage }                      = require('./aiHandler');

// ─── autoStartConnections ─────────────────────────────────────────────────────
// Called once after setup. If the user has previously connected WhatsApp
// (credentials exist on disk), silently start it in the background so it is
// live by the time they start chatting — no manual step needed.
async function autoStartConnections(ctx) {
  const { getConnectionStatus } = require('../connections');

  // ── WhatsApp ───────────────────────────────────────────────────────────────
  const waStatus = getConnectionStatus('whatsapp');
  if (!waStatus?.connected) return;   // never set up — skip

  // Check credentials folder actually exists (session may have been wiped)
  const credPath = path.join(
      require('os').homedir(), '.meg', 'credentials', 'whatsapp', 'session'
  );
  if (!fs.existsSync(credPath)) {
    // Baileys session not yet created — startWhatsApp will show the QR automatically
  }

  // Resolve path to the WhatsApp engine
  const WA_INDEX = path.resolve(__dirname, '../../connections/whatsapp/index.js');
  if (!fs.existsSync(WA_INDEX)) return;

  // ── Load WhatsApp modules, auto-installing deps if missing ──────────────
  const WA_DIR = path.dirname(WA_INDEX);
  let startWhatsApp, sendFarewellMessage, setContext, getActiveSock;

  const tryLoad = () => {
    ({ startWhatsApp, sendFarewellMessage, getActiveSock } = require(WA_INDEX));
    ({ setContext } = require(path.join(WA_DIR, 'aiHandler.js')));
  };

  try {
    tryLoad();
  } catch (loadErr) {
    const G_  = '\x1b[38;5;35m';
    const GR_ = '\x1b[38;5;245m';
    const R_  = '\x1b[0m';

    console.log('  ' + '\x1b[38;5;226m' + '⚠ WhatsApp deps not found — installing automatically...' + R_);

    const installed = await new Promise((resolve) => {
      const { spawn } = require('child_process');
      const isWin = process.platform === 'win32';
      const cmd   = isWin ? 'npm.cmd' : 'npm';
      const child = spawn(cmd, ['install'], {
        cwd:   WA_DIR,
        stdio: 'inherit',
        shell: isWin,
      });
      child.on('close', code => resolve(code === 0));
      child.on('error', ()    => resolve(false));
    });

    if (!installed) {
      console.log(
          '  ' + rf('\u2718 Auto-install failed.') +
          GR_ + ' Run manually: ' + R_ +
          G_ + 'cd connections/whatsapp && npm install' + R_
      );
      return;
    }

    console.log('  ' + G_ + '\u2714 WhatsApp deps installed!' + R_);

    Object.keys(require.cache).forEach(k => {
      if (k.includes('connections' + path.sep + 'whatsapp') ||
          k.includes('@whiskeysockets') || k.includes('@hapi') || k.includes('pino')) {
        delete require.cache[k];
      }
    });

    try {
      tryLoad();
    } catch (err2) {
      console.log('  ' + rf('\u2718 Could not load WhatsApp after install: ') + err2.message);
      return;
    }
  }

  // Pass Megaladon ctx so WhatsApp messages go through the full AI pipeline
  setContext(ctx);

  const G  = '\x1b[38;5;35m';
  const GL = '\x1b[38;5;157m';
  const R  = '\x1b[0m';

  console.log('  ' + G + '◈' + R + ' ' + G + 'WhatsApp:' + R + ' ' + GL + 'connecting...' + R);

  // ── onDisconnected callback — notifies the user and reprints the prompt ──
  const onDisconnected = (reason) => {
    ctx.waClient = null;
    if (typeof ctx.prompt === 'function') ctx.prompt();
  };

  startWhatsApp({
    dmPolicy:       'pairing',
    onConnected:    () => { ctx.waClient = getActiveSock(); ctx.prompt(); },
    onDisconnected,
  }).catch(err => {
    console.log('  ' + rf('⚠ WhatsApp auto-start failed: ') + err.message);
  });

  // Store farewell fn on ctx so the exit handler can call it
  ctx._waSendFarewell = sendFarewellMessage;
}

// ─── main ─────────────────────────────────────────────────────────────────────
async function main() {
  // ── Load saved config + memory ─────────────────────────────────────────────
  const cfg = loadConfig();
  const mem = loadMemory();

  // ── Build shared mutable context ────────────────────────────────────────────
  const ctx = {
    // Persisted config
    providerKey:     cfg.provider || null,
    apiKey:          cfg.apiKey   || '',
    modelId:         cfg.model    || null,
    mode:            cfg.mode     || 'code',
    autoTest:        cfg.autoTest !== false,
    autoScan:        cfg.autoScan !== false,
    maxTokens:       cfg.maxTokens || 4096,
    // Runtime state
    prov:            null,
    modelMeta:       null,
    availModels:     [],
    messages:        [],
    mem,
    skills:          loadSkills(),
    totalTok:        0,
    lastReply:       '',
    mlBuf:           '',
    msgN:            0,
    t0:              Date.now(),
    folderCtx:       '',
    agentTaskActive: false,
    statusRef:       { mode: cfg.mode || 'code', model: cfg.model || '', msgCount: 0 },
    waClient:        null,
    // I/O (set below)
    rl:              null,
    ask:             null,
    prompt:          null,
    // Version
    VERSION,
  };

  // ── Readline interface ─────────────────────────────────────────────────────
  ctx.rl     = readline.createInterface({ input: process.stdin, output: process.stdout });
  ctx.ask    = q => new Promise(res => ctx.rl.question(q, res));
  ctx.prompt = () => process.stdout.write(renderPS1(ctx.msgN, CWD(), ctx.mode, MODES));

  // ── Setup: provider → key → model → folder scan → welcome ─────────────────
  await runSetup(ctx);

  // Resolve prov reference now that providerKey is confirmed
  ctx.prov = PROVIDERS[ctx.providerKey] || PROVIDERS.openrouter;

  // ── Auto-start any previously connected integrations ──────────────────────
  autoStartConnections(ctx);

  ctx.prompt();

  // ── Graceful shutdown (Ctrl+C / Ctrl+D / window close) ────────────────────
  // FIX: session summaries (used for the "N past sessions" count in the
  // startup banner, and /history) were ONLY ever saved from handleExit()
  // in session.js — which runs solely when the person types /exit. Pressing
  // Ctrl+C (by far the more common way people actually quit a CLI tool) hits
  // Node's default SIGINT handling, which kills the process immediately
  // WITHOUT ever emitting readline's 'close' event — so neither the summary
  // save nor the rl.on('close', ...) handler below ever ran at all. That's
  // why "0 past sessions" stayed stuck at 0 regardless of how many real
  // sessions happened. Registering a SIGINT listener on the readline
  // interface itself intercepts Ctrl+C and routes it through the normal
  // close() path instead of the hard kill, so cleanup actually runs.
  ctx.rl.on('SIGINT', () => { ctx.rl.close(); });

  // Best-effort: covers the process being asked to terminate some other way
  // (e.g. some terminal window-close scenarios deliver SIGTERM). Not
  // guaranteed on every platform for a true hard kill (Task Manager "End
  // task" gives no chance to run anything at all) — but catches what Node
  // reasonably can.
  process.on('SIGTERM', () => { ctx.rl.close(); });

  // ── Input queue ────────────────────────────────────────────────────────────
  const _inputQueue = [];
  let   _inputBusy  = false;

  async function _processQueue() {
    if (_inputBusy) return;
    while (_inputQueue.length) {
      _inputBusy = true;
      const raw  = _inputQueue.shift();
      try {
        await _handleLine(raw);
      } catch (e) {
        console.log('\n  ' + dg('✘ Input error: ') + e.message);
      } finally {
        _inputBusy = false;
      }
    }
  }

  ctx.rl.on('line', raw => { _inputQueue.push(raw); _processQueue(); });

  // ── _handleLine ────────────────────────────────────────────────────────────
  async function _handleLine(raw) {
    let text = raw.trim();

    if (text.endsWith('\\')) { ctx.mlBuf += text.slice(0, -1) + '\n'; process.stdout.write(ab('... ')); return; }
    if (ctx.mlBuf)           { text = ctx.mlBuf + text; ctx.mlBuf = ''; }
    if (!text)               { ctx.prompt(); return; }

    const handled = await dispatchCommand(text, ctx);
    if (handled) return;

    autoDetectModeAndSkills(text, ctx);
    await handleAiMessage(text, ctx);
    ctx.prompt();
  }

  // ── Exit handler (Ctrl+C / Ctrl+D / rl.close() called from /exit) ─────────
  // The goodbye banner + farewell WA message is handled in handleExit (commands.js)
  // which awaits the farewell before calling rl.close().
  // This handler covers the case of Ctrl+D (EOF) where handleExit is NOT called.
  ctx.rl.on('close', async () => {
    const up = Math.round((Date.now() - ctx.t0) / 1000);

    // Same session-summary save handleExit() (session.js) does for /exit —
    // duplicated here rather than refactored into one shared function across
    // two files, guarded by _exitBannerPrinted so /exit's own save never
    // double-runs. This is what actually makes Ctrl+C / Ctrl+D sessions
    // count toward "past sessions" instead of being silently dropped.
    if (!ctx._exitBannerPrinted && ctx.messages.length > 2) {
      const summary = ctx.messages.filter(m => m.role === 'user').slice(-5).map(m => m.content.slice(0, 100)).join(' | ');
      ctx.mem.sessionSummaries = [...(ctx.mem.sessionSummaries || []).slice(-9), { date: new Date().toISOString(), summary, msgCount: ctx.msgN }];
      saveMemory(ctx.mem);
    }

    // Send WA farewell if connected (best-effort — may not complete on hard kill)
    if (ctx._waSendFarewell) {
      try { await ctx._waSendFarewell(); } catch (_) {}
    }

    // Print goodbye banner (only if handleExit didn't already print it)
    if (!ctx._exitBannerPrinted) {
      console.log('\n  ' + cr('🦈 Goodbye!') + ab('  ' + ctx.msgN + ' msgs · ' + ctx.totalTok.toLocaleString() + ' tokens · ' + Math.floor(up / 60) + 'm ' + (up % 60) + 's'));
      console.log('');
    }

    process.exit(0);
  });
}

module.exports = { main, VERSION };
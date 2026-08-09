'use strict';

/**
 * connections/whatsapp/aiHandler.js
 *
 * Bridges WhatsApp messages → whyWhale AI pipeline (or direct provider).
 *
 * TWO-PHASE DESIGN for work tasks:
 *
 *   Phase 1 — PLAN (stdout suppressed):
 *     AI receives the message and produces a reply that may contain
 *     @@FILE / @@RUN / @@MEMORY directives. stdout is suppressed so
 *     the terminal pipeline spinner doesn't bleed into the WA session.
 *     Returns: { reply, directives, rawReply }
 *
 *   Phase 2 — EXECUTE (stdout open, visible in terminal):
 *     Called by index.js AFTER the section closes and the idle PS1 prints.
 *     Runs the directives with full terminal output so the user can watch
 *     the work happening live, exactly like typing the command themselves.
 *     Returns: summary string for the follow-up WA reply.
 *
 * This produces the flow from the design:
 *   ┟══ [WA ←] user message
 *   ┟══ [WA →] "ok wait for me, I'll be back after processing"
 *   └[whatsapp]-[process]::[section @END-> going to terminal for work]
 *   ┌[time]────[whyWhale]────[mode]────[#]
 *   └[cwd]──►  creating index.php...        ← live terminal output
 *              writing style.css...
 *   ┌[time]════[whyWhale]════════[section :2]
 *   ┟══ [WA →] "Done! Here's what I built..."
 */

const path = require('path');
const fs   = require('fs');
const { loadConfig, loadMemory } = require('../../lib/config');
const sessionCache = require('../../lib/session-cache');

// ─── Shared context ───────────────────────────────────────────────────────────
let _ctx = null;
function setContext(ctx) { _ctx = ctx; }


function stripCodeFences(code) {
  return code
    .replace(/^```[\w.-]*[\t ]*\r?\n/, '')
    .replace(/\r?\n```[\w.-]*[\t ]*$/, '')
    .replace(/^```[\w.-]*[\t ]*\r?\n/, '')
    .replace(/\r?\n```[\w.-]*[\t ]*$/, '');
}
// ─── Per-sender rolling history ───────────────────────────────────────────────
const histories   = new Map();
const MAX_HISTORY = 20;

function getHistory(sender) {
  if (!histories.has(sender)) histories.set(sender, []);
  return histories.get(sender);
}
function pushHistory(sender, role, content) {
  const h = getHistory(sender);
  h.push({ role, content });
  if (h.length > MAX_HISTORY) h.splice(0, h.length - MAX_HISTORY);
}

// ─── Robust code-fence stripper ─────────────────────────────────────────────────────────────
function stripCodeFences(raw) {
  if (!raw) return raw;
  let s = raw.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const trimmed = s.trimStart();
  if (!trimmed.startsWith('```')) return s;
  s = trimmed;
  const openMatch = s.match(/^```([^\n]*)\n/);
  if (!openMatch) return s;
  const extraOnFenceLine = openMatch[1].replace(/^[\w.+\-#/ ]*/, '').trim();
  s = s.slice(openMatch[0].length);
  if (extraOnFenceLine) s = extraOnFenceLine + '\n' + s;
  const lastFenceIdx = s.lastIndexOf('\n```');
  if (lastFenceIdx !== -1) {
    const before = s.slice(0, lastFenceIdx);
    const after  = s.slice(lastFenceIdx + 4).replace(/^[^\S\n]*\n/, '');
    s = before + (after.trim() ? '\n' + after : '');
  }
  return s;
}

// ─── Directive parser ─────────────────────────────────────────────────────────
function parseDirectives(text) {
  const result = { files: [], runs: [], memory: [], sends: [] };
  const fileRe  = /@@FILE:([^\n]+)\n([\s\S]*?)@@END/g;
  const runRe   = /@@RUN:([^\n]+)/g;
  const memRe   = /@@MEMORY:([^=\n]+)=([^\n]+)/g;
  const sendRe  = /@@SEND:\s*([^\n]+)/g;
  let m;
  while ((m = fileRe.exec(text)) !== null)
    result.files.push({ path: m[1].trim(), content: m[2] });
  while ((m = runRe.exec(text)) !== null)
    result.runs.push(m[1].trim());
  while ((m = memRe.exec(text)) !== null)
    result.memory.push({ key: m[1].trim(), value: m[2].trim() });
  while ((m = sendRe.exec(text)) !== null)
    result.sends.push(m[1].trim());
  return result;
}

function hasWork(directives) {
  return directives.files.length > 0 ||
         directives.runs.length  > 0 ||
         directives.memory.length > 0 ||
         directives.sends.length > 0;
}

function detectWorkType(directives, rawReply) {
  const hasSend = directives.sends.length > 0 ||
    /@@SEND:/i.test(rawReply) ||
    /\bsend\b.*\b(file|zip|attachment)\b/i.test(rawReply) ||
    /\b(zip|compress|archive)\b/i.test(rawReply);
  if (hasSend)                              return 'send';
  if (hasWork(directives))                  return 'work';
  return 'chat';
}

// ─── Send File Command ────────────────────────────────────────────────────────────
// Detects 'send/give/share me the file' requests before hitting the AI.
// Returns an array of absolute paths to send, or null if not a send request.
function detectSendFileRequest(text) {
  const lower = text.toLowerCase().trim();

  // /send <filename> explicit command
  if (lower.startsWith('/send ')) {
    const name = text.slice(6).trim();
    return resolveFileNames([name]);
  }

  // Match 'send/give/share me filename.ext'
  const explicitFile = /\b(?:send|give|share|forward|get|attach|transfer)\b[^\n]{0,30}\b([\w.-]+\.(?:html?|css|js|ts|jsx|tsx|py|json|txt|md|pdf|zip|png|jpg|jpeg|svg|mp4|mp3|xlsx|csv|doc|docx))\b/i.exec(text);
  if (explicitFile) return resolveFileNames([explicitFile[1]]);

  // Generic 'give me the file / send me the file / send the html'
  const generic = /\b(?:send|give|share|forward|get)\b.{0,40}\b(?:the\s+)?(?:file|html|css|code|script|zip|pdf|document|attachment)\b/i.test(lower);
  if (generic) {
    // Send the most recently modified file in cwd
    try {
      const cwd = process.cwd();
      const files = fs.readdirSync(cwd)
        .map(f => { const abs = path.join(cwd, f); try { return { abs, mtime: fs.statSync(abs).mtimeMs, isFile: fs.statSync(abs).isFile() }; } catch(_) { return null; } })
        .filter(e => e && e.isFile)
        .sort((a, b) => b.mtime - a.mtime);
      if (files.length) return [files[0].abs];
    } catch (_) {}
  }

  return null;
}

function resolveFileNames(names) {
  const results = [];
  for (const name of names) {
    const candidates = [
      path.isAbsolute(name) ? name : path.join(process.cwd(), name),
      path.join(require('os').homedir(), name),
    ];
    for (const c of candidates) {
      try { if (fs.existsSync(c) && fs.statSync(c).isFile()) { results.push(c); break; } } catch(_) {}
    }
  }
  return results.length > 0 ? results : null;
}

// ─── WA Command dispatcher ────────────────────────────────────────────────────
// Mirrors the terminal /commands so they work over WhatsApp DM too.
// Returns a reply string if handled, or null to fall through to AI.
async function handleWACommand(text, sender) {
  const t    = text.trim();
  const low  = t.toLowerCase();
  const args = t.split(/\s+/);
  const cmd  = args[0].toLowerCase();

  if (!cmd.startsWith('/') && !cmd.startsWith('!')) return null;

  const { loadConfig, saveConfig, loadMemory, saveMemory } = require('../../lib/config');
  const { scanFolder, buildFolderContext, readFileSafe, treeDir, lsDir, formatSize } = require('../../lib/filesystem');
  const { MODES } = require('../../lib/modes');

  // ── !shell passthrough ─────────────────────────────────────────────────────
  if (t.startsWith('!')) {
    const shellCmd = t.slice(1).trim();
    if (!shellCmd) return '⚠️ Usage: !<command>  e.g. !ls  !pwd  !node --version';

    const { execSync } = require('child_process');
    const os   = require('os');
    const path = require('path');
    const isWin = process.platform === 'win32';

    // ── Stateful working directory per sender ────────────────────────────────
    if (!handleWACommand._cwd) handleWACommand._cwd = new Map();
    let cwd = handleWACommand._cwd.get(sender) || process.cwd();

    // ── Handle `cd` specially — updates tracked cwd AND actual process cwd ──
    const cdMatch = shellCmd.match(/^cd\s+(.+)$/);
    if (cdMatch || shellCmd.trim() === 'cd') {
      const fs2 = require('fs');
      let dest;
      if (shellCmd.trim() === 'cd') {
        dest = os.homedir();
      } else {
        dest = cdMatch[1].trim().replace(/^~/, os.homedir());
        dest = path.isAbsolute(dest) ? dest : path.resolve(cwd, dest);
      }
      if (!fs2.existsSync(dest)) return '```\n$ ' + shellCmd + '\n✘ No such directory: ' + dest + '\n```';
      // Update per-sender map AND the real process cwd so /scan, /ls, /tree
      // and all subsequent !commands see the new directory immediately.
      handleWACommand._cwd.set(sender, dest);
      try { process.chdir(dest); } catch (_) {}
      // Also update the terminal prompt / statusRef so the PS1 reflects it.
      if (_ctx) {
        try { _ctx.prompt(); } catch (_) {}
      }
      return '```\n$ ' + shellCmd + '\ncwd → ' + dest + '\n```\n📂 `' + dest + '`';
    }

    // ── Linux → Windows command translations (only on Windows host) ──────────
    let actualCmd = shellCmd;
    if (isWin) {
      const linuxToWin = [
        { pat: /^ls\s*-la?\b/,  fn: () => 'dir /a'           },
        { pat: /^ls\b/,          fn: c => c.replace(/^ls/, 'dir') },
        { pat: /^pwd$/,           fn: () => 'cd'                },
        { pat: /^cat\s/,         fn: c => c.replace(/^cat\s+/, 'type ').replace(/\//g, '\\') },
        { pat: /^grep\s/,        fn: c => c.replace(/^grep\s+"?([^"\s]+)"?\s/, 'findstr "$1" ') },
        { pat: /^mkdir\s+-p\s/, fn: c => c.replace('mkdir -p', 'mkdir').replace(/\//g, '\\') },
        { pat: /^rm\s+-rf?\s/,  fn: c => 'rmdir /s /q ' + c.split(/\s+/).slice(2).join(' ').replace(/\//g, '\\') },
        { pat: /^rm\s/,          fn: c => c.replace(/^rm\s+/, 'del ').replace(/\//g, '\\') },
        { pat: /^cp\s/,          fn: c => c.replace(/^cp\s/, 'copy ').replace(/\//g, '\\') },
        { pat: /^mv\s/,          fn: c => c.replace(/^mv\s/, 'move ').replace(/\//g, '\\') },
        { pat: /^touch\s/,       fn: c => c.replace(/^touch\s+/, 'type nul > ').replace(/\//g, '\\') },
        { pat: /^which\s/,       fn: c => c.replace(/^which\s/, 'where ') },
        { pat: /^clear$/,         fn: () => 'cls'               },
        { pat: /^kill\s+/,       fn: c => c.replace(/^kill\s+/, 'taskkill /PID ') },
        { pat: /^pkill\s/,       fn: c => 'taskkill /F /IM ' + c.split(/\s+/)[1] + '.exe' },
        { pat: /^ps\s/,          fn: () => 'tasklist'          },
        { pat: /^ps$/,            fn: () => 'tasklist'          },
        { pat: /^ifconfig$/,      fn: () => 'ipconfig'          },
        { pat: /^curl\s/,        fn: c => 'cmd /c ' + c       },
        { pat: /^echo\s/,        fn: c => c                    },
        { pat: /^find\s/,        fn: c => c.replace(/^find\s/, 'dir /s /b ').replace(/\//g, '\\') },
        { pat: /^df\b/,          fn: () => 'wmic logicaldisk get size,freespace,caption' },
        { pat: /^free\b/,        fn: () => 'wmic OS get FreePhysicalMemory,TotalVisibleMemorySize' },
        { pat: /^uname\b/,       fn: () => 'ver'               },
        { pat: /^env$/,           fn: () => 'set'               },
      ];
      const match = linuxToWin.find(r => r.pat.test(actualCmd));
      if (match) {
        const rewritten = match.fn(actualCmd);
        actualCmd = rewritten;
      }
    }

    // ── Run the command ───────────────────────────────────────────────────────
    try {
      const out = execSync(actualCmd, {
        encoding: 'utf8', timeout: 30_000,
        cwd, stdio: ['pipe', 'pipe', 'pipe'],
        env: { ...process.env, FORCE_COLOR: '0' },
      });
      const allLines = out.trim().split('\n');
      const shown    = allLines.slice(0, 60);
      const extra    = allLines.length > 60 ? '\n… (' + (allLines.length - 60) + ' more lines)' : '';
      const prefix   = (actualCmd !== shellCmd) ? '(→ ' + actualCmd + ')\n' : '';
      return '```\n$ ' + shellCmd + '\n' + prefix + shown.join('\n') + extra + '\n```' +
             '\n📂 `' + cwd + '`';
    } catch (e) {
      const errOut = (e.stdout || e.stderr || e.message || '').trim();

      // Auto-install missing npm packages and retry once
      const missingMod = errOut.match(/Cannot find module '([^'.][^']*)'/)?.[1]?.split('/')[0];
      if (missingMod) {
        try {
          execSync('npm install ' + missingMod + ' --save', { cwd, timeout: 60000, stdio: 'ignore' });
          const out2 = execSync(actualCmd, { encoding: 'utf8', timeout: 30_000, cwd, stdio: ['pipe','pipe','pipe'] });
          return '```\n$ ' + shellCmd + '\n✔ auto-installed ' + missingMod + '\n' + out2.trim().split('\n').slice(0,60).join('\n') + '\n```';
        } catch (e2) {
          return '```\n$ ' + shellCmd + '\n✘ ' + (e2.stderr || e2.message || '').trim().split('\n').slice(0,8).join('\n') + '\n```';
        }
      }

      return '```\n$ ' + shellCmd + '\n✘ ' + errOut.split('\n').slice(0, 12).join('\n') + '\n```';
    }
  }

  // ── /exit — shut down whyWhale from WA DM ─────────────────────────────────
  if (cmd === '/exit') {
    // Reply first, then schedule shutdown after 1.5s so the reply can be sent
    setTimeout(async () => {
      if (_ctx && typeof _ctx._waSendFarewell === 'function') {
        try { await _ctx._waSendFarewell(); } catch (_) {}
      }
      if (_ctx && _ctx.rl) _ctx.rl.close();
      else process.exit(0);
    }, 1500);
    return '🐋 *whyWhale shutting down...*\n\nGoodbye! I\'ll send a farewell message now.';
  }

  // ── /help ──────────────────────────────────────────────────────────────────
  if (cmd === '/help') {
    return [
      '🐋 *whyWhale commands (WhatsApp)*',
      '',
      '*Memory*',
      '`/memory` — show all facts',
      '`/memory set <key> <value>` — store a fact',
      '`/memory clear` — wipe all facts',
      '',
      '*Files & Navigation*',
      '`/scan` — show folder tree + load files into AI context',
      '`/ls [path]` — list directory',
      '`/tree [depth]` — directory tree',
      '`/read <file>` — read a file',
      '',
      '*Shell*',
      '`!<command>` — run any shell command',
      '`!cd <path>` — change working directory (affects terminal too)',
      '`!pwd` — show current directory',
      '',
      '*Mode*',
      '`/mode` — show current mode',
      '`/mode <n>` — switch mode (code/debug/agent/architect/review/explain/plan)',
      '',
      '*Tokens*',
      '`/token` — show token limit & presets',
      '`/token -set-usage <n>` — set limit  e.g. /token -set-usage 12000',
      '',
      '*Session*',
      '`/stats` — session statistics',
      '`/clear` — clear conversation history',
      '`/exit` — shut down whyWhale',
      '',
      '💡 *Messages are queued* — send freely even while a task is running!',
    ].join('\n');
  }

  // ── /memory ────────────────────────────────────────────────────────────────
  if (cmd === '/memory') {
    const mem = loadMemory();
    const sub = args[1]?.toLowerCase();

    // Normalise facts to the array-of-{key,value} format the main app uses.
    // Old WA code wrote facts as a plain object {key:val} — convert on read
    // so [object Object] never appears again.
    if (!Array.isArray(mem.facts)) {
      mem.facts = Object.entries(mem.facts || {}).map(([k, v]) => ({
        key:   k,
        value: (v !== null && typeof v === 'object') ? JSON.stringify(v) : String(v),
        added: new Date().toISOString(),
      }));
    }

    if (sub === 'clear') {
      mem.facts = [];
      saveMemory(mem);
      if (_ctx && _ctx.mem) _ctx.mem.facts = [];
      return '🗑️ Memory cleared.';
    }

    if (sub === 'set') {
      if (args.length < 4) return '⚠️ Usage: /memory set <key> <value>';
      const key = args[2];
      const val = args.slice(3).join(' ');
      // Upsert — same logic as the main app
      const idx = mem.facts.findIndex(f => f.key === key);
      if (idx >= 0) mem.facts[idx].value = val;
      else          mem.facts.push({ key, value: val, added: new Date().toISOString() });
      saveMemory(mem);
      if (_ctx && _ctx.mem) _ctx.mem.facts = mem.facts;
      return '✔ Memory saved: *' + key + '* → ' + val;
    }

    // Show all facts
    if (!mem.facts.length) return '🧠 Memory is empty.\nUse `/memory set <key> <value>` to store facts.';
    const lines = mem.facts.map(f => {
      const v = (f.value !== null && typeof f.value === 'object') ? JSON.stringify(f.value) : String(f.value ?? '');
      return '• *' + f.key + '*: ' + v;
    });
    return '🧠 *Persistent Memory (' + mem.facts.length + ' facts)*\n\n' + lines.join('\n');
  }

  // ── /scan ──────────────────────────────────────────────────────────────────
  if (cmd === '/scan') {
    const cwd2  = process.cwd();
    const files = scanFolder(cwd2, 8);
    if (_ctx) _ctx.folderCtx = buildFolderContext(files, cwd2);

    // Build a tree view of the directory so WA shows folders + files
    const fsNode = require('fs');
    function buildTree(dir, prefix, depth) {
      if (depth > 3) return [];
      let entries;
      try { entries = fsNode.readdirSync(dir, { withFileTypes: true }); }
      catch (_) { return []; }
      // Ignore hidden + noisy dirs
      const SKIP = new Set(['node_modules', '.git', '.idea', '__pycache__', 'dist', 'build', '.next', '.cache']);
      entries = entries.filter(e => !e.name.startsWith('.') && !SKIP.has(e.name));
      entries.sort((a, b) => {
        if (a.isDirectory() !== b.isDirectory()) return a.isDirectory() ? -1 : 1;
        return a.name.localeCompare(b.name);
      });
      const lines = [];
      entries.forEach((e, i) => {
        const last    = i === entries.length - 1;
        const branch  = last ? '└── ' : '├── ';
        const childPfx = last ? '    ' : '│   ';
        if (e.isDirectory()) {
          lines.push(prefix + branch + '📁 ' + e.name + '/');
          buildTree(require('path').join(dir, e.name), prefix + childPfx, depth + 1).forEach(l => lines.push(l));
        } else {
          lines.push(prefix + branch + e.name);
        }
      });
      return lines;
    }

    const treeLines = buildTree(cwd2, '', 0);
    const treeOut   = treeLines.slice(0, 60).join('\n') + (treeLines.length > 60 ? '\n… (truncated)' : '');
    const extra     = files.length > 0
      ? '\n\n✔ *' + files.length + ' file(s) loaded into AI context*'
      : '';

    return '📂 *' + cwd2 + '*\n\n```\n' + (treeOut || '(empty)') + '\n```' + extra;
  }

  // ── /ls ───────────────────────────────────────────────────────────────────
  if (cmd === '/ls') {
    const rel   = args[1] || '.';
    try {
      const entries = lsDir(rel);
      if (!entries.length) return '📂 Empty directory: ' + rel;
      return '📂 *' + rel + '*\n\n' + entries.slice(0, 30).map(e => '• ' + e).join('\n');
    } catch (e) {
      return '✘ ' + e.message;
    }
  }

  // ── /tree ──────────────────────────────────────────────────────────────────
  if (cmd === '/tree') {
    const depth = parseInt(args[1]) || 3;
    try {
      const lines = treeDir(process.cwd(), '', 0, depth);
      return '```\n' + lines.slice(0, 40).join('\n') + (lines.length > 40 ? '\n… (truncated)' : '') + '\n```';
    } catch (e) {
      return '✘ ' + e.message;
    }
  }

  // ── /read ──────────────────────────────────────────────────────────────────
  if (cmd === '/read') {
    const fp = args.slice(1).join(' ').trim();
    if (!fp) return '⚠️ Usage: /read <filepath>';
    try {
      const file  = readFileSafe(fp);
      const lines = file.content.split('\n');
      const preview = lines.slice(0, 50).join('\n');
      const note    = lines.length > 50 ? '\n… (' + lines.length + ' lines total, showing 50)' : '';
      return '📄 *' + file.name + '* (' + (file.size / 1024).toFixed(1) + 'KB)\n\n```' + file.ext + '\n' + preview + note + '\n```';
    } catch (e) {
      return '✘ File not found: ' + fp;
    }
  }

  // ── /mode ──────────────────────────────────────────────────────────────────
  if (cmd === '/mode') {
    const cfg      = loadConfig();
    const validModes = Object.keys(MODES);
    const newMode  = args[1]?.toLowerCase().replace(/[^a-z]/g, '');

    if (!newMode) {
      const cur = cfg.mode || 'code';
      return '🎯 *Current mode:* ' + (MODES[cur]?.icon || '') + ' ' + (MODES[cur]?.name || cur) + '\n\nAvailable: ' + validModes.join(', ');
    }
    if (!validModes.includes(newMode)) {
      return '⚠️ Unknown mode. Options: ' + validModes.join(', ');
    }
    saveConfig({ ...cfg, mode: newMode });
    if (_ctx) _ctx.mode = newMode;
    return '✔ Mode switched to *' + (MODES[newMode]?.icon || '') + ' ' + MODES[newMode].name + '*';
  }

  // ── /token  (also accepts legacy /coding) ──────────────────────────────────
  if (cmd === '/token' || cmd === '/coding') {
    const cfg = loadConfig();
    const sub = args[1];
    const PRESETS = [
      { tokens: 2048,  label: 'Basic',     desc: 'Simple snippets' },
      { tokens: 4096,  label: 'Standard',  desc: 'Single files ✅ default' },
      { tokens: 8192,  label: 'Good Code', desc: 'Full modules ⭐ recommended' },
      { tokens: 12000, label: 'Large',     desc: 'Complex servers' },
      { tokens: 16000, label: 'Huge',      desc: 'Multi-file agent tasks' },
      { tokens: 32000, label: 'Max',       desc: 'Model limit — may be ignored' },
    ];
    const current = (_ctx?.maxTokens) || cfg.maxTokens || 4096;

    if (!sub || sub === '-show') {
      const rows = PRESETS.map(p =>
        (p.tokens === current ? '▶ ' : '  ') + p.tokens + ' — ' + p.label + ': ' + p.desc
      ).join('\n');
      return '⚙️ *Token limit* (current: ' + current.toLocaleString() + ')\n\n```\n' + rows + '\n```\n\nSet: `/token -set-usage 8192`';
    }

    // Accept both new -set-usage and legacy -set-token
    if (sub === '-set-usage' || sub === '-set-token') {
      const n = parseInt(args[2], 10);
      if (isNaN(n) || n < 256) return '⚠️ Usage: /token -set-usage <number>  (min 256)\nExample: /token -set-usage 12000';
      const capped = Math.min(n, 200000);
      saveConfig({ ...cfg, maxTokens: capped });
      if (_ctx) _ctx.maxTokens = capped;
      const preset = PRESETS.find(p => p.tokens === capped);
      return '✔ Token limit set → *' + capped.toLocaleString() + '*' + (preset ? ' (' + preset.label + ')' : '') + '\nAll AI calls will now use this limit.';
    }

    return '⚠️ Usage:\n`/token` — see options\n`/token -set-usage <n>` — set limit';
  }

  // ── /stats ─────────────────────────────────────────────────────────────────
  if (cmd === '/stats') {
    const cfg = loadConfig();
    const mem = loadMemory();
    const ctx = _ctx;
    const up  = ctx ? Math.round((Date.now() - ctx.t0) / 1000) : 0;
    const lines = [
      '📊 *whyWhale Session Stats*',
      '',
      '• Provider: ' + (cfg.provider || 'unknown'),
      '• Model: '    + (cfg.model    || 'unknown'),
      '• Mode: '     + (cfg.mode     || 'code'),
      '• Max Tokens: ' + ((ctx?.maxTokens || cfg.maxTokens || 4096)).toLocaleString(),
      '• Messages: ' + (ctx?.msgN || 0),
      '• Memory Facts: ' + Object.keys(mem?.facts || {}).length,
      '• Skills: '   + (ctx?.skills?.map(s => s.name).join(', ') || 'none'),
      '• Uptime: '   + Math.floor(up / 60) + 'm ' + (up % 60) + 's',
      '• Working Dir: `' + process.cwd() + '`',
    ];
    return lines.join('\n');
  }

  // ── /clear ─────────────────────────────────────────────────────────────────
  if (cmd === '/clear') {
    if (_ctx) _ctx.messages = [];
    return '🗑️ Conversation history cleared.';
  }

  // ── Unknown /command — fall through to AI ─────────────────────────────────
  return null;
}


// Called by index.js to get the AI reply.
// stdout is suppressed so terminal pipeline output doesn't bleed.
// Returns { reply, directives, workType, rawReply }
async function getAIResponse(userMessage, sender = 'unknown') {
  // ── Check for /commands and !shell first — no AI call needed ─────────────
  const cmdReply = await handleWACommand(userMessage, sender);
  if (cmdReply !== null) {
    return {
      reply:      cmdReply,
      directives: { files: [], runs: [], memory: [], sends: [] },
      workType:   'chat',
      rawReply:   cmdReply,
    };
  }

  // Short-circuit: 'send/give me the file' before calling the AI
  const filesToSend = detectSendFileRequest(userMessage);
  if (filesToSend) {
    const names = filesToSend.map(p => require('path').basename(p)).join(', ');
    const sendReply = '📤 Sending you: ' + names;
    return {
      reply:      sendReply,
      directives: { files: [], runs: [], memory: [], sends: filesToSend },
      workType:   'send',
      rawReply:   sendReply,
    };
  }

  let rawReply = '';

  if (_ctx && _ctx.prov) {
    rawReply = await integratedCall(userMessage, sender);
  } else {
    rawReply = await standaloneCall(userMessage, sender);
  }

  const directives = parseDirectives(rawReply);
  const workType   = detectWorkType(directives, rawReply);

  // Clean reply for WA (strip directive blocks)
  let reply = rawReply
    .replace(/@@FILE:[^\n]+\n[\s\S]*?@@END/g, '')
    .replace(/@@RUN:[^\n]+/g, '')
    .replace(/@@MEMORY:[^\n]+/g, '')
    .replace(/@@SEND:[^\n]+/g, '')
    .trim();

  // Annotate reply with what's about to happen
  if (workType === 'work') {
    const parts = [];
    if (directives.files.length) parts.push(`📄 ${directives.files.length} file(s)`);
    if (directives.runs.length)  parts.push(`⚡ ${directives.runs.length} command(s)`);
    reply = (reply ? reply + '\n\n' : '') +
      `⏳ Working on it — ${parts.join(', ')}. I'll report back when done.`;
  } else if (workType === 'send') {
    reply = (reply ? reply + '\n\n' : '') + '📦 Preparing files, just a moment...';
  }

  return { reply, directives, workType, rawReply };
}

// ─── PHASE 2: executeWork ─────────────────────────────────────────────────────
// Called by index.js AFTER the section closes, with stdout fully restored.
// Wraps all output in a WA-style section box so readline prompt doesn't bleed in.
async function executeWork(directives, sender) {
  const { log, colors: C } = require('./logger');
  const B  = C.bold;
  const R  = C.reset;

  const summary      = [];
  const createdFiles = [];

  // ── Open WA work section box ───────────────────────────────────────────────
  const ts = () => { const n = new Date(); return [n.getHours(),n.getMinutes(),n.getSeconds()].map(v=>String(v).padStart(2,'0')).join(':'); };
  process.stdout.write('\n' + [
    C.waGreen+'┌'+R,
    C.waGreen+'['+R+C.amber+ts()+R+C.waGreen+']'+R,
    C.waGreen+'════'+R,
    C.waGreen+'['+R+B+C.white+'whyWhale'+R+C.waGreen+']'+R,
    C.waGreen+'════════'+R,
    C.waGreen+'['+R+C.waLight+B+'⚙ executing work'+R+C.waGreen+']'+R,
  ].join('') + '\n');

  function wline(icon, label, text, ok) {
    const col = ok === false ? C.red : ok === true ? C.waGreen : C.waLight;
    const preview = (text||'').length > 70 ? (text||'').slice(0,70)+'…' : (text||'');
    process.stdout.write([
      C.waGreen+'┟══ '+R,
      C.amber+icon+' '+R,
      C.grey+label+'  '+R,
      col+preview+R,
    ].join('') + '\n');
  }

  // ── Write files ────────────────────────────────────────────────────────────
  for (const f of directives.files) {
    const abs = path.isAbsolute(f.path) ? f.path : path.join(process.cwd(), f.path);
    try {
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      // Strip markdown code fences if model wrapped content
      let fc = f.content;
      fc = stripCodeFences(fc);
      fs.writeFileSync(abs, fc, 'utf8');
      wline('📄', 'wrote', f.path, true);
      summary.push('📄 wrote `' + f.path + '`');
      createdFiles.push(abs);
      try { const _c = sessionCache.loadCache(); sessionCache.recordFile(_c, abs, fc, 'created'); } catch(_) {}
    } catch (e) {
      wline('✘', 'failed', f.path + ' — ' + e.message, false);
      summary.push('✘ failed `' + f.path + '`: ' + e.message);
      try { const _c2 = sessionCache.loadCache(); sessionCache.recordFile(_c2, f.path, e.message, 'error'); } catch(_) {}
    }
  }

  // ── Run commands ───────────────────────────────────────────────────────────
  for (let cmd of directives.runs) {
    const myPid = process.pid;
    if (process.platform === 'win32' && /taskkill\b.*\/IM\s+node\.exe/i.test(cmd)) {
      cmd = `powershell -NoProfile -Command "Get-Process node -ErrorAction SilentlyContinue | Where-Object { $_.Id -ne ${myPid} } | Stop-Process -Force"`;
    } else if (process.platform !== 'win32' && /\b(killall|pkill)\s+(-\w+\s+)*node\b/i.test(cmd)) {
      cmd = `pkill -f "node server\\.js" 2>/dev/null; pkill -f "node client\\.js" 2>/dev/null; true`;
    }
    wline('⚡', 'run  ', cmd, null);
    const { execSync } = require('child_process');
    try {
      const out = execSync(cmd, { encoding: 'utf8', timeout: 30_000, cwd: process.cwd(), stdio: ['pipe','pipe','pipe'] });
      if (out.trim()) {
        out.trim().split('\n').slice(0,8).forEach(l =>
          process.stdout.write(C.waGreen+'┟    '+R+C.grey+'│  '+R+C.waLight+l+R+'\n')
        );
      }
      summary.push('⚡ ran `' + cmd + '`');
      try { const _cc = sessionCache.loadCache(); sessionCache.recordCommand(_cc, cmd, 0, ''); } catch(_) {}
    } catch (e) {
      const errOut = (e.stderr || e.message || '').trim().split('\n')[0];
      if (errOut) wline('✘', 'error', errOut, false);
      process.stdout.write(C.waGreen+'┟    '+R+C.red+'exit '+((e.status||1))+R+'\n');
      summary.push('✘ `' + cmd + '` failed (exit ' + (e.status||1) + ')');
      try { const _cc2 = sessionCache.loadCache(); sessionCache.recordCommand(_cc2, cmd, e.status||1, errOut); } catch(_) {}
    }
  }

  // ── Save memory ────────────────────────────────────────────────────────────
  if (directives.memory.length > 0) {
    const { saveMemory } = require('../../lib/config');
    const mem = loadMemory();
    if (!mem.facts) mem.facts = {};
    for (const { key, value } of directives.memory) {
      mem.facts[key] = value;
      wline('💾', 'memory', key + ' = ' + value, true);
      summary.push('💾 remembered `' + key + '`');
    }
    try { saveMemory(mem); } catch (_) {}
    if (_ctx && _ctx.mem) Object.assign(_ctx.mem, mem);
  }

  // ── Close section box ──────────────────────────────────────────────────────

  // ── Resolve & queue @@SEND: files (existing files on disk) ────
  if (directives.sends && directives.sends.length > 0) {
    for (const rawPath of directives.sends) {
      const candidates = [
        path.isAbsolute(rawPath) ? rawPath : path.join(process.cwd(), rawPath),
        path.join(require('os').homedir(), rawPath),
      ];
      let found = null;
      for (const c of candidates) {
        if (fs.existsSync(c) && fs.statSync(c).isFile()) { found = c; break; }
      }
      if (found) {
        wline('\xf0\x9f\x93\xa4', 'send  ', path.basename(found), true);
        summary.push('\xf0\x9f\x93\xa4 queued for sending: `' + path.basename(found) + '`');
        createdFiles.push(found);
      } else {
        wline('\xe2\x9c\x98', 'send  ', rawPath + ' \xe2\x80\x94 file not found', false);
        summary.push('\xe2\x9c\x98 could not find `' + rawPath + '`');
      }
    }
  }

  const ok = summary.every(s => !s.startsWith('✘'));
  process.stdout.write([
    C.waGreen+'└'+R,
    C.grey+'[whatsapp]'+R,
    C.grey+'-[work]'+R,
    C.grey+'::'+R,
    C.grey+'['+R,
    (ok ? C.waGreen : C.red)+B+(ok ? 'work done ✅' : 'work done ⚠')+R,
    C.grey+']'+R,
  ].join('') + '\n');

  return { summary, createdFiles };
}

// ─── Integrated call (stdout suppressed) ─────────────────────────────────────
async function integratedCall(userMessage, sender) {
  let handleAiMessage;
  try {
    const mod = require('../../lib/main/aiHandler');
    handleAiMessage = mod.handleAiMessage;
    if (typeof handleAiMessage !== 'function') handleAiMessage = null;
  } catch (_) { handleAiMessage = null; }

  if (!handleAiMessage) return standaloneCall(userMessage, sender);

  const ctxClone = {
    ..._ctx,
    messages:  getHistory(sender),
    lastReply: '',
  };

  // Show a minimal WA indicator in the terminal so the user knows it's processing.
  // Without this, the suppressed stdout makes whyWhale appear completely frozen.
  const { colors: C } = require('./logger');
  const waIndicator = setInterval(() => {
    const frames = ['⠋','⠙','⠹','⠸','⠼','⠴','⠦','⠧','⠇','⠏'];
    const f = frames[Math.floor(Date.now() / 80) % frames.length];
    process.stdout.write('\r  ' + C.waGreen + '[' + f + '] WA: processing...' + C.reset + '   ');
  }, 80);

  // Suppress all terminal output during AI call (except our indicator above)
  const origWrite = process.stdout.write.bind(process.stdout);
  const chunks    = [];
  process.stdout.write = (chunk) => { chunks.push(String(chunk)); return true; };

  let raw = '';

  // 45-second timeout — if the AI hangs, fall through to standaloneCall
  const TIMEOUT_MS = 45_000;

  try {
    await Promise.race([
      handleAiMessage(userMessage, ctxClone),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error('WA AI timeout after 45s')), TIMEOUT_MS)
      ),
    ]);
    raw = ctxClone.lastReply || '';
  } catch (err) {
    process.stdout.write = origWrite;
    clearInterval(waIndicator);
    process.stdout.write('\r' + ' '.repeat(40) + '\r');
    // Log the fallback reason visibly so the user sees it in the terminal
    process.stdout.write('  \x1b[33m⚠ WA fallback: ' + err.message + '\x1b[0m\n');
    return standaloneCall(userMessage, sender);
  } finally {
    process.stdout.write = origWrite;
    clearInterval(waIndicator);
    process.stdout.write('\r' + ' '.repeat(40) + '\r');
  }

  // Sync history
  if (Array.isArray(ctxClone.messages) && ctxClone.messages.length > 0) {
    histories.set(sender, ctxClone.messages.slice(-MAX_HISTORY));
  } else {
    pushHistory(sender, 'user',      userMessage);
    pushHistory(sender, 'assistant', raw);
  }

  return raw || '(no response)';
}

// ─── WA Request Amplifier ─────────────────────────────────────────────────────────────────────────────
function amplifyWARequest(text) {
  const lower = text.toLowerCase();
  const isBuild = /\b(create|build|make|generate|write|design)\b/.test(lower) &&
                  /\b(html|css|page|website|site|app|component|ui|landing|portfolio|dashboard|template)\b/.test(lower);
  const isEdit  = /\b(improve|update|better|nicer|modern|beautiful|apple|redesign|color|colour|style|enhance)\b/.test(lower) &&
                  /\b(html|css|page|website|design|look|ui|the code|the file)\b/.test(lower);
  if (!isBuild && !isEdit) return text;

  const appleStyle = /apple|minimal|clean|cupertino/.test(lower);
  const palette = appleStyle
    ? 'Apple-style palette: white/off-white backgrounds, system fonts, black text, subtle blue accents (#0071e3), generous whitespace.'
    : 'Modern gradient palette: dark hero (deep navy to indigo), vivid accent, frosted glass cards, white text.';

  return `${text}

[MANDATORY SPEC] Write a COMPLETE, production-grade HTML file (@@FILE: index.html).
Minimum 700 lines. Do NOT truncate. Include:
- Sticky navbar with blur + mobile hamburger menu
- Full-height hero: ${palette} CSS keyframe animations.
- Feature cards grid (3-6 cards) with hover lift effects
- Stats/testimonials section with scroll animations
- Contact/CTA section + multi-column footer
- CSS variables in :root, responsive breakpoints (768px, 480px)
- Intersection Observer JS for scroll-reveal animations
- Smooth scroll, countup numbers, all transitions 0.3-0.5s
Write every line. No placeholders.`;
}

// ─── Standalone call ──────────────────────────────────────────────────────────
async function standaloneCall(userMessage, sender) {
  const cfg = loadConfig();
  const mem = loadMemory();

  const provider  = process.env.WA_PROVIDER || cfg.provider || 'anthropic';
  const model     = process.env.WA_MODEL    || cfg.model    || 'claude-sonnet-4-20250514';
  const apiKey    = process.env.WA_API_KEY  || cfg.apiKey   || '';
  const maxTokens = cfg.maxTokens || 8192;

  if (!apiKey && provider !== 'ollama') {
    return '⚠️ No API key configured. Run `whywhale --setup` or set WA_API_KEY.';
  }

  // Amplify brief build/create requests for richer output
  const amplified = amplifyWARequest(userMessage);
  pushHistory(sender, 'user', amplified);
  const systemPrompt = buildSystemPrompt(mem);
  const messages     = getHistory(sender);

  let raw = '';
  // Retry up to 3 times with 2s backoff (handles Ollama cold-start / fetch failed)
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      if (attempt > 1) await new Promise(r => setTimeout(r, 2000));
      switch (provider) {
        case 'anthropic':   raw = await callAnthropic({ apiKey, model, systemPrompt, messages, maxTokens }); break;
        case 'openrouter':  raw = await callOpenRouter({ apiKey, model, systemPrompt, messages, maxTokens }); break;
        case 'groq':        raw = await callGroq({ apiKey, model, systemPrompt, messages, maxTokens }); break;
        case 'ollama':      raw = await callOllama({ model, systemPrompt, messages, maxTokens }); break;
        default:            raw = `⚠️ Unknown provider: ${provider}`;
      }
      break; // success — exit retry loop
    } catch (err) {
      if (attempt === 3) raw = `⚠️ Provider error (after 3 attempts): ${err.message}`;
    }
  }

  pushHistory(sender, 'assistant', raw);
  return raw || '(no response)';
}

// ─── Provider implementations ─────────────────────────────────────────────────
async function callAnthropic({ apiKey, model, systemPrompt, messages, maxTokens = 8192 }) {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({ model, max_tokens: maxTokens, system: systemPrompt, messages }),
  });
  if (!res.ok) throw new Error(`Anthropic ${res.status}: ${await res.text()}`);
  return (await res.json()).content?.[0]?.text || '';
}
async function callOpenRouter({ apiKey, model, systemPrompt, messages, maxTokens = 8192 }) {
  const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ model, messages: [{ role: 'system', content: systemPrompt }, ...messages] }),
  });
  if (!res.ok) throw new Error(`OpenRouter ${res.status}: ${await res.text()}`);
  return (await res.json()).choices?.[0]?.message?.content || '';
}
async function callGroq({ apiKey, model, systemPrompt, messages, maxTokens = 8192 }) {
  const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ model, messages: [{ role: 'system', content: systemPrompt }, ...messages] }),
  });
  if (!res.ok) throw new Error(`Groq ${res.status}: ${await res.text()}`);
  return (await res.json()).choices?.[0]?.message?.content || '';
}
async function callOllama({ model, systemPrompt, messages, maxTokens = 8192 }) {
  const base = process.env.OLLAMA_HOST || 'http://localhost:11434';
  const res  = await fetch(`${base}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, messages: [{ role: 'system', content: systemPrompt }, ...messages], stream: false }),
  });
  if (!res.ok) throw new Error(`Ollama ${res.status}: ${await res.text()}`);
  return (await res.json()).message?.content || '';
}

// ─── System prompt ────────────────────────────────────────────────────────────
function buildSystemPrompt(mem) {
  const memLines = Object.entries(mem?.facts || {})
    .map(([k, v]) => `- ${k}: ${v}`).join('\n');
  return [
    'You are whyWhale 🐋 — an elite AI coding assistant and terminal brain, now connected via WhatsApp.',
    'You were built by CVAKI. You are NOT Claude, GPT, Gemini, or any generic AI.',
    'If anyone asks who you are, what you are, or who made you: always say you are whyWhale, built by CVAKI.',
    'Never say you are "an AI language model created by Anthropic" or mention any underlying model provider.',
    'Your personality: sharp, direct, whale-themed. You use 🐋 occasionally. You are proud to be whyWhale.',
    '',
    'You are replying over WhatsApp — keep messages readable on mobile:',
    '  • Be concise but complete. No padding or filler.',
    '  • Use plain text. Avoid heavy markdown (no ## headers).',
    '  • Code snippets: plain triple-backticks only.',
    '  • For lists: use simple dashes or numbers.',
    '',
    'When asked to create files or run commands, use these directives:',
    '  @@FILE:<relative/path>',
    '  <complete file content>',
    '  @@END',
    '  @@RUN:<shell command>',
    '  @@MEMORY:<key>=<value>',
    '  @@SEND:<relative/path/to/existing/file>  ← use this to send an already-existing file to the user',
    '',
    'FILE QUALITY RULES (mandatory):',
    '  \u2022 HTML/CSS/web files: minimum 600 lines. Include CSS variables, animations, responsive layout,',
    '    gradient backgrounds, hover effects, sticky navbar, hero section, feature cards, footer.',
    '    Use modern color palettes \u2014 never plain #333 backgrounds. Always embed JS for interactivity.',
    '  \u2022 Any code file: write COMPLETE implementation \u2014 no placeholders, no TODO comments, no truncation.',
    '  \u2022 Backend/API: full error handling, input validation, proper HTTP status codes.',
    memLines ? `\nWhat I remember about you:\n${memLines}` : '',
    (() => { try { const sc = sessionCache.loadCache(); const ctx = sessionCache.buildSessionContext(sc); return ctx ? '\n' + ctx : ''; } catch(_) { return ''; } })(),
  ].filter(Boolean).join('\n');
}

module.exports = { getAIResponse, executeWork, setContext };
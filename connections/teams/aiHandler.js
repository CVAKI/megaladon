'use strict';

/**
 * connections/teams/aiHandler.js
 *
 * Bridges Teams messages → Megaladon AI pipeline (or direct provider call).
 * Structurally the same two-phase design as connections/whatsapp/aiHandler.js:
 *
 *   Phase 1 — PLAN (stdout suppressed):
 *     AI produces a reply that may contain @@FILE / @@RUN / @@MEMORY / @@SEND
 *     directives. Returns { reply, directives, workType, rawReply }.
 *
 *   Phase 2 — EXECUTE (stdout open, visible in terminal):
 *     Called by index.js after the reply has been sent to Teams. Runs the
 *     directives live so the user can watch work happen in the terminal,
 *     then returns a summary for a follow-up Teams message.
 */

const path = require('path');
const fs   = require('fs');
const { loadConfig, loadMemory, saveMemory } = require('../../lib/config');
const { callAI } = require('../../lib/providers');
const sessionCache = require('../../lib/session-cache');

// ─── Shared context ───────────────────────────────────────────────────────────
let _ctx = null;
function setContext(ctx) { _ctx = ctx; }

// ─── Per-user rolling history ─────────────────────────────────────────────────
const histories   = new Map();
const MAX_HISTORY = 20;

function getHistory(userId) {
  if (!histories.has(userId)) histories.set(userId, []);
  return histories.get(userId);
}
function pushHistory(userId, role, content) {
  const h = getHistory(userId);
  h.push({ role, content });
  if (h.length > MAX_HISTORY) h.splice(0, h.length - MAX_HISTORY);
}

// ─── Robust code-fence stripper (same behaviour as the WA/main handlers) ──────
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

// ─── Directive parser (same grammar as terminal/@@FILE conventions) ──────────
function parseDirectives(text) {
  const result = { files: [], runs: [], memory: [], sends: [] };
  const fileRe  = /@@FILE:([^\n]+)\n([\s\S]*?)@@END/g;
  const runRe   = /@@RUN:([^\n]+)/g;
  const memRe   = /@@MEMORY:([^=\n]+)=([^\n]+)/g;
  const sendRe  = /@@SEND:\s*([^\n]+)/g;
  let m;
  while ((m = fileRe.exec(text)) !== null) result.files.push({ path: m[1].trim(), content: m[2] });
  while ((m = runRe.exec(text)) !== null)  result.runs.push(m[1].trim());
  while ((m = memRe.exec(text)) !== null)  result.memory.push({ key: m[1].trim(), value: m[2].trim() });
  while ((m = sendRe.exec(text)) !== null) result.sends.push(m[1].trim());
  return result;
}

function hasWork(directives) {
  return directives.files.length > 0 || directives.runs.length > 0 ||
         directives.memory.length > 0 || directives.sends.length > 0;
}

function detectWorkType(directives, rawReply) {
  const hasSend = directives.sends.length > 0 ||
    /@@SEND:/i.test(rawReply) ||
    /\bsend\b.*\b(file|zip|attachment)\b/i.test(rawReply);
  if (hasSend) return 'send';
  if (hasWork(directives)) return 'work';
  return 'chat';
}

// ─── Teams command dispatcher ──────────────────────────────────────────────────
// Mirrors a subset of the terminal /commands so they work from a Teams chat too.
// Returns a reply string if handled, or null to fall through to the AI.
async function handleTeamsCommand(text, userId) {
  const t   = text.trim();
  const low = t.toLowerCase();
  const args = t.split(/\s+/);
  const cmd  = args[0].toLowerCase();

  if (!cmd.startsWith('/')) return null;

  const { loadMemory, saveMemory } = require('../../lib/config');
  const { MODES } = require('../../lib/modes');

  if (cmd === '/help') {
    return [
      '**Megaladon commands (Teams)**',
      '',
      '`/memory` — show stored facts',
      '`/memory set <key> <value>` — store a fact',
      '`/memory clear` — wipe all facts',
      '`/mode` — show current mode',
      '`/mode <name>` — switch mode (code/debug/agent/architect/review/explain/plan)',
      '`/stats` — session statistics',
      '`/clear` — clear conversation history',
    ].join('\n');
  }

  if (cmd === '/memory') {
    const mem = loadMemory();
    const sub = args[1]?.toLowerCase();
    if (sub === 'clear') {
      mem.facts = [];
      saveMemory(mem);
      if (_ctx?.mem) _ctx.mem.facts = [];
      return '🗑️ Memory cleared.';
    }
    if (sub === 'set') {
      if (args.length < 4) return '⚠️ Usage: `/memory set <key> <value>`';
      const key = args[2];
      const val = args.slice(3).join(' ');
      const idx = mem.facts.findIndex(f => f.key === key);
      if (idx >= 0) mem.facts[idx].value = val;
      else mem.facts.push({ key, value: val, added: new Date().toISOString() });
      saveMemory(mem);
      if (_ctx?.mem) _ctx.mem.facts = mem.facts;
      return '✔ Memory saved: **' + key + '** → ' + val;
    }
    if (!mem.facts.length) return '🧠 Memory is empty.';
    return '🧠 **Persistent Memory (' + mem.facts.length + ' facts)**\n\n' +
      mem.facts.map(f => '• **' + f.key + '**: ' + f.value).join('\n');
  }

  if (cmd === '/mode') {
    const validModes = Object.keys(MODES);
    const newMode = args[1]?.toLowerCase().replace(/[^a-z]/g, '');
    if (!newMode) {
      const cur = _ctx?.mode || 'code';
      return '🎯 Current mode: ' + (MODES[cur]?.icon || '') + ' ' + (MODES[cur]?.name || cur) +
        '\n\nAvailable: ' + validModes.join(', ');
    }
    if (!validModes.includes(newMode)) return '⚠️ Unknown mode. Options: ' + validModes.join(', ');
    if (_ctx) _ctx.mode = newMode;
    return '✔ Mode switched to ' + (MODES[newMode]?.icon || '') + ' ' + MODES[newMode].name;
  }

  if (cmd === '/stats') {
    const cfg = loadConfig();
    const mem = loadMemory();
    return [
      '📊 **Session stats**',
      '• Provider: ' + (cfg.provider || 'unknown'),
      '• Model: ' + (cfg.model || 'unknown'),
      '• Mode: ' + (cfg.mode || 'code'),
      '• Memory facts: ' + (mem.facts?.length || 0),
    ].join('\n');
  }

  if (cmd === '/clear') {
    if (_ctx) _ctx.messages = [];
    histories.delete(userId);
    return '🗑️ Conversation history cleared.';
  }

  return null;
}

// ─── PHASE 1: getAIResponse ────────────────────────────────────────────────────
// Called by index.js when a message clears the policy gate.
// Returns { reply, directives, workType, rawReply }
async function getAIResponse(userMessage, userId = 'unknown') {
  const cmdReply = await handleTeamsCommand(userMessage, userId);
  if (cmdReply !== null) {
    return { reply: cmdReply, directives: { files: [], runs: [], memory: [], sends: [] }, workType: 'chat', rawReply: cmdReply };
  }

  let rawReply = '';
  if (_ctx && _ctx.prov) {
    rawReply = await integratedCall(userMessage, userId);
  } else {
    rawReply = await standaloneCall(userMessage, userId);
  }

  const directives = parseDirectives(rawReply);
  const workType    = detectWorkType(directives, rawReply);

  let reply = rawReply
    .replace(/@@FILE:[^\n]+\n[\s\S]*?@@END/g, '')
    .replace(/@@RUN:[^\n]+/g, '')
    .replace(/@@MEMORY:[^\n]+/g, '')
    .replace(/@@SEND:[^\n]+/g, '')
    .trim();

  if (workType === 'work') {
    const parts = [];
    if (directives.files.length) parts.push(`📄 ${directives.files.length} file(s)`);
    if (directives.runs.length)  parts.push(`⚡ ${directives.runs.length} command(s)`);
    reply = (reply ? reply + '\n\n' : '') + `⏳ Working on it — ${parts.join(', ')}. I'll report back when done.`;
  } else if (workType === 'send') {
    reply = (reply ? reply + '\n\n' : '') + '📦 Preparing files, just a moment...';
  }

  return { reply, directives, workType, rawReply };
}

// ─── PHASE 2: executeWork ─────────────────────────────────────────────────────
// Called by index.js after the reply has been sent, with stdout fully open.
async function executeWork(directives, userId) {
  const { colors: C } = require('./logger');
  const B = C.bold, R = C.reset;
  const summary = [];
  const createdFiles = [];

  const ts = () => { const n = new Date(); return [n.getHours(), n.getMinutes(), n.getSeconds()].map(v => String(v).padStart(2, '0')).join(':'); };
  process.stdout.write('\n' + [
    C.tmPurple + '┌' + R, C.tmPurple + '[' + R + C.amber + ts() + R + C.tmPurple + ']' + R,
    C.tmPurple + '════' + R, C.tmPurple + '[' + R + B + C.white + 'Megaladon' + R + C.tmPurple + ']' + R,
    C.tmPurple + '════════' + R, C.tmPurple + '[' + R + C.tmLight + B + '⚙ executing work' + R + C.tmPurple + ']' + R,
  ].join('') + '\n');

  function wline(icon, label, text, ok) {
    const col = ok === false ? C.red : ok === true ? C.tmPurple : C.tmLight;
    const preview = (text || '').length > 70 ? text.slice(0, 70) + '…' : (text || '');
    process.stdout.write([C.tmPurple + '┟══ ' + R, C.amber + icon + ' ' + R, C.grey + label + '  ' + R, col + preview + R].join('') + '\n');
  }

  for (const f of directives.files) {
    const abs = path.isAbsolute(f.path) ? f.path : path.join(process.cwd(), f.path);
    try {
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      const fc = stripCodeFences(f.content);
      fs.writeFileSync(abs, fc, 'utf8');
      wline('📄', 'wrote', f.path, true);
      summary.push('📄 wrote `' + f.path + '`');
      createdFiles.push(abs);
      try { const c = sessionCache.loadCache(); sessionCache.recordFile(c, abs, fc, 'created'); } catch (_) {}
    } catch (e) {
      wline('✘', 'failed', f.path + ' — ' + e.message, false);
      summary.push('✘ failed `' + f.path + '`: ' + e.message);
    }
  }

  for (const cmd of directives.runs) {
    wline('⚡', 'run  ', cmd, null);
    const { execSync } = require('child_process');
    try {
      const out = execSync(cmd, { encoding: 'utf8', timeout: 30_000, cwd: process.cwd(), stdio: ['pipe', 'pipe', 'pipe'] });
      if (out.trim()) out.trim().split('\n').slice(0, 8).forEach(l => process.stdout.write(C.tmPurple + '┟    ' + R + C.grey + '│  ' + R + C.tmLight + l + R + '\n'));
      summary.push('⚡ ran `' + cmd + '`');
      try { const c = sessionCache.loadCache(); sessionCache.recordCommand(c, cmd, 0, ''); } catch (_) {}
    } catch (e) {
      const errOut = (e.stderr || e.message || '').trim().split('\n')[0];
      if (errOut) wline('✘', 'error', errOut, false);
      summary.push('✘ `' + cmd + '` failed (exit ' + (e.status || 1) + ')');
      try { const c = sessionCache.loadCache(); sessionCache.recordCommand(c, cmd, e.status || 1, errOut); } catch (_) {}
    }
  }

  if (directives.memory.length > 0) {
    const mem = loadMemory();
    if (!mem.facts) mem.facts = [];
    for (const { key, value } of directives.memory) {
      const idx = mem.facts.findIndex(f => f.key === key);
      if (idx >= 0) mem.facts[idx].value = value; else mem.facts.push({ key, value, added: new Date().toISOString() });
      wline('💾', 'memory', key + ' = ' + value, true);
      summary.push('💾 remembered `' + key + '`');
    }
    try { saveMemory(mem); } catch (_) {}
    if (_ctx?.mem) _ctx.mem.facts = mem.facts;
  }

  if (directives.sends?.length > 0) {
    for (const rawPath of directives.sends) {
      const candidates = [
        path.isAbsolute(rawPath) ? rawPath : path.join(process.cwd(), rawPath),
        path.join(require('os').homedir(), rawPath),
      ];
      let found = null;
      for (const c of candidates) { if (fs.existsSync(c) && fs.statSync(c).isFile()) { found = c; break; } }
      if (found) {
        wline('📤', 'send  ', path.basename(found), true);
        summary.push('📤 queued for sending: `' + path.basename(found) + '`');
        createdFiles.push(found);
      } else {
        wline('✘', 'send  ', rawPath + ' — file not found', false);
        summary.push('✘ could not find `' + rawPath + '`');
      }
    }
  }

  const ok = summary.every(s => !s.startsWith('✘'));
  process.stdout.write([
    C.tmPurple + '└' + R, C.grey + '[teams]' + R, C.grey + '-[work]' + R, C.grey + '::' + R, C.grey + '[' + R,
    (ok ? C.tmPurple : C.red) + B + (ok ? 'work done ✅' : 'work done ⚠') + R, C.grey + ']' + R,
  ].join('') + '\n');

  return { summary, createdFiles };
}

// ─── Integrated call (stdout suppressed, runs through the full pipeline) ──────
async function integratedCall(userMessage, userId) {
  let handleAiMessage;
  try {
    const mod = require('../../lib/main/aiHandler');
    handleAiMessage = mod.handleAiMessage;
    if (typeof handleAiMessage !== 'function') handleAiMessage = null;
  } catch (_) { handleAiMessage = null; }

  if (!handleAiMessage) return standaloneCall(userMessage, userId);

  const ctxClone = { ..._ctx, messages: getHistory(userId), lastReply: '' };

  const { colors: C } = require('./logger');
  const indicator = setInterval(() => {
    const frames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
    const f = frames[Math.floor(Date.now() / 80) % frames.length];
    process.stdout.write('\r  ' + C.tmPurple + '[' + f + '] Teams: processing...' + C.reset + '   ');
  }, 80);

  const origWrite = process.stdout.write.bind(process.stdout);
  process.stdout.write = () => true;

  let raw = '';
  const TIMEOUT_MS = 45_000;
  try {
    await Promise.race([
      handleAiMessage(userMessage, ctxClone),
      new Promise((_, reject) => setTimeout(() => reject(new Error('Teams AI timeout after 45s')), TIMEOUT_MS)),
    ]);
    raw = ctxClone.lastReply || '';
  } catch (err) {
    process.stdout.write = origWrite;
    clearInterval(indicator);
    process.stdout.write('\r' + ' '.repeat(40) + '\r');
    process.stdout.write('  \x1b[33m⚠ Teams fallback: ' + err.message + '\x1b[0m\n');
    return standaloneCall(userMessage, userId);
  } finally {
    process.stdout.write = origWrite;
    clearInterval(indicator);
    process.stdout.write('\r' + ' '.repeat(40) + '\r');
  }

  if (Array.isArray(ctxClone.messages) && ctxClone.messages.length > 0) {
    histories.set(userId, ctxClone.messages.slice(-MAX_HISTORY));
  } else {
    pushHistory(userId, 'user', userMessage);
    pushHistory(userId, 'assistant', raw);
  }
  return raw || '(no response)';
}

// ─── Standalone call — uses the shared provider layer (lib/providers.js) ─────
// This automatically picks up any provider added there, including a future
// NVIDIA NIM provider, without needing changes here.
async function standaloneCall(userMessage, userId) {
  const cfg = loadConfig();
  const mem = loadMemory();

  const providerKey = process.env.TEAMS_PROVIDER || cfg.provider || 'anthropic';
  const modelId      = process.env.TEAMS_MODEL    || cfg.model    || 'claude-sonnet-4-20250514';
  const apiKey        = process.env.TEAMS_API_KEY  || cfg.apiKey   || '';

  if (!apiKey && providerKey !== 'ollama') {
    return '⚠️ No API key configured. Run `megaladon --setup` or set TEAMS_API_KEY.';
  }

  pushHistory(userId, 'user', userMessage);
  const systemPrompt = buildSystemPrompt(mem);
  const messages = [{ role: 'system', content: systemPrompt }, ...getHistory(userId)];

  let raw = '';
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      if (attempt > 1) await new Promise(r => setTimeout(r, 2000));
      const data = await callAI(providerKey, apiKey, modelId, messages);
      raw = data.choices?.[0]?.message?.content || '';
      break;
    } catch (err) {
      if (attempt === 3) raw = `⚠️ Provider error (after 3 attempts): ${err.message}`;
    }
  }

  pushHistory(userId, 'assistant', raw);
  return raw || '(no response)';
}

// ─── System prompt for standalone (non-integrated) calls ─────────────────────
function buildSystemPrompt(mem) {
  const memLines = (mem?.facts || []).map(f => `- ${f.key}: ${f.value}`).join('\n');
  return [
    'You are Megaladon 🦈 — an elite AI coding assistant, now connected via Microsoft Teams.',
    'You were built by CVAKI. You are NOT Claude, GPT, Gemini, or any generic AI.',
    'If anyone asks who you are, what you are, or who made you: always say you are Megaladon, built by CVAKI.',
    '',
    'You are replying inside a Teams chat — keep messages readable on desktop and mobile:',
    '  • Be concise but complete.',
    '  • Teams supports a subset of Markdown: **bold**, *italic*, `code`, and fenced code blocks.',
    '  • For lists: use simple dashes or numbers.',
    '',
    'When asked to create files or run commands, use these directives:',
    '  @@FILE:<relative/path>',
    '  <complete file content>',
    '  @@END',
    '  @@RUN:<shell command>',
    '  @@MEMORY:<key>=<value>',
    '  @@SEND:<relative/path/to/existing/file>',
    '',
    memLines ? `\nWhat I remember about you:\n${memLines}` : '',
  ].filter(Boolean).join('\n');
}

module.exports = { getAIResponse, executeWork, setContext };

'use strict';

const fs   = require('fs');
const path = require('path');

const { C, wh, cr, kp, rf, ab, sd, dg, vt, tl, dm } = require('../../colors');
const { saveConfig, saveMemory }                      = require('../../config');
const { formatMD, printBanner }                       = require('../../render');
const { CWD }                                         = require('../../filesystem');
const { saveSession, listSessions, copyClip }         = require('../../selftest');
const { MODES }                                       = require('../../modes');
const { buildSystemPrompt }                           = require('../utils');
const { VERSION }                                     = require('../constants');

const modeS = (ctx) => { const m = MODES[ctx.mode]; return m.colorFn(m.icon + ' ' + m.name); };

// ─── /exit ────────────────────────────────────────────────────────────────────
async function handleExit(text, ctx) {
  const up = Math.round((Date.now() - ctx.t0) / 1000);

  if (ctx.messages.length > 2) {
    const summary = ctx.messages.filter(m => m.role === 'user').slice(-5).map(m => m.content.slice(0, 100)).join(' | ');
    ctx.mem.sessionSummaries = [...(ctx.mem.sessionSummaries || []).slice(-9), { date: new Date().toISOString(), summary, msgCount: ctx.msgN }];
    saveMemory(ctx.mem);
  }

  if (ctx._waSendFarewell) {
    try { await ctx._waSendFarewell(); } catch (_) {}
  }

  ctx._exitBannerPrinted = true;
  console.log('\n  ' + cr('🦈 Goodbye!') + ab('  ' + ctx.msgN + ' msgs · ' + ctx.totalTok.toLocaleString() + ' tokens · ' + Math.floor(up / 60) + 'm ' + (up % 60) + 's'));
  console.log('');
  ctx.rl.close();
}

// ─── /help ────────────────────────────────────────────────────────────────────
async function handleHelp(ctx) {
  console.log('');
  console.log('  ' + cr(C.bold + 'Megaladon v' + VERSION) + C.reset + '  ' + ab(ctx.prov.name + ' · ' + (ctx.modelMeta.label || ctx.modelMeta.id)));
  const sections = {
    'CHAT & MODES': [
      ['/help',           'This help'],
      ['/clear',          'Clear conversation history'],
      ['/mode [name]',    'Switch AI mode: ' + Object.keys(MODES).join(' · ')],
      ['/model [n]',      'Show or switch model'],
      ['/provider',       'Switch AI provider'],
      ['/stats',          'Session statistics'],
      ['/tokens',         'Show token usage'],
      ['/system',         'Show current system prompt'],
      ['/copy',           'Copy last AI reply to clipboard'],
      ['/token',                   'Show AI token limit & presets'],
      ['/token -set-usage <n>',    'Set max tokens for AI responses  (e.g. /token -set-usage 8192)'],
      ['/debug -fix [file]',       'Scan → auto-install → AI-fix → run until live  (e.g. /debug -fix server.js)'],
      ['!<command>',      'Run any shell command (e.g. !ls, !git status, !npm install)'],
    ],
    'FILES & PROJECT': [
      ['/ls [path]',      'List files in directory'],
      ['/tree [depth]',   'Directory tree (default depth 3)'],
      ['/read <path>',    'Read file and show with syntax highlighting'],
      ['/analyse <path>', 'Deep AI analysis of a file'],
      ['/write <path>',   'AI-generate content for a file'],
      ['/create <path>',  'Create empty file'],
      ['/delete <path>',  'Delete file (asks confirmation)'],
      ['/rename <a> <b>', 'Rename or move a file'],
      ['/scan',           'Re-scan current directory into AI context'],
      ['/run <cmd>',      'Run a shell command and show output'],
    ],
    'MEMORY': [
      ['/memory',               'Show all persistent memory facts'],
      ['/memory set <key> <val>', 'Set a memory fact manually'],
      ['/memory clear',         'Clear all memory'],
    ],
    'SKILLS': [
      ['/skill list',        'Show available & installed skills'],
      ['/skill install <n>', 'Install a skill (react, python, security, testing, api-design, docker, database, git, performance, typescript)'],
      ['/skill remove <n>',  'Remove an installed skill'],
      ['/skill show <n>',    'Show skill prompt details'],
    ],
    'CONNECTIONS': [
      ['/connection',              'Show & set up messaging connections (WhatsApp, etc.)'],
      ['/connection whatsapp',     'Set up WhatsApp integration'],
      ['/wp',                      'Shortcut — open WhatsApp setup directly'],
      ['/connection disconnect <n>','Disconnect a service'],
      ['/wa <number> <message>',   'Send a WhatsApp message (e.g. /wa 919876543210 Hello!)'],
      ['/wa status',               'Show WhatsApp connection status'],
      ['/wa history',              'Show messages sent this session'],
      ['/wa owner <number>',       'Change the owner number Megaladon responds to'],
      ['/wa --reset',              'Wipe WhatsApp session & credentials — forces fresh QR scan'],
    ],
    'SESSION': [
      ['/save [name]',  'Save conversation to ~/.meg/sessions/'],
      ['/load',         'Restore a saved session'],
      ['/export',       'Export chat as HTML file'],
      ['/autotest',     'Toggle auto self-testing (currently: ' + (ctx.autoTest ? 'ON' : 'OFF') + ')'],
      ['/autoscan',     'Toggle auto folder scan (currently: ' + (ctx.autoScan ? 'ON' : 'OFF') + ')'],
      ['/dashboard',    'Open web dashboard at http://localhost:7070'],
      ['/reset',        'Wipe all config'],
      ['/exit',         'Quit (sends WA farewell if connected)'],
    ],
  };
  Object.entries(sections).forEach(([sec, cmds]) => {
    console.log('\n  ' + tl(sec));
    cmds.forEach(([c, d]) => console.log('  ' + cr(c.padEnd(28)) + ab(d)));
  });
  console.log('');
  console.log('  ' + ab('Tip: End any line with \\\\ for multi-line input'));
  console.log('  ' + ab('Tip: In ') + vt('agent') + ab(' mode, AI creates and fixes files automatically'));
  console.log('  ' + ab('Tip: ') + sd('@@MEMORY: key: value') + ab(' in AI responses saves info between sessions'));
  ctx.prompt(); return true;
}

// ─── /clear ───────────────────────────────────────────────────────────────────
async function handleClear(ctx) {
  ctx.messages = []; ctx.msgN = 0; ctx.totalTok = 0;
  console.clear(); printBanner(VERSION);
  console.log('  ' + kp('✔ Cleared') + ab('  Mode: ') + modeS(ctx) + ab('  cwd: ') + tl(CWD()));
  ctx.prompt(); return true;
}

// ─── /stats ───────────────────────────────────────────────────────────────────
async function handleStats(ctx) {
  const up = Math.round((Date.now() - ctx.t0) / 1000);
  console.log('\n  ' + cr(C.bold + 'Session Statistics'));
  [
    ['Provider',     ctx.prov.name],
    ['Model',        ctx.modelMeta.label || ctx.modelMeta.id],
    ['Mode',         MODES[ctx.mode].name],
    ['Working Dir',  CWD()],
    ['Messages',     String(ctx.msgN)],
    ['Tokens Used',  ctx.totalTok.toLocaleString()],
    ['Memory Facts', String(ctx.mem.facts.length)],
    ['Past Sessions',String(ctx.mem.sessionSummaries?.length || 0)],
    ['Skills',       ctx.skills.length ? ctx.skills.map(s => s.name).join(', ') : 'none'],
    ['Auto-Test',    ctx.autoTest ? 'ON' : 'OFF'],
    ['Auto-Scan',    ctx.autoScan ? 'ON' : 'OFF'],
    ['Max Tokens',   (ctx.maxTokens || 4096).toLocaleString() + '  (change: /token -set-usage <n>)'],
    ['Uptime',       Math.floor(up / 60) + 'm ' + (up % 60) + 's'],
  ].forEach(([k, v]) => console.log('  ' + ab(k.padEnd(14) + ' › ') + sd(v)));
  ctx.prompt(); return true;
}

// ─── /save ────────────────────────────────────────────────────────────────────
async function handleSave(text, ctx) {
  console.log('\n  ' + kp('✔ Saved → ') + ab(saveSession(ctx.messages, text.split(/\s+/)[1] || null)));
  ctx.prompt(); return true;
}

// ─── /load ────────────────────────────────────────────────────────────────────
async function handleLoad(ctx) {
  const sessions = listSessions();
  if (!sessions.length) { console.log('\n  ' + ab('No saved sessions.')); ctx.prompt(); return true; }
  sessions.forEach((s, i) => console.log('  ' + ab('[' + (i + 1) + ']') + ' ' + sd(s.name) + '  ' + ab(new Date(s.saved).toLocaleString() + ' · ' + s.count + ' msgs')));
  const ch  = await ctx.ask(cr('\n  ❯ ') + ab('Load [n] or Enter to cancel: '));
  const idx = parseInt(ch.trim()) - 1;
  if (!isNaN(idx) && sessions[idx]) {
    ctx.messages = sessions[idx].messages;
    ctx.msgN     = ctx.messages.filter(m => m.role === 'user').length;
    console.log('\n  ' + kp('✔ Loaded: ') + sd(sessions[idx].name) + ab(' (' + ctx.msgN + ' msgs)'));
  }
  ctx.prompt(); return true;
}

// ─── /export ──────────────────────────────────────────────────────────────────
async function handleExport(ctx) {
  const exportMsgs = ctx.messages.filter(m => m.role !== 'system');
  const timestamp  = new Date().toLocaleString();
  const modelLabel = ctx.modelMeta?.label || ctx.modelMeta?.id || '—';

  const bubblesHtml = exportMsgs.map(m => {
    const isUser    = m.role === 'user';
    const rowClass  = isUser ? 'bubble-row user' : 'bubble-row';
    const bubClass  = isUser ? 'bubble bubble-user' : 'bubble bubble-ai';
    const nameClass = isUser ? 'name-user' : 'name-ai';
    const name      = isUser ? 'You' : '🦈 Megaladon';
    const avatarCls = isUser ? 'avatar avatar-user' : 'avatar avatar-ai';
    const escaped   = m.content.replace(/\\/g, '\\\\').replace(/`/g, '\\`').replace(/\$/g, '\\$');
    return `\n  <div class="${rowClass}">\n    <div class="${avatarCls}">${isUser ? 'U' : '🦈'}</div>\n    <div class="${bubClass}">\n      <div class="bubble-name ${nameClass}">${name}</div>\n      <div class="bubble-md" data-raw="\`${escaped}\`"></div>\n    </div>\n  </div>`;
  }).join('\n');

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>🦈 Megaladon Export</title>
<script src="https://cdnjs.cloudflare.com/ajax/libs/marked/9.1.6/marked.min.js"><\/script>
<script src="https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/highlight.min.js"><\/script>
<link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/styles/github-dark.min.css">
<style>
:root{--bg:#0a0f14;--surface:#111820;--card:#161e28;--border:#1e2d3d;--whale:#1eb4ff;--coral:#ff6b2b;--kelp:#3fc85a;--reef:#ffc83c;--violet:#b96eff;--teal:#3cdcc8;--text:#c9d1d9;--muted:#586069;--white:#e6edf3}
*{box-sizing:border-box;margin:0;padding:0}
body{background:var(--bg);color:var(--text);font-family:'Segoe UI',system-ui,sans-serif;padding-bottom:48px}
.header{background:var(--surface);border-bottom:1px solid var(--border);padding:16px 24px;display:flex;align-items:center;gap:12px;position:sticky;top:0;z-index:10}
.header h1{font-size:17px;font-weight:700;color:var(--whale)}
.header .meta{margin-left:auto;font-size:11px;color:var(--muted)}
.chat-wrap{max-width:820px;margin:0 auto;padding:28px 20px;display:flex;flex-direction:column;gap:20px}
.bubble-row{display:flex;align-items:flex-end;gap:10px}
.bubble-row.user{flex-direction:row-reverse}
.avatar{width:34px;height:34px;border-radius:50%;flex-shrink:0;display:flex;align-items:center;justify-content:center;font-size:14px;font-weight:700}
.avatar-user{background:#0d2233;border:1px solid var(--whale);color:var(--whale)}
.avatar-ai{background:#1a1228;border:1px solid var(--violet);color:var(--violet)}
.bubble{max-width:74%;padding:13px 17px;border-radius:16px;font-size:13.5px;line-height:1.65;word-break:break-word}
.bubble-user{background:#0d2233;border:1px solid #1e3a52;border-bottom-right-radius:4px}
.bubble-ai{background:#1a1228;border:1px solid #2d1e42;border-bottom-left-radius:4px}
.bubble-name{font-weight:700;font-size:11px;margin-bottom:6px;text-transform:uppercase;letter-spacing:.6px}
.name-user{color:var(--whale)}.name-ai{color:var(--violet)}
<\/style>
<\/head>
<body>
<div class="header">
  <span style="font-size:20px">🦈<\/span>
  <h1>Megaladon Chat Export<\/h1>
  <div class="meta">${timestamp} &nbsp;·&nbsp; ${modelLabel} &nbsp;·&nbsp; ${exportMsgs.length} messages<\/div>
<\/div>
<div class="chat-wrap">
${bubblesHtml}
<\/div>
<\/body>
<\/html>`;

  const { BASE_DIR, ensureDir } = require('../../config');
  const exportsDir = path.join(BASE_DIR, 'exports');
  ensureDir(exportsDir);
  const fp = path.join(exportsDir, 'export_' + Date.now() + '.html');
  fs.writeFileSync(fp, html, 'utf8');
  console.log('\n  ' + kp('✔ Exported → ') + ab(fp));
  console.log('  ' + tl('  Open in any browser to view the styled bubble chat'));
  ctx.prompt(); return true;
}

// ─── inline: /tokens, /system, /copy, /reset, /autotest, /autoscan ───────────
async function handleTokensInline(ctx) {
  console.log('\n  ' + ab('Tokens: ') + cr(ctx.totalTok.toLocaleString()) + ab('  Msgs: ') + sd(String(ctx.msgN)));
  ctx.prompt(); return true;
}

async function handleSystem(ctx) {
  console.log('\n  ' + ab('System prompt (' + ctx.mode + '):') + '  ');
  buildSystemPrompt(ctx).split('\n').forEach(l => console.log('  ' + dm(l)));
  ctx.prompt(); return true;
}

async function handleCopy(ctx) {
  if (!ctx.lastReply) console.log('\n  ' + dg('No response yet.'));
  else console.log('\n  ' + (copyClip(ctx.lastReply) ? kp('✔ Copied!') : dg('✘ Clipboard unavailable.')));
  ctx.prompt(); return true;
}

async function handleReset(ctx) {
  const { CONFIG_PATH } = require('../../config');
  if (fs.existsSync(CONFIG_PATH)) fs.unlinkSync(CONFIG_PATH);
  console.log('\n  ' + kp('✔ Config wiped. Restart to reconfigure.'));
  ctx.rl.close(); process.exit(0);
}

async function handleAutoTest(ctx) {
  ctx.autoTest = !ctx.autoTest;
  saveConfig({ provider: ctx.providerKey, apiKey: ctx.apiKey, model: ctx.modelId, mode: ctx.mode, autoTest: ctx.autoTest, autoScan: ctx.autoScan });
  console.log('\n  ' + ab('Auto-Test: ') + (ctx.autoTest ? kp('ON') : ab('OFF')));
  ctx.prompt(); return true;
}

async function handleAutoScan(ctx) {
  ctx.autoScan = !ctx.autoScan;
  saveConfig({ provider: ctx.providerKey, apiKey: ctx.apiKey, model: ctx.modelId, mode: ctx.mode, autoTest: ctx.autoTest, autoScan: ctx.autoScan });
  console.log('\n  ' + ab('Auto-Scan: ') + (ctx.autoScan ? kp('ON') : ab('OFF')));
  ctx.prompt(); return true;
}

module.exports = {
  handleExit,
  handleHelp,
  handleClear,
  handleStats,
  handleSave,
  handleLoad,
  handleExport,
  handleTokensInline,
  handleSystem,
  handleCopy,
  handleReset,
  handleAutoTest,
  handleAutoScan,
  handleHistory,
};

function handleHistory(ctx) {
  const { loadMemory } = require('../config');
  const { ab, wh, sd } = require('../colors');
  const mem = loadMemory();
  const summaries = mem.sessionSummaries || [];
  console.log('\n  ' + wh('📜 Session History'));
  console.log('  ' + '─'.repeat(60));
  if (!summaries.length) {
    console.log('  ' + ab('No past session summaries found.'));
  } else {
    summaries.slice(-10).forEach((s, i) => {
      console.log('  ' + sd('[' + (i + 1) + ']') + ' ' + ab(s.date || '') + ' — ' + (s.summary || ''));
    });
  }
  console.log('');
  return true;
}
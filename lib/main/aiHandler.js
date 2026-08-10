'use strict';



const path = require('path');
const fs   = require('fs');

const { loadConfig, loadMemory, saveMemory, updateMemory } = require('../config');
const { formatMD, spinner, createPhaseTracker } = require('../render');
const { ab, cr, dg, kp, rf, wh, tl, sd }       = require('../colors');
const { selfTestLoop }                           = require('../selftest');
const { MODES }                                  = require('../modes');
const sessionCache = require('../session-cache');
const { playNotification }                       = require('../aug/notify');

// ─── Helpers ──────────────────────────────────────────────────────────────────

// ─── Robust code-fence stripper ──────────────────────────────────────────────────────────────
// Handles all ways AI models malform file content:
//  • ```jsx\n<code>\n```  (normal wrapped)
//  • ```jsx\n<code>\n```\nexport default App;  (code AFTER closing fence)
//  • ```jsx export default App;\n<code>  (code ON fence-open line)
//  • multiple nested fence blocks
function stripCodeFences(raw) {
  if (!raw) return raw;
  let s = raw.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const trimmed = s.trimStart();
  if (!trimmed.startsWith('```')) return s;
  s = trimmed;
  // Parse opening fence: ```<lang> [possible extra code on same line]
  const openMatch = s.match(/^```([^\n]*)\n/);
  if (!openMatch) return s;
  // Extract any real code accidentally placed after the language tag on the fence line
  const extraOnFenceLine = openMatch[1].replace(/^[\w.+\-#/ ]*/, '').trim();
  s = s.slice(openMatch[0].length);
  if (extraOnFenceLine) s = extraOnFenceLine + '\n' + s;
  // Find the LAST closing fence — everything after it is stray code, keep it
  const lastFenceIdx = s.lastIndexOf('\n```');
  if (lastFenceIdx !== -1) {
    const before = s.slice(0, lastFenceIdx);
    const after  = s.slice(lastFenceIdx + 4).replace(/^[^\S\n]*\n/, '');
    s = before + (after.trim() ? '\n' + after : '');
  }
  return s;
}
// safeCmd — rewrites dangerous "kill all node.exe" commands so they spare
// the running Megaladon process (and its parent shell) by excluding our own PID.

function stripCodeFences(code) {
  // Remove opening ```lang and closing ```lang (with or without language tag)
  // Handles: ```js ```jsx ```javascript ```python and plain ``` at start/end
  return code
    .replace(/^```[\w.-]*[\t ]*\r?\n/, '')   // opening fence
    .replace(/\r?\n```[\w.-]*[\t ]*$/, '')   // closing fence
    .replace(/^```[\w.-]*[\t ]*\r?\n/, '')   // double-wrapped opening
    .replace(/\r?\n```[\w.-]*[\t ]*$/, '');  // double-wrapped closing
}
function safeCmd(cmd) {
  const myPid = process.pid;

  if (process.platform === 'win32') {
    // taskkill /F /IM node.exe  →  PowerShell kill excluding our PID
    if (/taskkill\b.*\/IM\s+node\.exe/i.test(cmd)) {
      return (
        `powershell -NoProfile -Command ` +
        `"Get-Process node -ErrorAction SilentlyContinue ` +
        `| Where-Object { $_.Id -ne ${myPid} } ` +
        `| Stop-Process -Force"`
      );
    }
  } else {
    // killall node / pkill node  →  kill only node server.js, spare us
    if (/\b(killall|pkill)\s+(-\w+\s+)*node\b/i.test(cmd)) {
      return `pkill -f "node server\\.js" 2>/dev/null; pkill -f "node client\\.js" 2>/dev/null; true`;
    }
  }
  return cmd;
}

function runShell(cmd) {
  const { execSync } = require('child_process');
  cmd = safeCmd(cmd);
  try {
    const out = execSync(cmd, {
      encoding: 'utf8', timeout: 30_000,
      cwd: process.cwd(), stdio: ['pipe', 'pipe', 'pipe'],
    });
    return { stdout: out, stderr: '', code: 0 };
  } catch (e) {
    return { stdout: e.stdout || '', stderr: e.stderr || e.message, code: e.status || 1 };
  }
}

function parseDirectives(text) {
  const results = { files: [], runs: [], memory: [] };

  // @@FILE: path\n...content...\n@@END
  // Tolerates Windows \r\n, spaces after colon, and blank lines before content
  const fileRe = /@@FILE:\s*([^\r\n]+)\r?\n([\s\S]*?)@@END/g;
  const runRe  = /@@RUN:\s*([^\r\n]+)/g;
  // Accept both @@MEMORY: key=value  AND  @@MEMORY: key: value  (AI sometimes mirrors user's colon format)
  const memRe  = /@@MEMORY:\s*([^=:\r\n][^=:\r\n]*)(?:=|:\s*)([^\r\n]+)/g;

  let m;
  while ((m = fileRe.exec(text)) !== null)
    results.files.push({ path: m[1].trim(), content: m[2] });

  // Deduplicate @@RUN: lines (model sometimes repeats them)
  const seenRuns = new Set();
  while ((m = runRe.exec(text)) !== null) {
    const cmd = m[1].trim();
    if (!seenRuns.has(cmd)) { seenRuns.add(cmd); results.runs.push(cmd); }
  }

  while ((m = memRe.exec(text)) !== null)
    results.memory.push({ key: m[1].trim(), value: m[2].trim() });

  return results;
}

async function executeDirectives(directives, ctx) {
  const lines = [];

  for (const f of directives.files) {
    try {
      const abs = path.isAbsolute(f.path)
        ? f.path
        : path.join(process.cwd(), f.path);
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      // Robust fence stripping handles code-after-fence, code-on-fence-line, etc.
      const fileContent = stripCodeFences(f.content);
      fs.writeFileSync(abs, fileContent, 'utf8');
      const _sc = sessionCache.loadCache();
      sessionCache.recordFile(_sc, abs, fileContent, 'created');
      lines.push('  ' + ab('📄 wrote ') + tl(f.path));
    } catch (e) {
      const _sc2 = sessionCache.loadCache(); sessionCache.recordFile(_sc2, f.path, e.message, 'error');
      lines.push('  ' + rf('✘ write failed: ') + f.path + ' — ' + e.message);
    }
  }

  for (let cmd of directives.runs) {
    // Windows safety: convert Unix background operator & → start /B
    if (process.platform === 'win32') {
      if (/&\s*$/.test(cmd)) {
        cmd = 'start /B ' + cmd.replace(/&\s*$/, '').trim();
      } else {
        // Auto-background bare `node server.js` style commands so they don't hang
        const nodeServerPat = /(^|&&\s*)node\s+\S+\.js\s*$/;
        if (nodeServerPat.test(cmd.trim())) {
          const parts = cmd.split('&&').map(s => s.trim());
          parts[parts.length - 1] = 'start /B ' + parts[parts.length - 1];
          cmd = parts.join(' && ');
        }
      }
    }

    lines.push('  ' + ab('⚡ ') + wh('$ ' + cmd));
    const r = runShell(cmd);
    if (r.stdout.trim())
      lines.push(r.stdout.trim().split('\n').map(l => '    ' + l).join('\n'));
    if (r.stderr.trim())
      lines.push('  ' + rf(r.stderr.trim().split('\n').map(l => '    ' + l).join('\n')));
    if (r.code !== 0)
      lines.push('  ' + rf('  exit ' + r.code));
    // Record command outcome in session cache
    const _sc3 = sessionCache.loadCache();
    sessionCache.recordCommand(_sc3, cmd, r.code, r.stderr);
  }

  if (directives.memory.length > 0) {
    const mem = loadMemory();
    if (!mem.facts) mem.facts = {};
    for (const { key, value } of directives.memory) {
      updateMemory(mem, [{ key, value }]);
      lines.push('  ' + ab('💾 memory: ') + sd(key) + ' = ' + tl(value));
    }
    try { saveMemory(mem); } catch (_) {}
    if (ctx && ctx.mem) ctx.mem.facts = mem.facts;
  }

  return lines.join('\n');
}

// ─── System prompt ────────────────────────────────────────────────────────────

function buildSystemPrompt(ctx) {
  const mem = ctx.mem || loadMemory();

  const memLines = Object.entries(mem?.facts || {})
    .map(([k, v]) => `- ${k}: ${v}`).join('\n');

  const skillLines = (ctx.skills || [])
    .map(s => `- ${s.name}: ${s.description || ''}`).join('\n');

  const isAgent = (ctx.mode || 'code') === 'agent';
  const platform = process.platform;
  const bgCmd = platform === 'win32' ? 'start /B node server.js' : 'node server.js &';

  const directiveBlock = [
    '╔══════════════════════════════════════════════════════════╗',
    '║  FILE CREATION — YOU MUST USE THIS FORMAT EXACTLY       ║',
    '╚══════════════════════════════════════════════════════════╝',
    '',
    'To write a file — START YOUR RESPONSE with this (no prose before it):',
    '@@FILE: relative/path/filename.js',
    '// full file content — no truncation, no placeholders, no "// rest of file"',
    '@@END',
    '',
    'To run a shell command after writing files:',
    '@@RUN: node client.js list',
    '',
    'To save a memory fact:',
    '@@MEMORY: key=value',
    '',
    'ABSOLUTE RULES — VIOLATION = BROKEN OUTPUT:',
    '1. @@FILE: / @@END is the ONLY way to write files. NEVER use markdown code blocks for files.',
    '2. Every @@FILE: block MUST contain COMPLETE file content. No "..." or "// TODO" or truncation.',
    '3. @@FILE: path must be relative (e.g. client.js  NOT /absolute/path/client.js).',
    '4. After writing files, add @@RUN: lines if execution is needed.',
    `5. To start a background server on this platform (${platform}): @@RUN: ${bgCmd}`,
    `6. To stop the server on this platform — Windows: @@RUN: powershell -Command "Get-Process node | Where-Object { $_.Id -ne ${process.pid} } | Stop-Process -Force"   Linux/Mac: @@RUN: pkill -f "node server.js"`,
    '7. NEVER use "taskkill /F /IM node.exe" or "killall node" — those kill ALL node processes including Megaladon itself.',
    '8. You MAY chain multiple @@FILE: and @@RUN: blocks in one reply.',
    '9. If a file is large, write it in full — do NOT skip lines.',
    '10. NEVER output a markdown ```code block``` when creating a file. Use @@FILE: instead.',
  ].join('\n');

  const agentExtra = isAgent ? [
    '',
    '╔══════════════════════════════════════════════════════════╗',
    '║  AGENT MODE — AUTONOMOUS EXECUTION                      ║',
    '╚══════════════════════════════════════════════════════════╝',
    'You are in AGENT mode. Rules:',
    '  • Write ALL requested files immediately using @@FILE:/@@END — NOT markdown blocks.',
    '  • Begin your response with the first @@FILE: block. No preamble.',
    '  • Execute ALL requested shell commands using @@RUN:',
    '  • Complete the ENTIRE task autonomously. Do not ask clarifying questions.',
    '  • After all @@FILE: and @@RUN: blocks, write a 2-line plain-text summary.',
    '  • If the user says "no npm" or "only built-ins", use ONLY Node.js core modules (http, fs, path, etc.). Do NOT require axios, express, or any npm package.',
    '  • CLI scripts MUST include a process.argv handler at the bottom so `node script.js <cmd>` works directly.',
  ].join('\n') : '';

  return [
    'You are Megaladon 🦈 — an elite AI coding assistant with a self-testing brain, persistent memory, and skills system.',
    'You were built by CVAKI. You are NOT Claude, GPT, Gemini, Qwen, or any generic AI model.',
    'If anyone asks who you are, what you are, or who made you: always say you are Megaladon, built by CVAKI.',
    'Never mention Anthropic, OpenAI, Groq, Ollama, Qwen, or any underlying model/provider in your identity.',
    '',
    '── MODE BEHAVIOR (' + (ctx.mode || 'code').toUpperCase() + ') ──────────────────────────────────────────',
    MODES[ctx.mode || 'code']?.prompt || MODES.code.prompt,
    '─────────────────────────────────────────────────────────────────────',
    '',
    directiveBlock,
    agentExtra,
    '',
    `Current mode: ${ctx.mode || 'code'}`,
    `Working directory: ${process.cwd()}`,
    `Platform: ${platform}`,
    ctx.folderCtx  ? `\nProject context:\n${ctx.folderCtx}` : '',
    skillLines     ? `\nLoaded skills:\n${skillLines}` : '',
    memLines       ? `\nMemory:\n${memLines}` : '',
    (() => { try { const sc = sessionCache.loadCache(); const sctx = sessionCache.buildSessionContext(sc); return sctx ? '\n' + sctx : ''; } catch(_) { return ''; } })(),
  ].filter(Boolean).join('\n');
}

// ─── Request Amplifier ─────────────────────────────────────────────────────────────
// Detects short "build/create" requests and injects detailed requirements so
// the model generates large, production-grade, fully-featured code.
function amplifyRequest(text, ctx) {
  const lower = text.toLowerCase();

  // Only amplify if the request looks like a creative/build prompt
  const isBuildRequest = (
    /\b(create|build|make|generate|write|design|develop)\b/.test(lower) &&
    /\b(html|css|page|website|site|app|component|ui|landing|portfolio|dashboard|template|form|card|navbar|menu)\b/.test(lower)
  );
  const isEditRequest = (
    /\b(improve|update|fix|change|edit|modify|refactor|better|nicer|modern|beautiful|apple|like.*website|redesign|redo|restyle|upgrade|enhance|color|colour|design)\b/.test(lower) &&
    /\b(html|css|page|website|design|color|colour|look|style|ui|the.*code|the.*file|the.*page)\b/.test(lower)
  );

  if (!isBuildRequest && !isEditRequest) return text;  // pass through unchanged

  const isHTML = /\b(html|page|website|site|landing|portfolio|dashboard|template)\b/.test(lower);

  if (isHTML) {
    const appleStyle = /apple|minimal|clean|white|cupertino/.test(lower);
    const darkStyle  = /dark|night|black|neon|cyber/.test(lower);
    const colorPalette = appleStyle
      ? 'Apple-style: pure white (#ffffff) and off-white (#f5f5f7) backgrounds, SF Pro-like system fonts, crisp black text (#1d1d1f), subtle blue accents (#0071e3), generous whitespace, very subtle shadows, no gradients on primary surfaces.'
      : darkStyle
      ? 'Dark theme: deep navy/charcoal backgrounds (#0a0a14 to #1a1a2e), neon accent colors, glowing shadows, glass cards.'
      : 'Modern gradient theme: deep hero gradient (e.g. #1a1a2e \u2192 #16213e \u2192 #0f3460), vivid accent color (#e94560 or similar), frosted glass cards (backdrop-filter: blur), white text on dark areas.';

    return `${text}

[MEGALADON AGENT SPEC \u2014 MANDATORY REQUIREMENTS]
You MUST produce a single, complete, self-contained HTML file saved as @@FILE: index.html.
Minimum target: 700 lines of code. This is non-negotiable.
Do NOT truncate. Do NOT stop early. Write the FULL file.

REQUIRED SECTIONS (include all of them):
1. <head>: charset, viewport, title, Google Fonts import (Inter or Poppins), all styles inline in <style>.
2. Sticky navbar: logo/brand name on left, nav links on right, transparent with blur backdrop, becomes solid on scroll (JS scroll listener). Mobile hamburger menu with CSS-animated toggle.
3. Hero section: full-viewport-height, centered headline + subheadline + CTA button. Background: ${colorPalette} Animated floating shapes or subtle particle/blob animation using CSS keyframes.
4. Features/Services section: grid of 3\u20136 cards. Each card: icon (Unicode emoji or inline SVG), heading, description, hover lift effect (transform: translateY + box-shadow).
5. About/Stats section: horizontal stats bar (e.g., "500+ clients \u2022 10 years \u2022 99% satisfaction"), with countup animation on scroll.
6. Testimonials or Portfolio section: card carousel or grid with 3+ items, subtle border, avatar circles.
7. Contact/CTA section: full-width with gradient background, headline, email input + button.
8. Footer: multi-column layout, social links (Twitter/X, GitHub, LinkedIn \u2014 as text links), copyright, subtle top border.

STYLING REQUIREMENTS:
- CSS custom properties (--primary, --secondary, --accent, --bg, --text, --card-bg, --border, --shadow) defined in :root.
- Smooth scroll: html { scroll-behavior: smooth; }
- Intersection Observer JS: elements fade/slide in when scrolled into view (class .reveal that transitions opacity 0\u21921 and translateY 30px\u21920).
- All transitions: 0.3\u20130.5s ease.
- Responsive: @media (max-width: 768px) and @media (max-width: 480px) breakpoints.
- Buttons: gradient background, border-radius: 50px, padding: 14px 36px, hover scale(1.05).

JAVASCRIPT (inline <script> at bottom of <body>):
- Hamburger menu toggle.
- Navbar scroll effect (add .scrolled class).
- Intersection Observer for .reveal elements.
- Countup animation for stat numbers.
- (Optional) Smooth typewriter effect on hero headline.

Now write the COMPLETE index.html. Do not abbreviate. Do not use placeholders. Write every line.`;
  }

  // For non-HTML build requests, add a general quality amplifier
  return `${text}

[MEGALADON AGENT SPEC \u2014 MANDATORY]
Write the COMPLETE, production-ready implementation. No placeholders, no TODOs, no truncation.
Target: comprehensive, fully-featured code. Include full error handling, comments, and edge cases.
Do not stop early. Keep writing until the implementation is genuinely complete.`;
}

// ─── Provider call with retry ─────────────────────────────────────────────────

async function callProvider(ctx, messages, retries = 3) {
  const cfg      = loadConfig();
  const provKey  = ctx.providerKey || cfg.provider || 'anthropic';
  const model    = ctx.modelId     || cfg.model    || 'claude-opus-4-20250514';
  const apiKey   = ctx.apiKey      || cfg.apiKey   || '';
  const maxTok   = ctx.maxTokens   || cfg.maxTokens || 4096;

  let lastErr;

  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      if (attempt > 1) {
        // Wait 2s between retries
        await new Promise(r => setTimeout(r, 2000));
        process.stdout.write('\r  ' + ab('⟳ retrying... (attempt ' + attempt + '/' + retries + ')') + '   ');
      }

      if (provKey === 'anthropic') {
        if (!apiKey) throw new Error('No API key. Run `megaladon --setup`.');
        const sysMsg   = messages.find(m => m.role === 'system');
        const chatMsgs = messages.filter(m => m.role !== 'system');
        const res = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: {
            'Content-Type':      'application/json',
            'x-api-key':         apiKey,
            'anthropic-version': '2023-06-01',
          },
          body: JSON.stringify({
            model, max_tokens: maxTok,
            system:   sysMsg?.content || '',
            messages: chatMsgs,
            stream:   false,
          }),
        });
        if (!res.ok) throw new Error(`Anthropic ${res.status}: ${await res.text()}`);
        const data = await res.json();
        if (ctx) ctx.totalTok = (ctx.totalTok || 0) +
          (data.usage?.input_tokens || 0) + (data.usage?.output_tokens || 0);
        return data.content?.[0]?.text || '';
      }

      if (provKey === 'ollama') {
        const base = process.env.OLLAMA_HOST || 'http://localhost:11434';
        const res  = await fetch(`${base}/api/chat`, {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify({ model, messages, stream: false, options: { num_predict: maxTok } }),
        });
        if (!res.ok) throw new Error(`Ollama ${res.status}: ${await res.text()}`);
        const data = await res.json();
        return data.message?.content || '';
      }

      // OpenRouter / Groq / NVIDIA NIM — all OpenAI-compatible chat/completions
      const URLS = {
        openrouter: 'https://openrouter.ai/api/v1/chat/completions',
        groq:       'https://api.groq.com/openai/v1/chat/completions',
        nvidia:     'https://integrate.api.nvidia.com/v1/chat/completions',
      };
      const url = URLS[provKey];
      if (!url) throw new Error(`Unknown provider: ${provKey}`);
      const res = await fetch(url, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
        body:    JSON.stringify({ model, messages, max_tokens: maxTok }),
      });
      if (!res.ok) throw new Error(`${provKey} ${res.status}: ${await res.text()}`);
      const data = await res.json();
      if (ctx) ctx.totalTok = (ctx.totalTok || 0) + (data.usage?.total_tokens || 0);
      return data.choices?.[0]?.message?.content || '';

    } catch (err) {
      lastErr = err;
      if (attempt < retries) continue;
    }
  }

  throw lastErr;
}

// ─── handleAiMessage ──────────────────────────────────────────────────────────
//
// Called by lib/main/index.js as: await handleAiMessage(text, ctx)

async function handleAiMessage(text, ctx) {
  if (!ctx || !ctx.prov) {
    console.log('\n  ' + rf('✘ Provider not ready. Run `megaladon --setup`.'));
    return;
  }

  if (!Array.isArray(ctx.messages)) ctx.messages = [];

  const tracker = createPhaseTracker(7);
  const tw      = Math.min((process.stdout.columns || 80) - 4, 100);
  console.log('\n  ' + ab('─'.repeat(tw)));

  // ── Phase 1: Tokenization ────────────────────────────────────────────────
  tracker.start(1, 'Tokenizing intent');
  if (ctx.mode) tracker.note(1, 'mode: ' + ctx.mode);
  tracker.done(1);

  // ── Phase 2: Context assembly ─────────────────────────────────────────────
  tracker.start(2, 'Assembling context');
  const mem       = ctx.mem || loadMemory();
  const factCount = Object.keys(mem?.facts || {}).length;
  const skillCount= (ctx.skills || []).length;
  tracker.note(2, [
    factCount  ? factCount  + ' memory facts' : null,
    skillCount ? skillCount + ' skills'       : null,
    ctx.folderCtx ? 'folder context loaded'  : null,
  ].filter(Boolean).join(' · ') || 'no extra context');

  const systemPrompt = buildSystemPrompt(ctx);

  // ── Request Amplifier ─────────────────────────────────────────────────────
  // Detects brief "build/create" prompts and expands them into detailed specs
  // so the model writes comprehensive, production-grade output.
  const amplifiedText = amplifyRequest(text, ctx);

  ctx.messages.push({ role: 'user', content: amplifiedText });
  if (ctx.messages.length > 80) ctx.messages.splice(0, ctx.messages.length - 80);
  ctx.msgN = (ctx.msgN || 0) + 1;
  if (ctx.statusRef) ctx.statusRef.msgCount = ctx.msgN;
  tracker.done(2);

  // ── Phase 3: Provider call ────────────────────────────────────────────────
  const cfg     = loadConfig();
  const provKey = ctx.providerKey || cfg.provider || 'anthropic';
  const modelId = ctx.modelId     || cfg.model    || '';
  tracker.start(3, 'Calling ' + provKey);
  tracker.note(3, (provKey === 'ollama' ? 'local · ' : '') + (modelId || 'default model') + ' · max_tokens: ' + (ctx.maxTokens || cfg.maxTokens || 4096).toLocaleString());

  // ── Activity labels per mode — what the model is likely doing at each second ─
  const ACTIVITY = {
    agent: [
      [0,  'reading your request'],
      [3,  'understanding the task'],
      [8,  'planning file structure'],
      [15, 'writing code'],
      [30, 'building full implementation'],
      [60, 'generating output'],
      [90, 'finalizing files'],
    ],
    code: [
      [0,  'reading your question'],
      [4,  'thinking through solution'],
      [12, 'writing the code'],
      [30, 'reviewing the logic'],
      [60, 'finalizing response'],
    ],
    debug: [
      [0,  'reading the error'],
      [3,  'tracing the issue'],
      [8,  'identifying root cause'],
      [18, 'building the fix'],
      [40, 'verifying solution'],
    ],
    architect: [
      [0,  'reading the requirements'],
      [4,  'designing the system'],
      [12, 'planning architecture'],
      [25, 'detailing components'],
      [50, 'writing diagrams'],
    ],
    review: [
      [0,  'reading the code'],
      [4,  'analysing quality'],
      [10, 'checking edge cases'],
      [20, 'writing feedback'],
    ],
    explain: [
      [0,  'reading the topic'],
      [4,  'building explanation'],
      [12, 'adding examples'],
      [25, 'simplifying language'],
    ],
    plan: [
      [0,  'reading the goal'],
      [4,  'breaking down tasks'],
      [12, 'ordering priorities'],
      [25, 'writing the plan'],
    ],
  };

  function getActivityLabel(mode, elapsedSec) {
    const steps = ACTIVITY[mode] || ACTIVITY.code;
    let label = steps[0][1];
    for (const [sec, lbl] of steps) {
      if (elapsedSec >= sec) label = lbl; else break;
    }
    return label;
  }

  let reply = '';
  const t0  = Date.now();

  // ── Live spinner — label updates every 80ms based on elapsed time ────────
  const spin = spinner(getActivityLabel(ctx.mode || 'code', 0), ctx.mode);

  // Separate interval to update the label as time progresses
  const labelIv = setInterval(() => {
    const sec = Math.floor((Date.now() - t0) / 1000);
    spin.update(getActivityLabel(ctx.mode || 'code', sec));
  }, 500);

  try {
    reply = await callProvider(ctx, [
      { role: 'system', content: systemPrompt },
      ...ctx.messages,
    ]);
  } catch (err) {
    clearInterval(labelIv);
    spin.stop();
    tracker.fail(3, err.message);
    ctx.messages.pop();
    return;
  }
  clearInterval(labelIv);
  spin.stop();
  const elapsed3 = ((Date.now() - t0) / 1000).toFixed(1) + 's';
  tracker.done(3, elapsed3);

  // ── Phase 4: Thinking / parsing ────────────────────────────────────────────
  tracker.start(4, 'Parsing AI response');
  ctx.messages.push({ role: 'assistant', content: reply });
  ctx.lastReply = reply;
  tracker.done(4);

  // ── Phase 5: Code generation / directive extraction ───────────────────────
  tracker.start(5, 'Extracting files & commands');
  let directives = parseDirectives(reply);

  // ── Markdown fallback — local models that ignore @@FILE: ─────────────────
  // Three patterns, tried in order, to catch how different models reference files.
  if (directives.files.length === 0) {

    // Pattern 1: filename in text IMMEDIATELY BEFORE the code block
    // Catches: "Save as `client.js`", "### client.js", "Create client.js then..."
    const beforeBlockRe = /(?:###?\s*|`{1,3}|[Ss]ave (?:it )?as\s+|[Cc]reate\s+|[Ff]ile(?:name)?[:\s]+)([a-zA-Z0-9_.\/\\-]+\.[a-z]{1,6})[`\s]*\n*```(?:[a-z]*)\n([\s\S]*?)```/gi;
    let bm;
    while ((bm = beforeBlockRe.exec(reply)) !== null) {
      const fpath = bm[1].trim().replace(/\\/g, '/');
      if (!fpath.includes(' ') && fpath.length < 120)
        directives.files.push({ path: fpath, content: bm[2] });
    }

    // Pattern 2: filename as first-line comment INSIDE the code block
    // Catches: ```js\n// client.js\n...``` or ```\n# server.py\n...```
    if (directives.files.length === 0) {
      const codeBlockRe = /```(?:[a-z]*)\n([\s\S]*?)```/g;
      let cm;
      while ((cm = codeBlockRe.exec(reply)) !== null) {
        const blockContent = cm[1];
        const firstLine = blockContent.match(/^(?:\/\/|#|<!--)\s*([a-zA-Z0-9_.\/\\-]+\.[a-z]{1,6})\s*(?:-->)?\r?\n/);
        if (firstLine) {
          const fpath = firstLine[1].trim().replace(/\\/g, '/');
          if (!fpath.includes(' ') && fpath.length < 80) {
            const contentWithoutComment = blockContent.slice(firstLine[0].length);
            directives.files.push({ path: fpath, content: contentWithoutComment });
          }
        }
      }
    }

    // Pattern 3: filename anywhere in the ~400 chars before each code block
    // Catches prose like "The following client.js handles..." then code block
    if (directives.files.length === 0) {
      const splitParts = reply.split(/(```[a-z]*\n[\s\S]*?```)/g);
      for (let pi = 1; pi < splitParts.length; pi += 2) {
        const block      = splitParts[pi];
        const beforeText = splitParts[pi - 1] || '';
        const contentM   = block.match(/```[a-z]*\n([\s\S]*?)```/);
        if (!contentM) continue;
        const blockContent = contentM[1];
        const nameM =
          beforeText.slice(-400).match(/`([a-zA-Z0-9_.\/\\-]+\.[a-z]{1,6})`[^`\n]{0,60}$/) ||
          beforeText.slice(-300).match(/\b([a-zA-Z0-9_.\/\\-]+\.(?:js|ts|py|php|rb|go|rs|java|cpp|c|html|css|json|yaml|yml|sh|cmd|bat|ps1|md|txt))\b[^.\n]{0,80}$/i);
        if (nameM) {
          const fpath = nameM[1].replace(/\\/g, '/');
          if (!directives.files.some(f => f.path === fpath))
            directives.files.push({ path: fpath, content: blockContent });
        }
      }
    }

    if (directives.files.length > 0)
      tracker.note(5, '⟳ auto-extracted ' + directives.files.length + ' file(s) from markdown (model ignored @@FILE: format)');
  }

  const hasWork = directives.files.length > 0 ||
                  directives.runs.length  > 0 ||
                  directives.memory.length > 0;
  tracker.done(5, hasWork
    ? directives.files.length + ' file(s)  ·  ' + directives.runs.length + ' command(s)'
    : 'chat response — no files');

  // ── Phase 6: Self-test loop ───────────────────────────────────────────────
  if (hasWork) {
    tracker.start(6, 'Executing & self-testing');

    // Mark agent task as active so autoDetect won't switch mode on follow-ups
    if (directives.files.length > 0 && ctx) ctx.agentTaskActive = true;

    const appliedFiles = [];

    // Write files
    for (const f of directives.files) {
      try {
        const abs = path.isAbsolute(f.path)
          ? f.path
          : path.join(process.cwd(), f.path);
        fs.mkdirSync(path.dirname(abs), { recursive: true });
        fs.writeFileSync(abs, f.content, 'utf8');
        const lineCount = f.content.split('\n').length;
        tracker.sub(6, 'file', f.path + ' · ' + lineCount + ' lines');
        appliedFiles.push({ path: f.path, full: abs, ok: true });
      } catch (e) {
        tracker.sub(6, 'fail', 'write failed: ' + f.path + ' — ' + e.message);
      }
    }

    // Run shell commands
    for (let cmd of directives.runs) {
      if (process.platform === 'win32') {
        if (/&\s*$/.test(cmd)) {
          cmd = 'start /B ' + cmd.replace(/&\s*$/, '').trim();
        } else {
          const nodeServerPat = /(^|&&\s*)node\s+\S+\.js\s*$/;
          if (nodeServerPat.test(cmd.trim())) {
            const parts = cmd.split('&&').map(s => s.trim());
            parts[parts.length - 1] = 'start /B ' + parts[parts.length - 1];
            cmd = parts.join(' && ');
          }
        }
      }
      tracker.sub(6, 'run', cmd);
      const r = runShell(cmd);
      if (r.stdout.trim()) tracker.sub(6, 'info', r.stdout.trim().split('\n')[0].slice(0, 80));
      if (r.code !== 0 && r.stderr.trim()) tracker.sub(6, 'fail', r.stderr.trim().split('\n')[0].slice(0, 80));
    }

    // Save memory
    if (directives.memory.length > 0) {
      const m = loadMemory();
      if (!m.facts) m.facts = {};
      for (const { key, value } of directives.memory) {
        updateMemory(m, [{ key, value }]);
        tracker.sub(6, 'info', '💾 memory: ' + key + ' = ' + value);
      }
      try { saveMemory(m); } catch (_) {}
      if (ctx && ctx.mem) Object.assign(ctx.mem, m);
    }

    // Live self-test
    if (ctx.autoTest !== false && appliedFiles.length > 0) {
      tracker.sub(6, 'wait', 'running live self-test on created files…');

      // Spinner while self-test runs
      const testSpin = spinner('running tests', ctx.mode);
      let testAttempt = 0;
      const testLabelIv = setInterval(() => {
        const labels = ['running tests', 'checking output', 'verifying logic', 'reading errors', 'applying fix'];
        testSpin.update(labels[testAttempt % labels.length]);
        testAttempt++;
      }, 2000);

      try {
        const tr = await selfTestLoop(
          ctx.providerKey || cfg.provider,
          ctx.apiKey      || cfg.apiKey,
          ctx.modelId     || cfg.model,
          ctx.messages,
          appliedFiles,
          3
        );
        clearInterval(testLabelIv);
        testSpin.stop();
        if (tr.tested) {
          if (tr.passed) {
            const preview = tr.output ? tr.output.trim().split('\n')[0].slice(0, 70) : '';
            tracker.sub(6, 'pass', 'self-test PASSED' + (preview ? ' — ' + preview : ''));
          } else {
            tracker.sub(6, 'fail', 'self-test FAILED after ' + tr.iterations + ' attempt(s)');
            if (tr.error) {
              tr.error.split('\n').slice(0, 3).forEach(l => tracker.sub(6, 'info', l.slice(0, 80)));
            }
          }
        } else {
          tracker.sub(6, 'info', 'no testable files found');
        }
      } catch (testErr) {
        clearInterval(testLabelIv);
        testSpin.stop();
        tracker.sub(6, 'fail', 'test error: ' + testErr.message.slice(0, 80));
      }
    }

    tracker.done(6);

  } else {
    tracker.start(6, 'Self-test loop');
    tracker.note(6, 'skipped — chat response, no files created');
    tracker.done(6);
  }

  // ── Phase 7: Response assembly ────────────────────────────────────────────
  tracker.start(7, 'Assembling response');
  const display = reply
    .replace(/@@FILE:\s*[^\r\n]+\r?\n[\s\S]*?@@END/g, '')
    .replace(/@@RUN:\s*[^\r\n]+/g, '')
    .replace(/@@MEMORY:\s*[^\r\n]+/g, '')
    .trim();
  tracker.done(7);

  // ── Summary ───────────────────────────────────────────────────────────────
  tracker.finish({
    provider: provKey === 'ollama' ? 'Ollama (local)' : provKey,
    model:    modelId || undefined,
    tokens:   ctx.totalTok || undefined,
    elapsed:  elapsed3,
  });

  if (display) console.log(formatMD(display));
  console.log('');

  // ── Notification — play audio chime when AI finishes any response ─────────
  playNotification();

  // ── WA Notification — send terminal work summary to owner ─────────────────
  if (hasWork && (directives.files.length + directives.runs.length > 0)) {
    try {
      const waPath = require('path').resolve(__dirname, '../../connections/whatsapp/index.js');
      if (require('fs').existsSync(waPath)) {
        const { sendToOwner } = require(waPath);
        if (typeof sendToOwner === 'function') {
          const lines = [
            '🦈 *Terminal work done*',
            '',
            ...directives.files.map(f => '📄 `' + f.path + '`'),
            ...directives.runs.map(r  => '⚡ `' + r + '`'),
            ...directives.memory.map(m => '💾 ' + m.key + ' = ' + m.value),
            '',
            '✅ All phases complete',
          ].filter(l => l !== undefined);
          sendToOwner(lines.join('\n')).catch(() => {});
        }
      }
    } catch (_) {}
  }
}

module.exports = { handleAiMessage };
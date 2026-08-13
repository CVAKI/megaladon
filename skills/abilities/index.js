'use strict';

/**
 * skills/abilities/index.js
 *
 * Dispatcher for Megaladon's "Abilities" skill: real screen vision,
 * mouse control, and keyboard control, driven by @@ABILITY: directives
 * emitted by the AI — the same style as @@FILE / @@RUN / @@MEMORY.
 *
 *   @@ABILITY:<namespace.action>
 *   {"json":"args"}
 *   @@END
 *
 * This module is fully standalone — require('./skills/abilities') and
 * call runAllAbilities()/runAbility() directly works with zero changes
 * to the rest of Megaladon. See README.md for the 3 optional edits that
 * make the AI emit @@ABILITY: directives automatically.
 */

const path = require('path');
const { execSync } = require('child_process');

// ─── Auto-install on first require (mirrors lib/connections.js pattern) ───────
function ensureDeps() {
  try {
    require.resolve('@nut-tree-fork/nut-js');
    require.resolve('screenshot-desktop');
    return true;
  } catch (_) {
    try {
      console.log('[abilities] first run — installing dependencies (@nut-tree-fork/nut-js, screenshot-desktop)...');
      execSync('npm install', { cwd: __dirname, stdio: 'inherit' });
      // Clear require cache for the two packages so the fresh install is picked up
      return true;
    } catch (e) {
      console.error('[abilities] auto-install failed — run manually: cd skills/abilities && npm install\n  ' + e.message);
      return false;
    }
  }
}
ensureDeps();

const mouseControl    = require('./mousecontrol');
const keyboardControl = require('./keyboardcontrol');
const monitorScreen   = require('./monitorscreen');
const ollamaSetup     = require('./ollamaSetup');

// ─── system.* — open a URL or app by name ─────────────────────────────────────
// Added because the model had no reliable way to "open the browser" — it
// kept guessing OS-specific shell syntax and writing it as a markdown code
// fence (never executed) instead of a real @@RUN: line. One dedicated
// ability with fixed, correct per-platform commands removes that guesswork
// entirely — the model just needs to know this ability exists.
function openUrl(url) {
  if (typeof url !== 'string' || !url.trim()) throw new Error('system.openUrl requires a url');
  const target = /^https?:\/\//i.test(url) ? url : 'https://' + url;
  const platform = process.platform;
  const cmd = platform === 'win32'
      ? 'start "" "' + target + '"'
      : platform === 'darwin'
          ? 'open "' + target + '"'
          : 'xdg-open "' + target + '"';
  execSync(cmd, { stdio: 'ignore', shell: true });
  return { opened: target };
}

function openApp(name) {
  if (typeof name !== 'string' || !name.trim()) throw new Error('system.openApp requires a name');
  const platform = process.platform;
  const cmd = platform === 'win32'
      ? 'start "" "' + name + '"'
      : platform === 'darwin'
          ? 'open -a "' + name + '"'
          : (name.toLowerCase().includes('.') ? name : name.toLowerCase()); // best-effort on linux
  execSync(cmd, { stdio: 'ignore', shell: true });
  return { opened: name };
}

// ─── System prompt block — append this to the AI's system prompt ─────────────
const ABILITIES_PROMPT = `
## Desktop Abilities (real mouse / keyboard / screen control)

You can control the actual desktop like a human, using @@ABILITY: directives.
These are executed for real: the mouse physically moves and clicks, keys
actually press, and screen descriptions come from a live screenshot analysed
by a local vision model. This is NOT a simulation.

Format (must match exactly — one action per block):
@@ABILITY:<namespace.action>
{"...json args..."}
@@END

Available abilities:
- @@ABILITY:system.openUrl      {"url":"https://www.google.com/imghp"}   (opens the URL in the default browser — use this, NEVER a shell command or code fence, to open a browser/website)
- @@ABILITY:system.openApp      {"name":"notepad"}                       (launches a desktop app by name)
- @@ABILITY:mouse.moveTo        {"x":500,"y":300}
- @@ABILITY:mouse.click         {"x":500,"y":300,"button":"left"}   (button: left|right|middle, omit x/y to click at current position)
- @@ABILITY:mouse.doubleClick   {"x":500,"y":300}
- @@ABILITY:mouse.scroll        {"direction":"down","amount":5}     (direction: up|down|left|right)
- @@ABILITY:mouse.drag          {"fromX":100,"fromY":100,"toX":400,"toY":400}
- @@ABILITY:keyboard.type       {"text":"hello world"}
- @@ABILITY:keyboard.press      {"key":"enter"}                     (key names: enter,tab,esc,backspace,space,up,down,left,right,ctrl,alt,shift,cmd,f1-f12,a-z,0-9,home,end,pageup,pagedown)
- @@ABILITY:keyboard.combo      {"keys":["ctrl","c"]}
- @@ABILITY:screen.describe     {"prompt":"what is currently on screen?"}   (prompt is optional)
- @@ABILITY:screen.watch.start  {"instruction":"alert if any graph turns red or shows an error state","intervalMs":30000}
- @@ABILITY:screen.watch.stop   {}

screen.describe ALWAYS returns, after the prose description, a list of lines like:
  ELEMENT: Google search bar AT (412,188)
  ELEMENT: first image thumbnail AT (240,510)
These are real pixel coordinates for this screen's actual resolution. When you need to click
something, use the (x,y) from the matching ELEMENT line — NEVER invent your own coordinates
(e.g. never guess something like x:100,y:100 "roughly the middle"). If the element you need
isn't in the list, call screen.describe again with a prompt asking specifically about it, or
scroll first, rather than clicking a guess.

CRITICAL RULE — ACT, DO NOT EXPLAIN:
When a request asks you to actually do something on the desktop (open a site, click something,
type something, download something), you MUST perform it for real using @@ABILITY:/@@RUN:
directives. Do NOT respond with numbered instructions telling the person how they would do it
themselves, and NEVER put a shell command inside a markdown \`\`\`code block\`\`\` — a code block
is never executed. If you are not going to act (e.g. genuinely ambiguous request), ask ONE
short clarifying question instead of writing a how-to guide.

OVERRIDE — THIS APPLIES REGARDLESS OF CURRENT MODE (including Agent and Code mode):
If the request only needs a desktop action (@@ABILITY), a web search (@@SEARCH), or an email
action (@@EMAIL) — and does NOT require creating or editing any project file — do NOT write an
@@FILE: block, do NOT say "I can't perform that action," and do NOT refuse. This overrides any
earlier instruction in this prompt telling you to always begin your response with @@FILE: or to
treat every request as a coding/file task. A request like "take a screenshot" or "click the
search bar" is fully satisfied by emitting the relevant @@ABILITY: directive(s) alone.

Rules:
- Always emit @@ABILITY:screen.describe BEFORE clicking or typing blind, so you know real
  current coordinates — never guess pixel positions without having described the screen first
  in this conversation.
- Multi-step tasks (e.g. "search the web for cute dogs and download the first image"):
  1) system.openUrl to open the browser at the right page (e.g. google.com/imghp)
  2) screen.describe to find the search bar's real coordinates
  3) mouse.click on the search bar
  4) keyboard.type the query, then keyboard.press "enter"
  5) screen.describe again to find the first result's real coordinates
  6) mouse.click (or right-click for a save-image flow) on that result
  7) screen.describe again to find the next element (e.g. "Save image as" in a context menu)
  8) repeat click → screen.describe until the task is actually complete
- One ability per @@ABILITY block. Emit multiple blocks in sequence for multi-step actions —
  you will receive each result (e.g. "click landed at x,y" / a screen description with ELEMENT
  coordinates) fed back to you automatically before you decide the next step.
- screen.watch.start begins a background poll loop — use it for "monitor this dashboard and
  tell me if X happens" style requests, then respond to triggered events as they come back.
`.trim();

// ─── Directive parser ──────────────────────────────────────────────────────────
// Deliberately tolerant of format drift from smaller local models. The
// strict version of this parser (action name, MANDATORY newline, JSON args,
// MANDATORY literal @@END) silently dropped perfectly good directives like
//   @@ABILITY:system.openUrl {"url":"https://..."}
// written all on one line with no @@END — which is exactly what caused
// Phase 6 to report "skipped" even though the model had done the right
// thing. This version accepts either the multi-line @@END style OR a
// same-line inline-JSON style, with @@END fully optional, and balances
// braces/quotes properly so nested args (e.g. {"keys":["ctrl","c"]}) work.
function parseAbilityDirectives(text) {
  if (typeof text !== 'string') return [];
  const out = [];
  const marker = '@@ABILITY:';
  let idx = 0;

  while (true) {
    const start = text.indexOf(marker, idx);
    if (start === -1) break;

    let cursor = start + marker.length;
    const actionMatch = /^\s*([a-zA-Z_][a-zA-Z0-9_.]*)/.exec(text.slice(cursor));
    if (!actionMatch) { idx = cursor; continue; } // no valid action name — skip past marker, keep scanning

    const action = actionMatch[1];
    cursor += actionMatch[0].length;

    // Skip whitespace (spaces or a newline) up to the next non-space char.
    let j = cursor;
    while (j < text.length && /\s/.test(text[j])) j++;

    let args = {};
    let argsEnd = cursor;

    if (text[j] === '{') {
      // Balanced-brace scan, quote-aware so braces inside string values
      // (or slashes in a URL) never throw off the match.
      let depth = 0, k = j, inStr = false, strCh = '';
      for (; k < text.length; k++) {
        const c = text[k];
        if (inStr) {
          if (c === '\\') { k++; continue; } // skip escaped char
          if (c === strCh) inStr = false;
          continue;
        }
        if (c === '"' || c === "'") { inStr = true; strCh = c; continue; }
        if (c === '{') depth++;
        else if (c === '}') {
          depth--;
          if (depth === 0) { k++; break; }
        }
      }
      const raw = text.slice(j, k);
      try { args = JSON.parse(raw); }
      catch (_) { args = {}; } // malformed JSON → run with no args rather than crash the pipeline
      argsEnd = k;
    }

    // @@END is optional now — consume it if present, otherwise just move on.
    const endMatch = /^\s*@@END/.exec(text.slice(argsEnd));
    cursor = endMatch ? argsEnd + endMatch[0].length : argsEnd;

    out.push({ action, args });
    idx = cursor;
  }

  return out;
}

function hasAbilityWork(directives) {
  return Array.isArray(directives) && directives.length > 0;
}

// ─── Single active watcher (one AI at a time, per the project's design) ──────
let _watcher = null;

async function runAbility(action, args) {
  args = args || {};
  switch (action) {
    case 'system.openUrl':
      return openUrl(args.url);
    case 'system.openApp':
      return openApp(args.name);

    case 'mouse.moveTo':
      return mouseControl.moveTo(args.x, args.y);
    case 'mouse.click':
      return mouseControl.clickAt(args.x, args.y, args.button);
    case 'mouse.doubleClick':
      return mouseControl.doubleClickAt(args.x, args.y);
    case 'mouse.scroll':
      return mouseControl.scroll(args.direction, args.amount);
    case 'mouse.drag':
      return mouseControl.dragTo(args.fromX, args.fromY, args.toX, args.toY);

    case 'keyboard.type':
      return keyboardControl.type(args.text);
    case 'keyboard.press':
      return keyboardControl.pressKey(args.key);
    case 'keyboard.combo':
      return keyboardControl.combo(args.keys);

    case 'screen.describe':
      return { description: await monitorScreen.describeScreen(args.prompt) };

    case 'screen.watch.start': {
      if (_watcher) _watcher.stop();
      _watcher = monitorScreen.startWatch(
          args.instruction,
          { intervalMs: args.intervalMs },
          (event) => {
            // Surface watch events to whatever is currently listening (agent loop,
            // WhatsApp/Teams notifier, etc.) via a well-known global hook — the
            // wiring doc shows how to attach a real handler here.
            if (typeof global.__megaladonAbilityWatchHook === 'function') {
              try { global.__megaladonAbilityWatchHook(event); } catch (_) {}
            }
          }
      );
      return { watching: true, instruction: args.instruction, intervalMs: args.intervalMs || 30000 };
    }
    case 'screen.watch.stop': {
      if (_watcher) { _watcher.stop(); _watcher = null; return { stopped: true }; }
      return { stopped: false, note: 'no active watcher' };
    }

    default:
      throw new Error('Unknown ability: "' + action + '"');
  }
}

async function runAllAbilities(directives) {
  const results = [];
  for (const d of directives) {
    try {
      const result = await runAbility(d.action, d.args);
      results.push({ ability: d.action, args: d.args, ok: true, result });
    } catch (err) {
      results.push({ ability: d.action, args: d.args, ok: false, error: err.message });
    }
  }
  return results;
}

// ─── Format results back into a text block to feed to the AI ──────────────────
function formatAbilityResults(results) {
  if (!results.length) return '';
  const lines = ['## Ability Results'];
  for (const r of results) {
    if (r.ok) {
      lines.push('- ' + r.ability + ' ✔ ' + JSON.stringify(r.result));
    } else {
      lines.push('- ' + r.ability + ' ✘ error: ' + r.error);
    }
  }
  return lines.join('\n');
}

module.exports = {
  mouseControl,
  keyboardControl,
  monitorScreen,
  ollamaSetup,
  ABILITIES_PROMPT,
  parseAbilityDirectives,
  hasAbilityWork,
  runAbility,
  runAllAbilities,
  formatAbilityResults,
  startWatch: monitorScreen.startWatch,
};
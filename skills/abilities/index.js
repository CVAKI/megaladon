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
async function openUrl(url) {
  if (typeof url !== 'string' || !url.trim()) throw new Error('system.openUrl requires a url');
  const target = /^https?:\/\//i.test(url) ? url : 'https://' + url;
  const platform = process.platform;
  const cmd = platform === 'win32'
      ? 'start "" "' + target + '"'
      : platform === 'darwin'
          ? 'open "' + target + '"'
          : 'xdg-open "' + target + '"';
  execSync(cmd, { stdio: 'ignore', shell: true });
  // Give the browser time to actually launch, gain focus, and render the
  // page before the AI's next screen.describe runs — without this, the very
  // next screenshot was frequently still showing the desktop/terminal,
  // which is why subsequent clicks landed nowhere useful.
  // Was 2000ms — logs showed screen.describe still capturing the desktop/
  // terminal instead of the browser afterward, meaning a cold browser
  // launch (first window, extensions loading, etc.) can take longer than
  // that to actually paint. 4s trades a bit of speed for actually working.
  await new Promise(r => setTimeout(r, 4000));
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

// ─── window.* — close/minimize/maximize the ACTIVE window via native OS ──────
// keyboard shortcuts, instead of clicking the tiny titlebar buttons.
// Why this exists: a titlebar close/minimize/maximize button is only at the
// literal screen corner if the window happens to be maximized — a floating
// window's controls are at THAT WINDOW's own corner, which could be
// anywhere. Even when maximized, the button is a ~45x30px target, well
// inside typical vision-coordinate estimation error. Native shortcuts act
// on whatever window currently has OS focus, so they're precise regardless
// of window size/position and need no coordinates at all.
function resolveWindowKeys(kind) {
  const platform = process.platform;
  if (kind === 'close')    return platform === 'darwin' ? ['cmd', 'w']   : ['alt', 'f4'];
  if (kind === 'minimize') return platform === 'darwin' ? ['cmd', 'm']   : platform === 'win32' ? ['cmd', 'down'] : ['super', 'h'];
  if (kind === 'maximize') return platform === 'win32'  ? ['cmd', 'up']  : platform === 'darwin' ? ['ctrl', 'cmd', 'f'] : ['super', 'up'];
  throw new Error('Unknown window action: ' + kind);
}

async function windowAction(kind) {
  const keys = resolveWindowKeys(kind);
  await keyboardControl.combo(keys);
  return { windowAction: kind, keysSent: keys, platform: process.platform };
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
- @@ABILITY:system.openUrl      {"url":"https://www.google.com/imghp"}   (opens the URL in the default browser — use this, NEVER a shell command or code fence, to open a browser/website. TIP: search engine homepages like google.com auto-focus their search box on load — after opening one, you can keyboard.type directly with no click needed, see FAST PATH below)
- @@ABILITY:system.openApp      {"name":"notepad"}                       (launches a desktop app by name — for apps the person actually wants to USE, e.g. "open notepad". NEVER use this for screenshot/snipping tools — see below.)
- @@ABILITY:window.close        {}   (closes the currently focused window via the OS's native shortcut — Alt+F4 on Windows/Linux, Cmd+W on Mac)
- @@ABILITY:window.minimize     {}   (minimizes the currently focused window via the OS's native shortcut)
- @@ABILITY:window.maximize     {}   (maximizes/fullscreens the currently focused window via the OS's native shortcut)
- @@ABILITY:mouse.moveTo        {"x":500,"y":300}
- @@ABILITY:mouse.click         {"x":500,"y":300,"button":"left"}   (button: left|right|middle, omit x/y to click at current position)
- @@ABILITY:mouse.doubleClick   {"x":500,"y":300}
- @@ABILITY:mouse.scroll        {"direction":"down","amount":5}     (direction: up|down|left|right)
- @@ABILITY:mouse.drag          {"fromX":100,"fromY":100,"toX":400,"toY":400}
- @@ABILITY:keyboard.type       {"text":"hello world"}
- @@ABILITY:keyboard.press      {"key":"enter"}                     (key names: enter,tab,esc,backspace,space,up,down,left,right,ctrl,alt,shift,cmd,f1-f12,a-z,0-9,home,end,pageup,pagedown)
- @@ABILITY:keyboard.combo      {"keys":["ctrl","c"]}
- @@ABILITY:screen.describe     {"prompt":"what is currently on screen?"}   (prompt is optional — THIS is how you take a screenshot, see below)
- @@ABILITY:screen.watch.start  {"instruction":"alert if any graph turns red or shows an error state","intervalMs":30000}
- @@ABILITY:screen.watch.stop   {}

ONLY THESE 14 ACTION NAMES EXIST — never invent a new one:
system.openUrl, system.openApp, window.close, window.minimize, window.maximize, mouse.moveTo,
mouse.click, mouse.doubleClick, mouse.scroll, mouse.drag, keyboard.type, keyboard.press,
keyboard.combo, screen.describe, screen.watch.start, screen.watch.stop.
Something like "@@ABILITY:directives {...}" is NOT a real action and will just fail — if you are
unsure which of the 14 applies, use screen.describe first rather than guessing a new name. Also,
never SAY you are about to do something ("let me take a screenshot...", "please wait...") without
actually emitting the matching @@ABILITY: line in that same reply — saying it is not doing it.

TAKING A SCREENSHOT — READ THIS CAREFULLY:
screen.describe ALREADY captures a real screenshot internally as part of the same call — it is
a one-step "capture + analyze" action. When asked to "take a screenshot", "look at the screen",
"see what's on screen", etc., emit @@ABILITY:screen.describe DIRECTLY and nothing else.
NEVER call system.openApp with "snippingtool", "snip & sketch", "screenshot tool", or any similar
name — that launches Windows' own manual screenshot UI and just sits there waiting for the human
to press a key themselves, which does nothing useful and is NOT how you see the screen.

CLOSING / MINIMIZING / MAXIMIZING A WINDOW — READ THIS CAREFULLY:
For "close this window", "minimize it", "maximize/fullscreen it", ALWAYS use
@@ABILITY:window.close / window.minimize / window.maximize — NEVER try to click a titlebar's
X/_/□ button with mouse coordinates. Reasons: (1) that button is only at the literal screen
corner if the window happens to be maximized — a smaller/floating window's controls are at THAT
WINDOW's own corner, which could be anywhere on screen; (2) even when maximized, the button is a
tiny ~45x30px target that vision-estimated coordinates routinely miss (e.g. hitting minimize
instead of close). The window.* abilities send the OS's native shortcut to whichever window
currently has focus — no coordinates needed, always precise.

screen.describe ALWAYS returns, after the prose description, a list of lines like:
  ELEMENT: Google search bar AT (412,188)
  ELEMENT: first image thumbnail AT (240,510)
These are real pixel coordinates for this screen's actual resolution. When you need to click
something, use the (x,y) from the matching ELEMENT line — NEVER invent your own coordinates
(e.g. never guess something like x:100,y:100 "roughly the middle"). If the element you need
isn't in the list, call screen.describe again with a prompt asking specifically about it, or
scroll first, rather than clicking a guess.

Every mouse.moveTo / mouse.click / mouse.doubleClick result includes either:
  "matchedElement": "<name>"   — good, the click landed near a real reported element
  "note": "...px from the nearest reported element... likely a guess"  — bad, you clicked blind
If you see a "note" field like that, STOP and call screen.describe again before trying another
click — do not keep clicking at guessed coordinates, and do not give up and tell the person to
do it manually. Course-correct using the fresh ELEMENT list instead.

CRITICAL RULE — ACT, DO NOT EXPLAIN:
When a request asks you to actually do something on the desktop (open a site, click something,
type something, download something), you MUST perform it for real using @@ABILITY:/@@RUN:
directives. Do NOT respond with numbered instructions telling the person how they would do it
themselves, and NEVER put a shell command inside a markdown \`\`\`code block\`\`\` — a code block
is never executed. If you are not going to act (e.g. genuinely ambiguous request), ask ONE
short clarifying question instead of writing a how-to guide.

CRITICAL RULE — KEEP GOING, DO NOT STOP AFTER ONE LOOK:
If the person's message already describes a full sequence of steps (e.g. "open X, click Y, then
type Z"), you already have everything you need — do not call screen.describe once, summarize
what you saw, and then ask "what would you like me to do next?" That sequence was already given
to you. After each ability result comes back, immediately decide and emit the NEXT directive(s)
toward finishing the whole sequence, using what the result just told you (e.g. real coordinates
from an ELEMENT list). Only stop and ask a question if something is genuinely ambiguous or the
result showed an actual error — never stop just because you completed one sub-step.

OVERRIDE — THIS APPLIES REGARDLESS OF CURRENT MODE (including Agent and Code mode):
If the request only needs a desktop action (@@ABILITY), a web search (@@SEARCH), or an email
action (@@EMAIL) — and does NOT require creating or editing any project file — do NOT write an
@@FILE: block, do NOT say "I can't perform that action," and do NOT refuse. This overrides any
earlier instruction in this prompt telling you to always begin your response with @@FILE: or to
treat every request as a coding/file task. A request like "take a screenshot" or "click the
search bar" is fully satisfied by emitting the relevant @@ABILITY: directive(s) alone.

Rules:
- FAST PATH for search engines (Google, Bing, DuckDuckGo, YouTube): their homepage search box is
  auto-focused the moment the page loads — the text cursor is already sitting in it. For "go to
  Google and search for X", you do NOT need screen.describe or mouse.click at all. Emit EXACTLY
  these three @@ABILITY: blocks, back to back, using the real literal directive syntax shown below
  (this is NOT JavaScript, NOT a function call, NOT a code block — it is the same @@ABILITY:
  action\n{json}\n@@END format used everywhere else in this prompt):
  @@ABILITY:system.openUrl
  {"url":"https://www.google.com"}
  @@END
  @@ABILITY:keyboard.type
  {"text":"cute dogs"}
  @@END
  @@ABILITY:keyboard.press
  {"key":"enter"}
  @@END
  (replace "https://www.google.com" and "cute dogs" with the real site/query — the shape above is
  the template, not literal values to reuse). This is more reliable than clicking, because it has
  no dependency on the vision model correctly estimating where the search box is — a real weak
  point on busy/multi-window screens. Only fall back to screen.describe + mouse.click for this
  case if, after typing, a screen.describe shows the text did NOT land in the search box.
- For anything else, always emit @@ABILITY:screen.describe BEFORE clicking or typing blind, so
  you know real current coordinates — never guess pixel positions without having described the
  screen first in this conversation.
- Multi-step tasks needing real coordinates (e.g. "click the first image result and save it"):
  1) system.openUrl to open the browser at the right page (e.g. google.com/imghp)
  2) screen.describe to find the search bar's real coordinates (or use the fast path above)
  3) mouse.click on the search bar (skip if using the fast path)
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

// If the last screen.describe reported ELEMENT coordinates, flag when a
// click/moveTo lands far from all of them — a strong signal the model
// guessed instead of reading the list (e.g. defaulting to screen-center).
// Purely informational: never blocks the action, just makes guessing
// visible in the ability result / CLI log instead of silently "succeeding."
function nearestElementNote(x, y) {
  try {
    const shot = monitorScreen.getLastScreenshotInfo();
    if (!shot || !shot.elements || !shot.elements.length) {
      return { note: 'no screen.describe has run yet this session — this click was not based on any reported element' };
    }
    let best = null;
    for (const el of shot.elements) {
      const d = Math.hypot(el.x - x, el.y - y);
      if (!best || d < best.d) best = { ...el, d };
    }
    if (best.d > 60) {
      return {
        note: 'this click is ' + Math.round(best.d) + 'px from the nearest reported element ("' +
            best.name + '" at ' + best.x + ',' + best.y + ') — likely a guess, not a real target',
      };
    }
    return { matchedElement: best.name, distancePx: Math.round(best.d) };
  } catch (_) {
    return {};
  }
}

async function runAbility(action, args) {
  args = args || {};
  switch (action) {
    case 'system.openUrl':
      return openUrl(args.url);
    case 'system.openApp':
      return openApp(args.name);
    case 'window.close':
      return windowAction('close');
    case 'window.minimize':
      return windowAction('minimize');
    case 'window.maximize':
      return windowAction('maximize');

    case 'mouse.moveTo': {
      const result = await mouseControl.moveTo(args.x, args.y);
      return { ...result, ...nearestElementNote(args.x, args.y) };
    }
    case 'mouse.click': {
      const result = await mouseControl.clickAt(args.x, args.y, args.button);
      return typeof args.x === 'number' ? { ...result, ...nearestElementNote(args.x, args.y) } : result;
    }
    case 'mouse.doubleClick': {
      const result = await mouseControl.doubleClickAt(args.x, args.y);
      return typeof args.x === 'number' ? { ...result, ...nearestElementNote(args.x, args.y) } : result;
    }
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
// Deliberately plain sentences, NOT raw JSON. qwen2.5-coder (and similar
// code-tuned local models) is heavily trained on JSON/function-call shapes —
// feeding JSON.stringify(result) back into the conversation was observed to
// make the model MIMIC that shape in its own final reply to the person
// (e.g. replying with a literal {"response": "..."} blob instead of
// natural language). Describing each result as a sentence avoids that.
function describeResult(ability, result) {
  switch (ability) {
    case 'screen.describe':
      return 'the screen shows: ' + (result && result.description ? result.description : '(no description returned)');
    case 'mouse.moveTo': {
      const at = result && result.movedTo ? result.movedTo : result;
      return 'the mouse moved to (' + (at ? at.x : '?') + ',' + (at ? at.y : '?') + ')' +
          (result && result.matchedElement ? ', landing on "' + result.matchedElement + '"' : '') +
          (result && result.note ? '. Note: ' + result.note : '');
    }
    case 'mouse.click':
    case 'mouse.doubleClick': {
      const at = result && result.at ? result.at : {};
      return (ability === 'mouse.doubleClick' ? 'double-' : '') + 'clicked at (' + at.x + ',' + at.y + ')' +
          (result && result.button ? ' with the ' + result.button + ' button' : '') +
          (result && result.matchedElement ? ', on "' + result.matchedElement + '"' : '') +
          (result && result.note ? '. Note: ' + result.note : '');
    }
    case 'mouse.scroll':
      return 'scrolled ' + (result && result.scrolled) + ' by ' + (result && result.amount);
    case 'mouse.drag':
      return 'dragged from the start point to the end point';
    case 'keyboard.type':
      return 'typed the text: "' + (result && result.typed) + '"';
    case 'keyboard.press':
      return 'pressed the "' + (result && result.pressed) + '" key';
    case 'keyboard.combo':
      return 'pressed the key combo: ' + (result && result.combo ? result.combo.join('+') : '');
    case 'system.openUrl':
      return 'opened ' + (result && result.opened) + ' in the default browser';
    case 'system.openApp':
      return 'launched the app "' + (result && result.opened) + '"';
    case 'window.close':
    case 'window.minimize':
    case 'window.maximize':
      return (result && result.windowAction) + 'd the currently focused window';
    default:
      return 'completed (' + JSON.stringify(result) + ')'; // fallback for anything not covered above
  }
}

function formatAbilityResults(results) {
  if (!results.length) return '';
  const lines = ['Here is what actually happened when the last ability directive(s) ran:'];
  for (const r of results) {
    if (r.ok) {
      lines.push('- ' + r.ability + ' succeeded: ' + describeResult(r.ability, r.result));
    } else {
      lines.push('- ' + r.ability + ' FAILED: ' + r.error);
    }
  }
  lines.push('');
  lines.push('Reply in plain conversational language — never output raw JSON or a code block as your reply.');
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
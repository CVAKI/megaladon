'use strict';

/**
 * connections/whatsapp/logger.js
 *
 * WhatsApp themed terminal display with two visual modes:
 *
 * ── IDLE MODE (WA connected but quiet) ───────────────────────────────────────
 * Normal PS1 prompt, WA log lines each start on their own fresh line:
 *   ┌[HH:MM:SS]────[whyWhale]────[◈ agent]────[0]
 *   └[New folder]──►
 *   07:53:51 [WA] WhatsApp connected ✅
 *   07:53:53 [WA] Startup message sent to owner.
 *   ┌[HH:MM:SS]────[whyWhale]────[◈ agent]────[0]
 *   └[New folder]──►
 *
 * ── SECTION MODE (WA conversation active) ────────────────────────────────────
 *   ┌[HH:MM:SS]════[whyWhale]════════[section :1]
 *   ┟══[whatsapp :[WA ←]:[ 1]::[919645278065  hi]]
 *   ┟══[whatsapp :[WA →]:[ 2]::[919645278065  hello!]]
 *   └[whatsapp]-[process]::[section @OnGoing->chatting]
 */

const path = require('path');
const os   = require('os');

// ── Color palette ──────────────────────────────────────────────────────────────
const colors = {
  reset:    '\x1b[0m',
  bold:     '\x1b[1m',
  dim:      '\x1b[2m',
  italic:   '\x1b[3m',
  waGreen:  '\x1b[38;5;35m',
  waDark:   '\x1b[38;5;30m',
  waLight:  '\x1b[38;5;157m',
  waMid:    '\x1b[38;5;42m',
  cyan:     '\x1b[38;5;51m',
  blue:     '\x1b[38;5;75m',
  teal:     '\x1b[38;5;43m',
  coral:    '\x1b[38;5;203m',
  amber:    '\x1b[38;5;226m',
  red:      '\x1b[38;5;203m',
  grey:     '\x1b[38;5;245m',
  white:    '\x1b[38;5;255m',
  dimBlue:  '\x1b[38;5;61m',
};

const C = colors;
const R = colors.reset;
const B = colors.bold;

// ── Utilities ──────────────────────────────────────────────────────────────────
function ts() {
  const n = new Date();
  return [n.getHours(), n.getMinutes(), n.getSeconds()]
    .map(v => String(v).padStart(2, '0')).join(':');
}

function cwd() {
  const home = os.homedir();
  const p    = process.cwd();
  return path.basename(p.startsWith(home) ? '~' + p.slice(home.length) : p) || p;
}

// ── Safe print: always starts on a fresh line ──────────────────────────────────
// When readline has printed "└[cwd]──► " on the current line and a WA event
// fires, we need to move to a new line first, print our message, then move
// to another new line so readline can reprint its prompt cleanly.
function safePrint(line) {
  process.stdout.write('\n' + line + '\n');
}

// ── Section state ──────────────────────────────────────────────────────────────
let _sectionNum  = 1;
let _lineCount   = 0;
let _sectionOpen = false;

// ── Section renderer ───────────────────────────────────────────────────────────
function openSection() {
  _lineCount   = 0;
  _sectionOpen = true;

  const line = [
    C.cyan + '┌',
    C.waGreen + '[' + R + C.amber + ts() + R + C.waGreen + ']' + R,
    C.waGreen + '════' + R,
    C.waGreen + '[' + R + B + C.white + 'whyWhale' + R + C.waGreen + ']' + R,
    C.waGreen + '════════' + R,
    C.waGreen + '[' + R + C.waLight + B + 'section :' + _sectionNum + R + C.waGreen + ']' + R,
  ].join('');

  // Section header always starts on its own line
  process.stdout.write('\n' + line + '\n');
}

function logLine(direction, sender, text) {
  if (!_sectionOpen) openSection();

  _lineCount++;
  const num     = String(_lineCount).padStart(2, ' ');
  const arrow   = direction === 'in' ? 'WA ←' : 'WA →';
  const color   = direction === 'in' ? C.waGreen : C.waMid;
  const clean   = sender.replace('@s.whatsapp.net', '').replace('@g.us', '');
  const preview = text.length > 60 ? text.slice(0, 60) + '…' : text;

  const line = [
    C.waGreen + '┟══' + R,
    C.grey    + '[whatsapp :' + R,
    color + B + '[' + arrow + ']' + R,
    C.grey    + ':[' + R,
    C.cyan    + num + R,
    C.grey    + ']::[' + R,
    C.amber   + clean + R,
    '  ',
    C.waLight + preview + R,
    C.grey    + ']' + R,
  ].join('');

  // Each message line on its own line (no leading \n — section header already did that)
  process.stdout.write(line + '\n');
}

function closeSection(status = 'chat') {
  if (!_sectionOpen) return;
  _sectionOpen = false;

  const tags = {
    work: 'section @END-> going to terminal for work',
    send: 'section @END->to sending',
    chat: 'section @OnGoing->chatting',
    end:  'section @END',
  };

  const tag      = tags[status] || tags.chat;
  const tagColor = (status === 'chat') ? C.waMid : C.amber;

  const line = [
    C.waGreen + '└' + R,
    C.grey    + '[whatsapp]' + R,
    C.grey    + '-[process]' + R,
    C.grey    + '::' + R,
    C.grey    + '[' + R,
    tagColor  + B + tag + R,
    C.grey    + ']' + R,
  ].join('');

  process.stdout.write(line + '\n');
  _sectionNum++;
}

// ── Idle PS1 ───────────────────────────────────────────────────────────────────
function printIdlePrompt(msgCount = 0, mode = 'code') {
  const modeLabel = '</> ' + mode;
  const AB = C.cyan;

  const l1 = [
    AB + '┌',
    AB + '[' + R + C.coral + ts() + R + AB + ']' + R,
    AB + '────' + R,
    AB + '[' + R + B + C.white + 'whyWhale' + R + AB + ']' + R,
    AB + '────' + R,
    AB + '[' + R + C.coral + modeLabel + R + AB + ']' + R,
    AB + '────' + R,
    AB + '[' + R + C.teal + String(msgCount) + R + AB + ']' + R,
  ].join('');

  const l2 = AB + '└[' + R + C.teal + cwd() + R + AB + ']' + R +
             AB + '──' + R + C.coral + '►' + R + ' ';

  process.stdout.write('\n' + l1 + '\n' + l2);
}

// ── WA badge ───────────────────────────────────────────────────────────────────
const WA_BADGE = C.bold + C.waGreen + '[WA]' + R;

// ── Startup section box ────────────────────────────────────────────────────────
// Displays the 3-4 WA init messages inside a styled box then closes it.
let _startupOpen = false;

function openStartupBox(label) {
  _startupOpen = true;
  const line = [
    C.waGreen + '┌' + R,
    C.waGreen + '[' + R + C.amber + ts() + R + C.waGreen + ']' + R,
    C.waGreen + '════' + R,
    C.waGreen + '[' + R + B + C.white + 'whyWhale' + R + C.waGreen + ']' + R,
    C.waGreen + '════════' + R,
    C.waGreen + '[' + R + C.waLight + B + (label || 'WA startup') + R + C.waGreen + ']' + R,
  ].join('');
  process.stdout.write('\n' + line + '\n');
}

function startupLine(level, msg) {
  const color = level === 'success' ? C.waGreen
              : level === 'warn'    ? C.amber
              : level === 'error'   ? C.red
              : C.waLight;
  const line = [
    C.waGreen + '┟══ ' + R,
    C.grey    + ts() + ' ' + R,
    B + C.waGreen + '[WA] ' + R,
    color + msg + R,
  ].join('');
  process.stdout.write(line + '\n');
}

function closeStartupBox() {
  if (!_startupOpen) return;
  _startupOpen = false;
  const line = [
    C.waGreen + '└' + R,
    C.grey    + '[whatsapp]' + R,
    C.grey    + '-[startup]' + R,
    C.grey    + '::' + R,
    C.grey    + '[' + R,
    C.waMid   + B + 'startup complete ✅' + R,
    C.grey    + ']' + R,
  ].join('');
  process.stdout.write(line + '\n');
}

// ── Log object ─────────────────────────────────────────────────────────────────
const log = {

  // General info — always on its own line, never bleeds into readline prompt
  info(msg) {
    safePrint(`${ts()} ${WA_BADGE} ${C.waLight}${msg}${R}`);
  },

  success(msg) {
    safePrint(`${ts()} ${WA_BADGE} ${C.waGreen}${B}${msg}${R}`);
  },

  warn(msg) {
    safePrint(`${ts()} ${WA_BADGE} ${C.amber}${msg}${R}`);
  },

  error(msg) {
    safePrint(`${ts()} ${WA_BADGE} ${C.red}${msg}${R}`);
  },

  // WA message log — opens section automatically
  incoming(sender, text) {
    logLine('in', sender, text);
  },

  outgoing(sender, text) {
    logLine('out', sender, text);
  },

  // Close section
  closeSection(status = 'chat') {
    closeSection(status);
  },

  // Manual open (rarely needed)
  openSection,

  // Print idle PS1
  printIdlePrompt,

  openStartupBox,
  startupLine,
  closeStartupBox,
  get startupBoxOpen() { return _startupOpen; },
  get sectionOpen() { return _sectionOpen; },
  get sectionNum()  { return _sectionNum; },
};

module.exports = { log, colors };
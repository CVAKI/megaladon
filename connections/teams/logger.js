'use strict';

/**
 * connections/teams/logger.js
 *
 * Teams-themed terminal display, structurally identical to
 * connections/whatsapp/logger.js — section boxes open on incoming
 * messages, close when work starts/ends, so the terminal PS1 doesn't
 * get corrupted by async output.
 */

// ── Color palette (Teams purple/violet brand colors) ──────────────────────────
const colors = {
  reset:    '\x1b[0m',
  bold:     '\x1b[1m',
  dim:      '\x1b[2m',
  italic:   '\x1b[3m',
  tmPurple: '\x1b[38;5;98m',   // Teams brand purple (#6264A7 approx)
  tmDark:   '\x1b[38;5;60m',
  tmLight:  '\x1b[38;5;183m',
  tmMid:    '\x1b[38;5;140m',
  cyan:     '\x1b[38;5;51m',
  amber:    '\x1b[38;5;226m',
  red:      '\x1b[38;5;203m',
  grey:     '\x1b[38;5;245m',
  white:    '\x1b[38;5;255m',
};

const C = colors;
const R = colors.reset;
const B = colors.bold;

function ts() {
  const n = new Date();
  return [n.getHours(), n.getMinutes(), n.getSeconds()].map(v => String(v).padStart(2, '0')).join(':');
}

function safePrint(line) {
  process.stdout.write('\n' + line + '\n');
}

let _sectionNum  = 1;
let _lineCount   = 0;
let _sectionOpen = false;

function openSection() {
  _lineCount   = 0;
  _sectionOpen = true;
  const line = [
    C.cyan + '┌',
    C.tmPurple + '[' + R + C.amber + ts() + R + C.tmPurple + ']' + R,
    C.tmPurple + '════' + R,
    C.tmPurple + '[' + R + B + C.white + 'Megaladon' + R + C.tmPurple + ']' + R,
    C.tmPurple + '════════' + R,
    C.tmPurple + '[' + R + C.tmLight + B + 'teams section :' + _sectionNum + R + C.tmPurple + ']' + R,
  ].join('');
  process.stdout.write('\n' + line + '\n');
}

function logLine(direction, sender, text) {
  if (!_sectionOpen) openSection();
  _lineCount++;
  const num     = String(_lineCount).padStart(2, ' ');
  const arrow   = direction === 'in' ? 'TM ←' : 'TM →';
  const color   = direction === 'in' ? C.tmPurple : C.tmMid;
  const preview = (text || '').length > 60 ? text.slice(0, 60) + '…' : (text || '');

  const line = [
    C.tmPurple + '┟══' + R,
    C.grey    + '[teams :' + R,
    color + B + '[' + arrow + ']' + R,
    C.grey    + ':[' + R,
    C.cyan    + num + R,
    C.grey    + ']::[' + R,
    C.amber   + (sender || 'unknown') + R,
    '  ',
    C.tmLight + preview + R,
    C.grey    + ']' + R,
  ].join('');
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
  const tagColor = (status === 'chat') ? C.tmMid : C.amber;
  const line = [
    C.tmPurple + '└' + R,
    C.grey    + '[teams]' + R,
    C.grey    + '-[process]' + R,
    C.grey    + '::' + R,
    C.grey    + '[' + R,
    tagColor  + B + tag + R,
    C.grey    + ']' + R,
  ].join('');
  process.stdout.write(line + '\n');
  _sectionNum++;
}

const TM_BADGE = C.bold + C.tmPurple + '[TM]' + R;

let _startupOpen = false;

function openStartupBox(label) {
  _startupOpen = true;
  const line = [
    C.tmPurple + '┌' + R,
    C.tmPurple + '[' + R + C.amber + ts() + R + C.tmPurple + ']' + R,
    C.tmPurple + '════' + R,
    C.tmPurple + '[' + R + B + C.white + 'Megaladon' + R + C.tmPurple + ']' + R,
    C.tmPurple + '════════' + R,
    C.tmPurple + '[' + R + C.tmLight + B + (label || 'Teams startup') + R + C.tmPurple + ']' + R,
  ].join('');
  process.stdout.write('\n' + line + '\n');
}

function startupLine(level, msg) {
  const color = level === 'success' ? C.tmPurple
              : level === 'warn'    ? C.amber
              : level === 'error'   ? C.red
              : C.tmLight;
  process.stdout.write([
    C.tmPurple + '┟══ ' + R,
    C.grey    + ts() + ' ' + R,
    B + C.tmPurple + '[TM] ' + R,
    color + msg + R,
  ].join('') + '\n');
}

function closeStartupBox() {
  if (!_startupOpen) return;
  _startupOpen = false;
  process.stdout.write([
    C.tmPurple + '└' + R,
    C.grey    + '[teams]' + R,
    C.grey    + '-[startup]' + R,
    C.grey    + '::' + R,
    C.grey    + '[' + R,
    C.tmMid   + B + 'startup complete ✅' + R,
    C.grey    + ']' + R,
  ].join('') + '\n');
}

const log = {
  info(msg)    { safePrint(`${ts()} ${TM_BADGE} ${C.tmLight}${msg}${R}`); },
  success(msg) { safePrint(`${ts()} ${TM_BADGE} ${C.tmPurple}${B}${msg}${R}`); },
  warn(msg)    { safePrint(`${ts()} ${TM_BADGE} ${C.amber}${msg}${R}`); },
  error(msg)   { safePrint(`${ts()} ${TM_BADGE} ${C.red}${msg}${R}`); },
  incoming(sender, text) { logLine('in', sender, text); },
  outgoing(sender, text) { logLine('out', sender, text); },
  closeSection(status = 'chat') { closeSection(status); },
  openSection,
  openStartupBox,
  startupLine,
  closeStartupBox,
  get startupBoxOpen() { return _startupOpen; },
  get sectionOpen() { return _sectionOpen; },
  get sectionNum()  { return _sectionNum; },
};

module.exports = { log, colors };

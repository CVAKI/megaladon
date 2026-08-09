'use strict';
// ─── ANSI Colors ──────────────────────────────────────────────────────────────
const { execSync } = require('child_process');

const C = { reset:'',bold:'',dim:'',italic:'' };
(function() {
  const isWin = process.platform === 'win32';
  if (isWin) {
    try { execSync('reg add HKCU\\Console /v VirtualTerminalLevel /t REG_DWORD /d 1 /f',{stdio:'ignore'}); } catch(_){}
    try { execSync('powershell -NoProfile -Command "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8"',{stdio:'ignore'}); } catch(_){}
  }
  C.reset  = '\x1b[0m';
  C.bold   = '\x1b[1m';
  C.dim    = '\x1b[2m';
  C.italic = '\x1b[3m';
  const wt        = !!process.env.WT_SESSION;
  const colorterm = (process.env.COLORTERM||'').toLowerCase();
  const has24bit  = colorterm==='truecolor'||colorterm==='24bit'||wt||(!isWin&&!!process.env.TERM_PROGRAM);
  if (has24bit) {
    C.whale  = '\x1b[38;2;41;121;255m';   // logo blue (jaw/body)
    C.deep   = '\x1b[38;2;20;70;160m';    // darker blue shade
    C.coral  = '\x1b[38;2;255;107;43m';   // kept as a warm accent (unused by logo)
    C.kelp   = '\x1b[38;2;63;200;90m';    // success green, unrelated to brand palette
    C.reef   = '\x1b[38;2;255;204;0m';    // logo yellow (fins)
    C.abyss  = '\x1b[38;2;120;125;132m';  // neutral grey
    C.sand   = '\x1b[38;2;235;238;242m';  // near-white (teeth/highlights)
    C.danger = '\x1b[38;2;248;81;73m';
    C.violet = '\x1b[38;2;185;110;255m';
    C.teal   = '\x1b[38;2;60;220;200m';
    C.foam   = '\x1b[38;2;255;255;255m';  // pure white
  } else {
    C.whale  = '\x1b[38;5;33m';
    C.deep   = '\x1b[38;5;25m';
    C.coral  = '\x1b[38;5;208m';
    C.kelp   = '\x1b[38;5;71m';
    C.reef   = '\x1b[38;5;220m';
    C.abyss  = '\x1b[38;5;246m';
    C.sand   = '\x1b[38;5;255m';
    C.danger = '\x1b[38;5;203m';
    C.violet = '\x1b[38;5;135m';
    C.teal   = '\x1b[38;5;80m';
    C.foam   = '\x1b[38;5;231m';
  }
})();

// shorthand color functions
const wh = t => C.whale+t+C.reset;
const cr = t => C.coral+t+C.reset;
const kp = t => C.kelp+t+C.reset;
const rf = t => C.reef+t+C.reset;
const ab = t => C.abyss+t+C.reset;
const sd = t => C.sand+t+C.reset;
const dg = t => C.danger+t+C.reset;
const vt = t => C.violet+t+C.reset;
const tl = t => C.teal+t+C.reset;
const fm = t => C.foam+t+C.reset;
const bd = t => C.bold+t+C.reset;
const dm = t => C.dim+t+C.reset;

module.exports = { C, wh, cr, kp, rf, ab, sd, dg, vt, tl, fm, bd, dm };
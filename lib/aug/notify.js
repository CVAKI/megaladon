'use strict';

// ─── lib/aug/notify.js ────────────────────────────────────────────────────────
// Plays lib/aug/megaladon_notification.mp3 when the agent finishes a task.
// Windows  → WScript Shell via a tiny temp .vbs file (100% built-in, no install)
// macOS    → afplay (built-in)
// Linux    → mpg123 / ffplay / paplay / aplay (first found)
// Fails silently — never breaks the main flow.

const path   = require('path');
const fs     = require('fs');
const os     = require('os');
const { spawn, execSync } = require('child_process');

const AUDIO_FILE = path.resolve(__dirname, 'megaladon_notification.mp3');

function playNotification() {
  if (!fs.existsSync(AUDIO_FILE)) return; // no file → skip silently

  try {
    if (process.platform === 'win32') {
      _playWindows(AUDIO_FILE);
    } else if (process.platform === 'darwin') {
      _playMac(AUDIO_FILE);
    } else {
      _playLinux(AUDIO_FILE);
    }
  } catch (_) {
    // always fail silently
  }
}

// ── Windows ───────────────────────────────────────────────────────────────────
// VBScript via WScript.exe — ships on every Windows version, plays MP3 natively
// through Windows Media Player COM object. Writes a tiny temp .vbs file,
// runs it detached, then it self-deletes.
function _playWindows(audioFile) {
  const vbsPath = path.join(os.tmpdir(), 'meg_notify_' + Date.now() + '.vbs');

  // Escape backslashes for VBScript string literal
  const escaped = audioFile.replace(/\\/g, '\\\\');
  const escapedVbs = vbsPath.replace(/\\/g, '\\\\');

  const vbs = [
    'Dim snd',
    'Set snd = CreateObject("WMPlayer.OCX")',
    'snd.URL = "' + escaped + '"',
    'snd.controls.play',
    'Dim t : t = Timer',
    'Do While Timer < t + 3.5',
    '  WScript.Sleep 100',
    'Loop',
    'snd.controls.stop',
    'Set snd = Nothing',
    'CreateObject("Scripting.FileSystemObject").DeleteFile "' + escapedVbs + '"',
  ].join('\r\n');

  fs.writeFileSync(vbsPath, vbs, 'utf8');

  const child = spawn('wscript.exe', ['/nologo', vbsPath], {
    detached: true,
    stdio:    'ignore',
    windowsHide: true,
  });
  child.unref();
}

// ── macOS ─────────────────────────────────────────────────────────────────────
function _playMac(audioFile) {
  const child = spawn('afplay', [audioFile], {
    detached: true,
    stdio:    'ignore',
  });
  child.unref();
}

// ── Linux ─────────────────────────────────────────────────────────────────────
function _playLinux(audioFile) {
  const players = [
    ['mpg123', ['-q', audioFile]],
    ['ffplay',  ['-nodisp', '-autoexit', '-loglevel', 'quiet', audioFile]],
    ['paplay',  [audioFile]],
    ['aplay',   [audioFile]],
  ];

  for (const [bin, args] of players) {
    try {
      execSync('which ' + bin, { stdio: 'ignore' });
      const child = spawn(bin, args, { detached: true, stdio: 'ignore' });
      child.unref();
      return;
    } catch (_) {}
  }
  // no player found → skip silently
}

module.exports = { playNotification };
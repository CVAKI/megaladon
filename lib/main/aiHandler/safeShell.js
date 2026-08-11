'use strict';

const { execSync } = require('child_process');

// safeCmd — rewrites dangerous "kill all node.exe" commands so they spare
// the running Megaladon process (and its parent shell) by excluding our own PID.
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

module.exports = { safeCmd, runShell };

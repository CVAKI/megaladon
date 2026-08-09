'use strict';

const path = require('path');
const fs   = require('fs');

const { ab, cr, dg, kp, rf, sd, dm } = require('../../colors');
const { runShell }                    = require('../../selftest');
const { CWD }                         = require('../../filesystem');

// ─── !shell passthrough ───────────────────────────────────────────────────────
async function handleShell(text, ctx) {
  const cmd = text.slice(1).trim();
  if (!cmd) { ctx.prompt(); return true; }

  // Guard: block running the WA standalone runner while Megaladon is active
  if (/connections[/\\]whatsapp[/\\]index\.js/.test(cmd)) {
    console.log('\n  ' + rf('⚠ Blocked: ') + ab('Cannot run the WhatsApp standalone runner while Megaladon is active.'));
    console.log('  ' + ab('  Running a second Baileys session would kick out the current one (code 440).'));
    console.log('  ' + ab('  Use ') + sd('/wp') + ab(' to manage the WhatsApp connection from here.'));
    ctx.prompt(); return true;
  }

  if (process.platform === 'win32') {
    const UNIX_ONLY = [
      { pat: /^\s*ps\s+(aux|aux\b|-ef|-e)/,   hint: 'Use: tasklist' },
      { pat: /^\s*kill\s+%\d+/,               hint: 'Use: taskkill /F /IM node.exe  (or Stop-Process in PowerShell)' },
      { pat: /^\s*(pkill|killall)\s/,          hint: 'Use: taskkill /F /IM <processname>.exe' },
      { pat: /^\s*which\s/,                    hint: 'Use: where <command>' },
      { pat: /^\s*grep\s/,                     hint: 'Use: findstr "<pattern>" <file>  (or pipe to findstr)' },
      { pat: /^\s*cat\s/,  fix: c => c.replace(/^\s*cat\s+/, 'type ').replace(/\//g, '\\') },
    ];
    const match = UNIX_ONLY.find(r => r.pat.test(cmd));
    if (match) {
      if (match.fix) {
        const rewritten = match.fix(cmd);
        console.log('  ' + rf('⟳ Windows: ') + ab('rewrote to: ') + sd(rewritten));
        const res2  = await runShell(rewritten);
        const TW2b  = Math.min((process.stdout.columns || 80) - 4, 100);
        console.log('  ' + ab('╭─ output ' + '─'.repeat(TW2b - 10)));
        const lines2 = [...res2.stdout.split('\n'), ...(res2.stderr ? res2.stderr.split('\n').map(l => dg(l)) : [])]
          .filter(l => l !== undefined);
        if (!res2.stdout && !res2.stderr) lines2.push(dm('(no output)'));
        lines2.filter(Boolean).forEach(l => console.log('  ' + ab('│ ') + l));
        console.log('  ' + ab('╰─ exit ') + (res2.code === 0 ? kp(String(res2.code)) : dg(String(res2.code))));
        ctx.prompt(); return true;
      }
      console.log('\n  ' + rf('⚠ Windows: ') + ab('"' + cmd.trim().split(/\s/)[0] + '" is a Unix command and won\'t work here.'));
      console.log('  ' + ab('  Hint → ') + sd(match.hint));
      ctx.prompt(); return true;
    }
  }

  let cmdToRun = cmd;

  // Windows curl — bypass the shell entirely
  if (process.platform === 'win32' && /^\s*curl\s/i.test(cmdToRun)) {
    const rawArgs = cmdToRun.replace(/^\s*curl\s+/, '');
    const argv = [];
    let cur = '', inQ = null, j = 0;
    while (j < rawArgs.length) {
      const c = rawArgs[j];
      if (!inQ && (c === '"' || c === "'"))   { inQ = c; }
      else if (inQ && c === inQ)              { inQ = null; }
      else if (inQ === '"' && c === '\\' && rawArgs[j + 1] === '"') { cur += '"'; j++; }
      else if (!inQ && c === ' ')             { if (cur) { argv.push(cur); cur = ''; } }
      else                                    { cur += c; }
      j++;
    }
    if (cur) argv.push(cur);

    const dIdx = argv.findIndex(a => a === '-d' || a === '--data' || a === '--data-raw');
    let tmpJson = null;
    if (dIdx !== -1 && argv[dIdx + 1] !== undefined) {
      const body = argv[dIdx + 1];
      tmpJson = path.join(require('os').tmpdir(), 'meg_curl_' + Date.now() + '.json');
      fs.writeFileSync(tmpJson, body, 'utf8');
      argv[dIdx + 1] = '@' + tmpJson;
      console.log('  ' + rf('⟳ Windows curl: ') + ab('JSON body → temp file, running curl.exe directly'));
    }

    console.log('\n  ' + ab('$ ') + sd('curl ' + argv.join(' ')));
    const { spawnSync } = require('child_process');
    const sr = spawnSync('curl', argv, { encoding: 'utf8', cwd: process.cwd(), windowsHide: true });

    const TW2 = Math.min((process.stdout.columns || 80) - 4, 100);
    console.log('  ' + ab('╭─ output ' + '─'.repeat(TW2 - 10)));
    const outLines = [
      ...(sr.stdout || '').split('\n'),
      ...(sr.stderr ? sr.stderr.split('\n').map(l => dg(l)) : []),
    ].filter(l => l !== undefined);
    if (!sr.stdout && !sr.stderr) outLines.push(dm('(no output)'));
    outLines.filter(Boolean).forEach(l => console.log('  ' + ab('│ ') + l));
    const exitCode = sr.status ?? 1;
    console.log('  ' + ab('╰─ exit ') + (exitCode === 0 ? kp(String(exitCode)) : dg(String(exitCode))));
    ctx.prompt(); return true;
  }

  if (process.platform === 'win32' && /&\s*$/.test(cmdToRun)) {
    cmdToRun = 'start /B ' + cmdToRun.replace(/&\s*$/, '').trim();
    console.log('  ' + rf('⟳ Windows: ') + ab('rewrote to: ') + sd(cmdToRun));
  }

  if (process.platform === 'win32' && !cmdToRun.startsWith('start /B')) {
    const nodeServerPat = /(^|&&\s*)node\s+\S+\.js\s*$/;
    if (nodeServerPat.test(cmdToRun.trim())) {
      const parts  = cmdToRun.split('&&').map(s => s.trim());
      const last   = parts[parts.length - 1];
      parts[parts.length - 1] = 'start /B ' + last;
      cmdToRun = parts.join(' && ');
      console.log('  ' + rf('⟳ Windows: ') + ab('auto-backgrounded: ') + sd(cmdToRun));
    }
  }

  console.log('\n  ' + ab('$ ') + sd(cmdToRun));
  let res = await runShell(cmdToRun);

  // Auto-install missing npm modules when node hits MODULE_NOT_FOUND
  const combinedOut = (res.stdout || '') + (res.stderr || '');
  const isNodeRun   = /\bnode\b.*\.js/.test(cmdToRun);
  if (res.code !== 0 && isNodeRun && /Cannot find module/.test(combinedOut)) {
    const modRe    = /Cannot find module '([^']+)'/g;
    const builtins = new Set(['fs','path','http','https','os','child_process','util','events',
      'stream','buffer','crypto','url','querystring','readline','assert','net','tls',
      'zlib','dns','cluster','worker_threads','vm','module','process','timers']);
    const toInstall = new Set();
    let m2;
    while ((m2 = modRe.exec(combinedOut)) !== null) {
      const name = m2[1];
      if (name.startsWith('.') || name.startsWith('/')) continue;
      const pkg = name.startsWith('@') ? name.split('/').slice(0,2).join('/') : name.split('/')[0];
      if (!builtins.has(pkg)) toInstall.add(pkg);
    }
    if (toInstall.size) {
      const pkgList = [...toInstall];
      console.log('  ' + ab('⬇ Auto-installing missing module(s): ') + sd(pkgList.join(', ')) + ab('...'));
      const { exec: _exec } = require('child_process');
      const installed = await new Promise(resolve => {
        _exec('npm install ' + pkgList.join(' ') + ' --save',
          { timeout: 90000, cwd: CWD(), shell: true },
          err => {
            if (err) { console.log('  ' + dg('✘ npm install failed — ' + (err.message || ''))); resolve(false); }
            else      { console.log('  ' + kp('✔ Installed: ') + sd(pkgList.join(', '))); resolve(true); }
          });
      });
      if (installed) {
        console.log('  ' + ab('⟳ Retrying command after install...'));
        res = await runShell(cmdToRun);
      }
    }
  }

  const TW2  = Math.min((process.stdout.columns || 80) - 4, 100);
  console.log('  ' + ab('╭─ output ' + '─'.repeat(TW2 - 10)));
  const lines = [...res.stdout.split('\n'), ...(res.stderr ? res.stderr.split('\n').map(l => dg(l)) : [])]
    .filter(l => l !== undefined);
  if (!res.stdout && !res.stderr) lines.push(dm('(no output)'));
  lines.filter(Boolean).forEach(l => console.log('  ' + ab('│ ') + l));
  console.log('  ' + ab('╰─ exit ') + (res.code === 0 ? kp(String(res.code)) : dg(String(res.code))));
  ctx.prompt(); return true;
}

module.exports = { handleShell };
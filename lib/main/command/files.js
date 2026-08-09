'use strict';

const fs   = require('fs');
const path = require('path');

const { wh, cr, kp, ab, sd, dg, tl, dm } = require('../../colors');
const { formatMD, spinner }               = require('../../render');
const { CWD, safePath, ensureDirForFile, readFileSafe, treeDir, lsDir,
        formatSize, scanFolder, buildFolderContext }      = require('../../filesystem');
const { runShell }                        = require('../../selftest');

// ─── /scan ────────────────────────────────────────────────────────────────────
async function handleScan(ctx) {
  const sp    = spinner('Scanning directory...');
  const files = scanFolder(CWD(), 8);
  sp.stop(); ctx.folderCtx = buildFolderContext(files, CWD());
  console.log('\n  ' + tl('✔ Scanned: ') + sd(files.length + ' files'));
  files.forEach(f => console.log('  ' + ab('  → ') + sd(f.path) + ab(' (' + formatSize(f.size) + ')')));
  ctx.prompt(); return true;
}

// ─── /ls ──────────────────────────────────────────────────────────────────────
async function handleLs(text, ctx) {
  const arg = text.slice(3).trim() || '.';
  try {
    const entries  = lsDir(arg);
    const relBase  = path.resolve(CWD(), arg);
    console.log('\n  ' + tl(path.relative(CWD(), relBase) || '.') + '  ' + ab('(' + entries.length + ' items)'));
    console.log('');
    entries.forEach(e => {
      const col = e.isDir ? wh : sd;
      console.log('  ' + (e.isDir ? wh('▸ ') : ab('  ')) + col(e.name + (e.isDir ? '/' : '')) + (e.size != null ? ab('  ' + formatSize(e.size)) : ''));
    });
  } catch (err) { console.log('\n  ' + dg('✘ ' + err.message)); }
  ctx.prompt(); return true;
}

// ─── /tree ────────────────────────────────────────────────────────────────────
async function handleTree(text, ctx) {
  const depth = parseInt(text.split(/\s+/)[1]) || 3;
  console.log('\n  ' + tl(CWD()));
  console.log(treeDir(CWD(), '  ', 0, depth));
  ctx.prompt(); return true;
}

// ─── /read ────────────────────────────────────────────────────────────────────
async function handleRead(text, ctx) {
  const fp         = text.slice(6).trim().replace(/^["']|["']$/g, '');
  const candidates = [fp, path.join('src', fp), path.join('lib', fp)];
  let rdResolved   = null;
  for (const c of candidates) { try { readFileSafe(c); rdResolved = c; break; } catch (_) {} }
  if (!rdResolved) {
    console.log('\n  ' + dg('✘ File not found: ') + sd(fp));
    console.log('  ' + ab('  Hint: use /ls to browse files'));
    ctx.prompt(); return true;
  }
  try {
    const file = readFileSafe(rdResolved);
    console.log('\n  ' + kp('✔ ') + sd(file.name) + ab(' (' + formatSize(file.size) + ' · ' + file.content.split('\n').length + ' lines)'));
    console.log(formatMD('```' + file.ext + '\n' + file.content.slice(0, 3000) + (file.content.length > 3000 ? '\n... (truncated)' : '') + '\n```'));
  } catch (err) { console.log('\n  ' + dg('✘ ' + err.message)); }
  ctx.prompt(); return true;
}

// ─── /create ──────────────────────────────────────────────────────────────────
async function handleCreate(text, ctx) {
  const fp = text.slice(8).trim().replace(/^["']|["']$/g, '');
  try {
    const full = safePath(fp); ensureDirForFile(full);
    if (fs.existsSync(full)) console.log('\n  ' + cr('Already exists: ') + sd(fp) + ab(' — use /analyse or ask AI to modify it'));
    else { fs.writeFileSync(full, '', 'utf8'); console.log('\n  ' + kp('✔ Created: ') + sd(fp)); }
  } catch (err) { console.log('\n  ' + dg('✘ ' + err.message)); }
  ctx.prompt(); return true;
}

// ─── /delete ──────────────────────────────────────────────────────────────────
async function handleDelete(text, ctx) {
  const fp = text.slice(8).trim().replace(/^["']|["']$/g, '');
  try {
    const full = safePath(fp);
    if (!fs.existsSync(full)) { console.log('\n  ' + dg('Not found: ' + fp)); ctx.prompt(); return true; }
    const conf = await ctx.ask('\n  ' + dg('Delete ') + sd(fp) + dg('? (yes/no): '));
    if (conf.trim().toLowerCase() === 'yes') { fs.rmSync(full, { recursive: true }); console.log('  ' + kp('✔ Deleted: ') + ab(fp)); }
    else console.log('  ' + ab('Cancelled.'));
  } catch (err) { console.log('\n  ' + dg('✘ ' + err.message)); }
  ctx.prompt(); return true;
}

// ─── /rename ──────────────────────────────────────────────────────────────────
async function handleRename(text, ctx) {
  const parts = text.slice(8).trim().split(/\s+/);
  if (parts.length < 2) { console.log('\n  ' + dg('Usage: /rename <old> <new>')); ctx.prompt(); return true; }
  try {
    const from = safePath(parts[0]), to = safePath(parts[1]);
    if (!fs.existsSync(from)) { console.log('\n  ' + dg('Not found: ' + parts[0])); ctx.prompt(); return true; }
    ensureDirForFile(to); fs.renameSync(from, to);
    console.log('\n  ' + kp('✔ Renamed: ') + sd(parts[0]) + ab(' → ') + sd(parts[1]));
  } catch (err) { console.log('\n  ' + dg('✘ ' + err.message)); }
  ctx.prompt(); return true;
}

// ─── /run ─────────────────────────────────────────────────────────────────────
async function handleRun(text, ctx) {
  const cmd = text.slice(4).trim();
  if (!cmd) { console.log('\n  ' + dg('Usage: /run <command>  or  !<command>')); }
  else {
    const res  = await runShell(cmd);
    const TW2  = Math.min((process.stdout.columns || 80) - 4, 100);
    console.log('\n  ' + ab('╭─ ') + sd(cmd) + ab(' ' + '─'.repeat(Math.max(0, TW2 - cmd.length - 4))));
    [...res.stdout.split('\n'), ...(res.stderr ? res.stderr.split('\n').map(l => dg(l)) : [])].filter(Boolean).forEach(l => console.log('  ' + ab('│ ') + l));
    if (!res.stdout && !res.stderr) console.log('  ' + ab('│ ') + dm('(no output)'));
    console.log('  ' + ab('╰─ exit ') + (res.code === 0 ? kp(String(res.code)) : dg(String(res.code))));
  }
  ctx.prompt(); return true;
}

module.exports = {
  handleScan,
  handleLs,
  handleTree,
  handleRead,
  handleCreate,
  handleDelete,
  handleRename,
  handleRun,
};

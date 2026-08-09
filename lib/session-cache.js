'use strict';

const fs   = require('fs');
const path = require('path');
const os   = require('os');

// ─── Paths ─────────────────────────────────────────────────────────────────────
const CACHE_PATH = path.join(os.homedir(), '.meg', 'session-cache.json');

function ensureDir(d) {
  try { if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true }); } catch (_) {}
}

// ─── Load / Save ──────────────────────────────────────────────────────────────
function loadCache() {
  try {
    if (fs.existsSync(CACHE_PATH)) {
      const raw = JSON.parse(fs.readFileSync(CACHE_PATH, 'utf8'));
      return raw;
    }
  } catch (_) {}
  return freshCache();
}

function freshCache() {
  const now = new Date().toISOString();
  return {
    sessionId:    now,
    sessionStart: now,
    lastUpdated:  now,
    cwd:          process.cwd(),
    files:        {},
    commands:     [],
    errors:       [],
    brokenFiles:  [],
    history:      [],
    tasksDone:    0,
    tasksFailed:  0,
    totalTokens:  0,
  };
}

function saveCache(cache) {
  try {
    ensureDir(path.dirname(CACHE_PATH));
    cache.lastUpdated = new Date().toISOString();
    fs.writeFileSync(CACHE_PATH, JSON.stringify(cache, null, 2), 'utf8');
  } catch (_) {}
}

function recordFile(cache, filePath, content, status = 'created') {
  const now   = new Date().toISOString();
  const lines = content ? content.split('\n').length : 0;
  const rel   = path.relative(process.cwd(), path.resolve(filePath));
  const key   = rel || filePath;

  const existing = cache.files[key];
  cache.files[key] = {
    status,
    lines,
    broken:     status === 'error',
    lastError:  status === 'error' ? content : (existing?.lastError || null),
    createdAt:  existing?.createdAt || now,
    modifiedAt: now,
  };

  if (status === 'error') {
    if (!cache.brokenFiles.includes(key)) cache.brokenFiles.push(key);
    cache.tasksFailed++;
  } else {
    cache.brokenFiles = cache.brokenFiles.filter(f => f !== key);
    cache.tasksDone++;
  }

  _addHistory(cache, status === 'error' ? 'file_error' : 'file_written',
    `${key} (${lines} lines)`);
  saveCache(cache);
}

function recordCommand(cache, cmd, exitCode, errorText) {
  const now = new Date().toISOString();
  cache.commands.push({ cmd, exitCode, error: errorText || null, ts: now });

  if (exitCode !== 0) {
    cache.tasksFailed++;
    const msg = `Command failed (exit ${exitCode}): ${cmd}`;
    if (!cache.errors.includes(msg)) cache.errors.push(msg);
    if (errorText) {
      const errMsg = errorText.trim().split('\n')[0].slice(0, 120);
      if (!cache.errors.includes(errMsg)) cache.errors.push(errMsg);
    }
    _addHistory(cache, 'command_failed', `${cmd} → exit ${exitCode}`);
  } else {
    cache.tasksDone++;
    _addHistory(cache, 'command_ok', cmd);
  }
  saveCache(cache);
}

function recordError(cache, errText) {
  const msg = errText.trim().split('\n')[0].slice(0, 200);
  if (!cache.errors.includes(msg)) cache.errors.push(msg);
  _addHistory(cache, 'error', msg);
  saveCache(cache);
}

function recordTokens(cache, count) {
  cache.totalTokens = (cache.totalTokens || 0) + count;
  saveCache(cache);
}

function _addHistory(cache, event, detail) {
  cache.history.push({ ts: new Date().toISOString(), event, detail });
  if (cache.history.length > 100) cache.history = cache.history.slice(-100);
}

function buildSessionContext(cache) {
  if (!cache) return '';

  const lines = [];
  lines.push('═══ SESSION STATE (live cache — read this carefully) ═══');

  const total  = cache.tasksDone + cache.tasksFailed;
  const pct    = total > 0 ? Math.round((cache.tasksDone / total) * 100) : 0;
  lines.push(`Progress: ${cache.tasksDone} done · ${cache.tasksFailed} failed · ${pct}% success`);
  lines.push(`Session started: ${cache.sessionStart} · CWD: ${cache.cwd}`);

  const fileKeys = Object.keys(cache.files);
  if (fileKeys.length > 0) {
    lines.push('');
    lines.push('Files this session:');
    for (const [fp, info] of Object.entries(cache.files)) {
      const tag = info.broken ? '❌ BROKEN' : info.status === 'created' ? '✅ OK' : '✏️  modified';
      lines.push(`  ${tag}  ${fp}  (${info.lines} lines)${info.lastError ? ' — last error: ' + info.lastError.slice(0, 80) : ''}`);
    }
  }

  if (cache.brokenFiles.length > 0) {
    lines.push('');
    lines.push('⚠ BROKEN FILES NEEDING FIX: ' + cache.brokenFiles.join(', '));
  }

  if (cache.errors.length > 0) {
    lines.push('');
    lines.push('Recent errors (last 5):');
    cache.errors.slice(-5).forEach(e => lines.push('  • ' + e));
  }

  const recentCmds = cache.commands.slice(-5);
  if (recentCmds.length > 0) {
    lines.push('');
    lines.push('Recent commands:');
    recentCmds.forEach(c => {
      const status = c.exitCode === 0 ? '✅' : '❌';
      lines.push(`  ${status} ${c.cmd}${c.exitCode !== 0 ? ' (exit ' + c.exitCode + ')' : ''}`);
    });
  }

  lines.push('═══════════════════════════════════════════════════════');
  return lines.join('\n');
}

function resetCache() {
  const cache = freshCache();
  saveCache(cache);
  return cache;
}

module.exports = {
  loadCache, saveCache, freshCache, resetCache,
  recordFile, recordCommand, recordError, recordTokens,
  buildSessionContext,
  CACHE_PATH,
};
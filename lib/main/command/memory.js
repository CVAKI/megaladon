'use strict';

const { C, cr, kp, ab, sd, dg, vt, dm, rf, tl, wh } = require('../../colors');
const { saveMemory, updateMemory, sanitizeMemory }     = require('../../config');
const sessionCache = require('../../session-cache');

// ─── /memory ──────────────────────────────────────────────────────────────────
async function handleMemory(text, ctx) {
  const arg = text.slice(7).trim();

  // ── /memory  or  /memory show ─────────────────────────────────────────────
  if (!arg || arg === 'show') {
    const tw = Math.min((process.stdout.columns || 80) - 4, 96);
    console.log('\n  ' + vt(C.bold + '🧠 Megaladon Memory') + ab(' — persistent brain + live session cache'));
    console.log('  ' + ab('─'.repeat(tw)));

    // ── Persistent facts ──────────────────────────────────────────────────────
    if (!ctx.mem.facts || !ctx.mem.facts.length) {
      console.log('\n  ' + ab('Persistent facts: ') + sd('none yet') + ab('  (AI saves with @@MEMORY: key=value)'));
    } else {
      console.log('\n  ' + vt(C.bold + 'Persistent Facts') + ab(' (' + ctx.mem.facts.length + ')'));
      ctx.mem.facts.forEach(f =>
          console.log('  ' + vt('  ' + (f.key || '').padEnd(24)) + ab('→ ') + sd(String(f.value || '').slice(0, 80)))
      );
    }

    // ── Past session summaries ────────────────────────────────────────────────
    if (ctx.mem.sessionSummaries?.length) {
      console.log('\n  ' + vt(C.bold + 'Past Sessions') + ab(' (' + ctx.mem.sessionSummaries.length + ')'));
      ctx.mem.sessionSummaries.slice(-3).forEach(s =>
          console.log('  ' + ab('  ' + (s.date || '').slice(0, 10) + ' · ') + dm((s.summary || '').slice(0, 80)))
      );
    }

    // ── Live session cache (task/file/error tracking) ─────────────────────────
    try {
      const cache = sessionCache.loadCache();
      const fileKeys   = Object.keys(cache.files || {});
      const broken     = Object.entries(cache.files || {}).filter(([, v]) => v.broken).map(([k]) => k);
      const totalTasks = (cache.tasksDone || 0) + (cache.tasksFailed || 0);
      const pct        = totalTasks > 0 ? Math.round((cache.tasksDone / totalTasks) * 100) : 0;

      console.log('\n  ' + vt(C.bold + 'Live Session Cache') + ab(' (~/.meg/session-cache.json)'));
      console.log('  ' + ab('  Started:  ') + sd((cache.sessionStart || '').slice(0, 19).replace('T', ' ')));
      console.log('  ' + ab('  CWD:      ') + sd(cache.cwd || process.cwd()));
      console.log('  ' + ab('  Progress: ') +
          kp(cache.tasksDone + ' done') + ab(' · ') +
          rf(cache.tasksFailed + ' failed') + ab(' · ') +
          sd(pct + '% success'));
      console.log('  ' + ab('  Tokens:   ') + sd(((cache.totalTokens || 0)).toLocaleString()));

      if (fileKeys.length) {
        console.log('\n  ' + vt(C.bold + 'Files This Session') + ab(' (' + fileKeys.length + ')'));
        for (const [fp, info] of Object.entries(cache.files || {})) {
          const icon = info.broken ? rf('✘ BROKEN') : kp('✔ OK    ');
          const err  = info.broken && info.lastError
              ? ab('  — ') + rf(String(info.lastError).split('\n')[0].slice(0, 60))
              : '';
          console.log('  ' + icon + '  ' + sd(fp) + ab(' (' + info.lines + ' lines)') + err);
        }
      }

      if (broken.length) {
        console.log('\n  ' + rf(C.bold + '⚠ BROKEN FILES NEEDING FIX:'));
        broken.forEach(f => console.log('  ' + rf('  → ') + sd(f)));
      }

      if ((cache.errors || []).length) {
        console.log('\n  ' + rf(C.bold + 'Recent Errors') + ab(' (last 3)'));
        (cache.errors || []).slice(-3).forEach(e =>
            console.log('  ' + rf('  • ') + dm(String(e).slice(0, 100)))
        );
      }

      const recentCmds = (cache.commands || []).slice(-5);
      if (recentCmds.length) {
        console.log('\n  ' + vt(C.bold + 'Recent Commands') + ab(' (last 5)'));
        recentCmds.forEach(c => {
          const ok = c.exitCode === 0;
          console.log('  ' + (ok ? kp('  ✔') : rf('  ✘')) + ' ' + sd(String(c.cmd || '').slice(0, 80)));
        });
      }
    } catch (cacheErr) {
      console.log('\n  ' + ab('Session cache: ') + dg('unavailable (' + cacheErr.message + ')'));
    }

    console.log('');

    // ── /memory clean ──────────────────────────────────────────────────────────
  } else if (arg === 'clean') {
    const before = ctx.mem.facts.length;
    sanitizeMemory(ctx.mem);
    // FIX: was a plain saveMemory(ctx.mem) — with the new merge-safe
    // saveMemory() in lib/config.js (which unions this process's facts with
    // whatever's currently on disk, to stop concurrent Megaladon instances
    // from clobbering each other), a garbage fact removed here would simply
    // get merged back in from disk on this exact same save, since removing
    // something looks identical to "this process just never happened to
    // have it." force:true makes this an explicit, non-merged write, so the
    // clean-up actually sticks.
    saveMemory(ctx.mem, { force: true });
    const removed = before - ctx.mem.facts.length;
    console.log('\n  ' + kp('✔ Memory cleaned — ') + sd(removed + ' garbage fact' + (removed !== 1 ? 's' : '') + ' removed') + ab(', ' + ctx.mem.facts.length + ' clean facts remain'));

    // ── /memory clear ──────────────────────────────────────────────────────────
  } else if (arg === 'clear') {
    ctx.mem.facts = []; ctx.mem.sessionSummaries = [];
    // FIX: same reasoning as /memory clean above — an explicit wipe must
    // bypass the merge-safe logic entirely, or the very next saveMemory()
    // call (from any process, including a stale concurrent one) would just
    // union the "cleared" empty array with whatever was still on disk and
    // bring the old facts right back.
    saveMemory(ctx.mem, { force: true });
    console.log('\n  ' + kp('✔ Persistent memory cleared.'));

    // ── /memory clear-cache ────────────────────────────────────────────────────
  } else if (arg === 'clear-cache') {
    try {
      sessionCache.resetCache();
      console.log('\n  ' + kp('✔ Session cache cleared — fresh start for file/error tracking.'));
    } catch (e) {
      console.log('\n  ' + rf('✘ Could not clear cache: ') + e.message);
    }

    // ── /memory set <key> <value> ──────────────────────────────────────────────
  } else if (arg.startsWith('set ')) {
    const parts = arg.slice(4).trim().split(/\s+/);
    const key   = parts[0].replace(/:$/, '');
    const val   = parts.slice(1).join(' ').split(/\r?\n/)[0].trim();
    if (key && val) {
      updateMemory(ctx.mem, [{ key, value: val }]); saveMemory(ctx.mem);
      console.log('\n  ' + kp('✔ Memory saved: ') + sd(key + ' → ' + val));
    } else {
      console.log('\n  ' + dg('Usage: /memory set <key> <value>'));
    }

    // ── /memory help ───────────────────────────────────────────────────────────
  } else {
    console.log('\n  ' + vt(C.bold + '/memory commands'));
    console.log('  ' + ab('  /memory           ') + sd('show all memory + live session cache'));
    console.log('  ' + ab('  /memory set k v   ') + sd('save a persistent fact'));
    console.log('  ' + ab('  /memory clean     ') + sd('remove garbage/duplicate facts'));
    console.log('  ' + ab('  /memory clear     ') + sd('wipe all persistent facts'));
    console.log('  ' + ab('  /memory clear-cache') + sd('reset live session cache (files/errors)'));
  }

  ctx.prompt(); return true;
}

module.exports = { handleMemory };
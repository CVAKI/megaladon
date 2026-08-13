'use strict';

const path = require('path');
const { execSync } = require('child_process');
const { ab, kp } = require('../../colors');

// This file lives at lib/main/aiHandler/toolRunner.js — three levels below
// the Megaladon install root.
const MEGALADON_ROOT = path.resolve(__dirname, '../../..');

// ─── Generic "run a tool, auto-install on missing module, retry once" wrapper ─
// Any tool function (webSearch, listInbox, sendEmail, abilities, future
// tools...) can be called through this. If it fails with "Cannot find
// module X", we npm install X and retry exactly once. One place, works for
// every tool — not special-cased per feature.
function extractMissingModule(errText) {
  const m = /Cannot find module '([^'.][^']*)'/.exec(errText || '');
  if (!m) return null;
  const name = m[1];
  return name.startsWith('@') ? name.split('/').slice(0, 2).join('/') : name.split('/')[0];
}

async function runToolWithAutoInstall(toolFn, ...args) {
  try {
    return await toolFn(...args);
  } catch (err) {
    const missing = extractMissingModule(err.message || String(err));
    if (!missing) throw err; // not a missing-module error — don't swallow it

    console.log('\n  ' + ab('⬇ missing package "' + missing + '" — installing...'));
    try {
      // FIX: was `cwd: process.cwd()` — see lib/main/command/tools.js for
      // the full explanation. Installing into the user's current terminal
      // directory instead of Megaladon's own root is why "imap-simple"
      // "installed successfully" and then failed with the exact same
      // Cannot-find-module error on every single retry, forever.
      execSync('npm install ' + missing + ' --save', { cwd: MEGALADON_ROOT, stdio: 'ignore', timeout: 60000 });
      console.log('  ' + kp('✔ installed ' + missing + ' — retrying...'));
    } catch (installErr) {
      throw new Error('Missing module "' + missing + '" and auto-install failed: ' + installErr.message);
    }
    try { delete require.cache[require.resolve(missing)]; } catch (_) {}
    return await toolFn(...args); // one retry — if it still throws, let it propagate
  }
}

// ─── Abilities (screen / mouse / keyboard) runner ─────────────────────────────
// Lives in skills/abilities at the project root, outside lib/. Deps
// (@nut-tree-fork/nut-js, screenshot-desktop) auto-install on that module's
// own first require(); this wrapper additionally routes through
// runToolWithAutoInstall in case that self-install silently failed (offline,
// permissions, etc.) so a retry still gets one more shot before giving up.
let _abilities = null;
function loadAbilities() {
  if (_abilities) return _abilities;
  try {
    _abilities = require(path.join(MEGALADON_ROOT, 'skills', 'abilities'));
  } catch (_) {
    _abilities = null; // not installed — caller gets a clear error, nothing crashes
  }
  return _abilities;
}

// directives.abilities is the array produced by parseDirectives() in
// directives.js — [{ action, args }, ...]. Call this from handleAiMessage()
// wherever @@RUN: output currently gets executed and fed back to the model.
//
//   const { runAbilities } = require('./toolRunner');
//   if (directives.abilities.length) {
//     const { ran, results, text, error } = await runAbilities(directives.abilities);
//     if (ran) messages.push({ role: 'user', content: text }); // feed results back, same as self-test output
//     else console.log('  ' + ab(error));
//   }
async function runAbilities(abilityDirectives) {
  if (!abilityDirectives || !abilityDirectives.length) return { ran: false, results: [] };

  const abilities = loadAbilities();
  if (!abilities) {
    return {
      ran: false,
      results: [],
      error: 'Abilities skill not installed — run: cd skills/abilities && npm install  (see skills/abilities/README.md)',
    };
  }

  return runToolWithAutoInstall(async () => {
    const results = await abilities.runAllAbilities(abilityDirectives);
    const text    = abilities.formatAbilityResults(results);
    const ok      = results.every(r => r.ok);
    return { ran: true, ok, results, text };
  });
}

module.exports = {
  extractMissingModule,
  runToolWithAutoInstall,
  runAbilities,
  loadAbilities,
  MEGALADON_ROOT,
};
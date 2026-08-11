'use strict';

const path = require('path');
const { execSync } = require('child_process');
const { ab, kp } = require('../../colors');

// This file lives at lib/main/aiHandler/toolRunner.js — three levels below
// the Megaladon install root.
const MEGALADON_ROOT = path.resolve(__dirname, '../../..');

// ─── Generic "run a tool, auto-install on missing module, retry once" wrapper ─
// Any tool function (webSearch, listInbox, sendEmail, future tools...) can be
// called through this. If it fails with "Cannot find module X", we npm install
// X and retry exactly once. One place, works for every tool — not special-cased
// per feature.
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

module.exports = { extractMissingModule, runToolWithAutoInstall, MEGALADON_ROOT };

'use strict';

const { parseSocket, ensureSkillsLayout } = require('./registry');
const { loadGate, getPluginDir }          = require('./loader');

// ─── Build a command→plugin lookup from socket.txt ────────────────────────────
// Returns Map<trigger, zipname>
function buildCommandMap() {
  ensureSkillsLayout();
  const map = new Map();
  for (const plugin of parseSocket()) {
    for (const cmd of plugin.commands) {
      // Register base trigger (e.g. /pdfcry) — match both exact and with args
      map.set(cmd.trigger.toLowerCase(), plugin.zipname);
    }
  }
  return map;
}

// ─── Dispatch a command to a plugin ──────────────────────────────────────────
// Returns:
//   { handled: true, output }   if a plugin handled it
//   { handled: false }          if no plugin matches
async function dispatchPlugin(text, ctx) {
  if (!text.startsWith('/')) return { handled: false };

  const parts   = text.trim().split(/\s+/);
  const trigger = parts[0].toLowerCase();   // e.g. /pdfcry
  const args    = parts.slice(1);            // rest

  const map     = buildCommandMap();
  const zipname = map.get(trigger);
  if (!zipname) return { handled: false };

  const gate = loadGate(zipname);
  if (!gate) {
    console.log('\n  \x1b[38;5;196m✘ Plugin "' + zipname + '" is registered but gate.js failed to load.\x1b[0m');
    console.log('  \x1b[38;5;245mTry: /skill install ' + zipname + '  to reinstall.\x1b[0m\n');
    return { handled: true, output: null };
  }

  const pluginDir = getPluginDir(zipname);

  let result;
  try {
    result = await gate.handle({ command: trigger, args, ctx, pluginDir });
  } catch (e) {
    console.log('\n  \x1b[38;5;196m✘ Plugin error (' + zipname + '): ' + e.message + '\x1b[0m\n');
    return { handled: true, output: null };
  }

  return { handled: true, output: result };
}

// ─── Get all registered plugin triggers ──────────────────────────────────────
function registeredTriggers() {
  return Array.from(buildCommandMap().keys());
}

module.exports = { dispatchPlugin, registeredTriggers, buildCommandMap };

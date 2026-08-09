'use strict';

/**
 * Megaladon Plugin Engine
 * ──────────────────────
 * Provides the ZIP-based plugin mechanism for extending Megaladon
 * with custom slash commands without modifying core source files.
 *
 * Public API used by lib/main/commands.js and lib/main/command/skills.js
 */

const { ensureSkillsLayout, parseSocket, PLUGS_DIR, CACHE_DIR, SOCKET_PATH } = require('./registry');
const { installPlugin, uninstallPlugin, listPlugins, listAvailableZips }     = require('./installer');
const { dispatchPlugin, registeredTriggers }                                  = require('./dispatcher');
const { loadGate, invalidateGate }                                            = require('./loader');

// Bootstrap: ensure skills/ folder layout exists on first require
ensureSkillsLayout();

module.exports = {
  // Installation
  installPlugin,
  uninstallPlugin,

  // Listings
  listPlugins,
  listAvailableZips,

  // Runtime dispatch
  dispatchPlugin,
  registeredTriggers,

  // Low-level
  parseSocket,
  loadGate,
  invalidateGate,

  // Paths (for diagnostics)
  PLUGS_DIR,
  CACHE_DIR,
  SOCKET_PATH,
};

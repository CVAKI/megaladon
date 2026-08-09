'use strict';

const fs   = require('fs');
const path = require('path');
const { CACHE_DIR, parseSocket, ensureSkillsLayout } = require('./registry');

// ─── Cache of loaded gate modules (avoid repeated require() busts) ────────────
const _gateCache = new Map();

// ─── Load gate.js for a plugin ────────────────────────────────────────────────
function loadGate(zipname) {
  if (_gateCache.has(zipname)) return _gateCache.get(zipname);

  const gatePath = path.join(CACHE_DIR, zipname, 'gate.js');
  if (!fs.existsSync(gatePath)) return null;

  try {
    // Clear from require cache so hot-reload works after reinstall
    const resolved = require.resolve(gatePath);
    delete require.cache[resolved];

    const gate = require(gatePath);
    if (typeof gate.handle !== 'function') {
      throw new Error('gate.js must export a handle(opts) function');
    }
    _gateCache.set(zipname, gate);
    return gate;
  } catch (e) {
    console.error('  [PluginLoader] Failed to load gate.js for ' + zipname + ': ' + e.message);
    return null;
  }
}

// ─── Invalidate gate cache for a plugin (called on reinstall/remove) ──────────
function invalidateGate(zipname) {
  _gateCache.delete(zipname);
  try {
    const gatePath = path.join(CACHE_DIR, zipname, 'gate.js');
    const resolved = require.resolve(gatePath);
    delete require.cache[resolved];
  } catch (_) {}
}

// ─── Get plugin dir path (passed to gate.handle as pluginDir) ─────────────────
function getPluginDir(zipname) {
  return path.join(CACHE_DIR, zipname);
}

// ─── Check if a plugin is installed ──────────────────────────────────────────
function isInstalled(zipname) {
  ensureSkillsLayout();
  return parseSocket().some(p => p.zipname === zipname);
}

module.exports = { loadGate, invalidateGate, getPluginDir, isInstalled };

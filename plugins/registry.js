'use strict';

const fs   = require('fs');
const path = require('path');
const os   = require('os');

// ─── Paths ────────────────────────────────────────────────────────────────────
const SKILLS_ROOT = path.join(process.cwd(), 'skills');
const SOCKET_PATH = path.join(SKILLS_ROOT, 'socket.txt');
const PLUGS_DIR   = path.join(SKILLS_ROOT, 'plugs');
const CACHE_DIR   = path.join(SKILLS_ROOT, '.cache');

const SOCKET_DISCLAIMER = `#─────────────────────────────────────────────────────────────────────────────
# Megaladon Plugin Socket — Managed automatically. Do not hand-edit.
#
# DOS:
#   Place only .zip plugin files inside  skills/plugs/
#   Run  /skill install <zipname>  to activate a plugin
#   Each plugin ZIP must contain  plug-connect.json  and  gate.js  at root level
#   Keep ZIP filenames stable — they are used as the plugin identifier
#   One plugin per ZIP; ZIP name must match the inner core folder name
#
# DONTS:
#   Do NOT manually edit this file — entries are written by the plugin engine
#   Do NOT rename a ZIP after it has been installed (breaks the cache link)
#   Do NOT delete files inside  skills/.cache/  directly; use /skill remove
#   Do NOT place non-zip files in  skills/plugs/  (they will be ignored)
#   Do NOT modify  plug-connect.json  or  gate.js  inside an installed plugin
#       without re-running  /skill install  to refresh the registry entry
#─────────────────────────────────────────────────────────────────────────────

`;

// ─── Ensure dirs + socket.txt exist ──────────────────────────────────────────
function ensureSkillsLayout() {
  [SKILLS_ROOT, PLUGS_DIR, CACHE_DIR].forEach(d => {
    if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
  });
  if (!fs.existsSync(SOCKET_PATH)) {
    fs.writeFileSync(SOCKET_PATH, SOCKET_DISCLAIMER, 'utf8');
  }
}

// ─── Parse socket.txt → array of plugin entries ──────────────────────────────
// Each entry looks like:
//   ["<description>":(<id>)].@{
//       [zip{"brief"}]==(/cmd),
//       ...
//   };//zip
function parseSocket() {
  ensureSkillsLayout();
  const raw = fs.readFileSync(SOCKET_PATH, 'utf8');
  const plugins = [];

  // Match each plugin block  ["...":(<id>)].@{ ... };//zipname
  const blockRe = /\["([^"]+)":?\s*\(([^)]+)\)\]\.@\{([^}]+)\};\s*\/\/([^\n]+)/g;
  let m;
  while ((m = blockRe.exec(raw)) !== null) {
    const description = m[1].trim();
    const id          = m[2].trim();
    const body        = m[3];
    const zipname     = m[4].trim();

    // Parse command entries inside the block
    // format: [zipname{"brief"}]==(/cmd)
    const cmdRe = /\[([^\]]+)\{"([^"]+)"\]\]==\(([^)]+)\)/g;
    const commands = [];
    let cm;
    while ((cm = cmdRe.exec(body)) !== null) {
      commands.push({ pack: cm[1].trim(), brief: cm[2].trim(), trigger: cm[3].trim() });
    }

    plugins.push({ zipname, id, description, commands });
  }
  return plugins;
}

// ─── Serialise one plugin entry to socket format ──────────────────────────────
function serializeEntry(entry) {
  const { zipname, id, description, commands } = entry;
  const cmdLines = commands
    .map(c => `    [${c.pack}{"${c.brief}"}]==(${c.trigger})`)
    .join(',\n');
  return `["${description}":(${id})].@{\n${cmdLines}\n};//${zipname} pack`;
}

// ─── Write plugins array back to socket.txt ───────────────────────────────────
function writeSocket(plugins) {
  ensureSkillsLayout();
  const body = plugins.map(serializeEntry).join('\n\n') + (plugins.length ? '\n' : '');
  fs.writeFileSync(SOCKET_PATH, SOCKET_DISCLAIMER + body, 'utf8');
}

// ─── Add or update a plugin entry ────────────────────────────────────────────
function upsertPlugin(entry) {
  const plugins = parseSocket();
  const idx = plugins.findIndex(p => p.zipname === entry.zipname);
  if (idx >= 0) plugins[idx] = entry; else plugins.push(entry);
  writeSocket(plugins);
}

// ─── Remove a plugin entry ────────────────────────────────────────────────────
function removePlugin(zipname) {
  const plugins = parseSocket().filter(p => p.zipname !== zipname);
  writeSocket(plugins);
}

// ─── Generate a short deterministic ID from zip name + timestamp ──────────────
function generateId(zipname) {
  const ts  = Date.now().toString(36);
  const hash = zipname.split('').reduce((a, c) => ((a << 5) - a + c.charCodeAt(0)) | 0, 0);
  return `${zipname}-${Math.abs(hash).toString(36).slice(0, 4)}${ts.slice(-3)}`;
}

module.exports = {
  SKILLS_ROOT, SOCKET_PATH, PLUGS_DIR, CACHE_DIR,
  ensureSkillsLayout, parseSocket, writeSocket,
  upsertPlugin, removePlugin, generateId,
};

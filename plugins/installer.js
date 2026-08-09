'use strict';

const fs            = require('fs');
const path          = require('path');
const { execSync, spawnSync } = require('child_process');

const {
  PLUGS_DIR, CACHE_DIR,
  ensureSkillsLayout, parseSocket,
  upsertPlugin, removePlugin, generateId,
} = require('./registry');

// ─── Cross-platform ZIP extractor ─────────────────────────────────────────────
function extractZip(zipPath, destDir) {
  fs.mkdirSync(destDir, { recursive: true });
  const platform = process.platform;

  if (platform === 'win32') {
    // PowerShell Expand-Archive (built-in, no 3rd-party needed)
    const ps = `Expand-Archive -Path '${zipPath}' -DestinationPath '${destDir}' -Force`;
    const r = spawnSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', ps], {
      stdio: 'pipe',
    });
    if (r.status !== 0) {
      throw new Error('PowerShell extract failed: ' + (r.stderr?.toString() || 'unknown'));
    }
  } else {
    // Linux / macOS — prefer unzip, fallback to python zipfile
    const hasUnzip = spawnSync('which', ['unzip'], { stdio: 'pipe' }).status === 0;
    if (hasUnzip) {
      const r = spawnSync('unzip', ['-o', zipPath, '-d', destDir], { stdio: 'pipe' });
      if (r.status !== 0) throw new Error('unzip failed: ' + r.stderr?.toString());
    } else {
      // Python fallback (always available on modern Linux/macOS)
      const pyScript = `
import zipfile, sys
with zipfile.ZipFile(sys.argv[1]) as z:
    z.extractall(sys.argv[2])
      `.trim();
      const r = spawnSync('python3', ['-c', pyScript, zipPath, destDir], { stdio: 'pipe' });
      if (r.status !== 0) throw new Error('python3 unzip failed: ' + r.stderr?.toString());
    }
  }
}

// ─── Read plug-connect.json from extracted dir ────────────────────────────────
function readPlugConnect(extractedDir) {
  const p = path.join(extractedDir, 'plug-connect.json');
  if (!fs.existsSync(p))
   throw new Error('plug-connect.json not found in plugin. Is this a valid Megaladon plugin?');
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch (e) {
    throw new Error('plug-connect.json is not valid JSON: ' + e.message);
  }
}

// ─── Validate plug-connect.json structure ─────────────────────────────────────
function validateMeta(meta, zipname) {
  const required = ['name', 'version', 'description', 'commands'];
  for (const k of required) {
    if (!meta[k]) throw new Error(`plug-connect.json missing required field: "${k}"`);
  }
  if (!Array.isArray(meta.commands) || meta.commands.length === 0)
    throw new Error('plug-connect.json "commands" must be a non-empty array');
  for (const cmd of meta.commands) {
    if (!cmd.trigger) throw new Error('Each command entry must have a "trigger" field (e.g. "/pdfcry")');
    if (!cmd.brief)   throw new Error('Each command entry must have a "brief" field');
  }
}

// ─── Install a plugin from skills/plugs/<zipname>.zip ────────────────────────
async function installPlugin(zipname, ctx) {
  ensureSkillsLayout();

  // Strip .zip if user typed it
  const baseName = zipname.replace(/\.zip$/i, '');
  const zipPath  = path.join(PLUGS_DIR, baseName + '.zip');

  if (!fs.existsSync(zipPath)) {
    return { ok: false, msg: `Plugin ZIP not found: ${zipPath}\n  Place the .zip inside  skills/plugs/  first.` };
  }

  const destDir = path.join(CACHE_DIR, baseName);

  // Extract
  try {
    extractZip(zipPath, destDir);
  } catch (e) {
    return { ok: false, msg: 'ZIP extraction failed: ' + e.message };
  }

  // Read + validate metadata
  let meta;
  try {
    meta = readPlugConnect(destDir);
    validateMeta(meta, baseName);
  } catch (e) {
    return { ok: false, msg: e.message };
  }

  // Check gate.js exists
  const gatePath = path.join(destDir, 'gate.js');
  if (!fs.existsSync(gatePath))
    return { ok: false, msg: 'gate.js not found in plugin root. The plugin is malformed.' };

  // Check already installed
  const existing = parseSocket().find(p => p.zipname === baseName);
  const newId    = existing ? existing.id : generateId(baseName);

  // Write back the assigned ID into plug-connect.json (if changed)
  if (!existing || meta.id !== newId) {
    meta.id = newId;
    fs.writeFileSync(path.join(destDir, 'plug-connect.json'), JSON.stringify(meta, null, 2), 'utf8');
  }

  // Build socket entry
  const commands = meta.commands.map(c => ({
    pack:    baseName,
    brief:   c.brief,
    trigger: c.trigger,
  }));

  upsertPlugin({ zipname: baseName, id: newId, description: meta.description, commands });

  // Build AI skill context so the model knows about this plugin
  if (ctx && ctx.skills) {
    const skillEntry = {
      name:        meta.name,
      description: meta.description,
      prompt: `Plugin: ${meta.name} v${meta.version}\n` +
              `Description: ${meta.description}\n` +
              `Commands:\n` +
              meta.commands.map(c => `  ${c.trigger}  — ${c.brief}\n  Usage: ${c.usage || c.trigger + ' <args>'}`).join('\n'),
    };
    const already = ctx.skills.find(s => s.name === meta.name);
    if (!already) ctx.skills.push(skillEntry);
    else Object.assign(already, skillEntry);
  }

  return {
    ok:   true,
    id:   newId,
    meta,
    msg:  `✔ Plugin installed: ${meta.name} v${meta.version} (${newId})`,
  };
}

// ─── Uninstall a plugin ───────────────────────────────────────────────────────
function uninstallPlugin(zipname, ctx) {
  ensureSkillsLayout();
  const baseName = zipname.replace(/\.zip$/i, '');
  const destDir  = path.join(CACHE_DIR, baseName);

  removePlugin(baseName);

  // Remove from ctx.skills
  if (ctx && ctx.skills) {
    const idx = ctx.skills.findIndex(s => s.name.toLowerCase() === baseName.toLowerCase());
    if (idx >= 0) ctx.skills.splice(idx, 1);
  }

  // Remove extracted cache
  if (fs.existsSync(destDir)) {
    fs.rmSync(destDir, { recursive: true, force: true });
  }

  return { ok: true, msg: `✔ Plugin removed: ${baseName}` };
}

// ─── List installed plugins ───────────────────────────────────────────────────
function listPlugins() {
  ensureSkillsLayout();
  return parseSocket();
}

// ─── List available (not installed) ZIPs in skills/plugs/ ────────────────────
function listAvailableZips() {
  ensureSkillsLayout();
  if (!fs.existsSync(PLUGS_DIR)) return [];
  return fs.readdirSync(PLUGS_DIR)
    .filter(f => f.endsWith('.zip'))
    .map(f => f.replace(/\.zip$/i, ''));
}

module.exports = { installPlugin, uninstallPlugin, listPlugins, listAvailableZips };

'use strict';

const fs   = require('fs');
const path = require('path');

const { C, rf, kp, ab, sd, dg, cr }                     = require('../../colors');
const { SKILL_REGISTRY, saveSkill, SKILLS_DIR }          = require('../../config');
const { formatMD }                                        = require('../../render');

// ─── Plugin engine (lazy-loaded to avoid circular deps) ───────────────────────
function plugins() { return require('../../../plugins/index'); }

// ─── /skill ───────────────────────────────────────────────────────────────────
async function handleSkill(text, ctx) {
  const args = text.slice(6).trim().split(/\s+/);
  const sub  = args[0];

  // ── /skill list ─────────────────────────────────────────────────────────────
  if (!sub || sub === 'list') {
    // Built-in skills
    console.log('\n  ' + rf(C.bold + 'Skill Registry'));
    Object.entries(SKILL_REGISTRY).forEach(([k, s]) => {
      const inst = ctx.skills.find(sk => sk.name === s.name);
      console.log('  ' + rf(k.padEnd(14)) + sd(s.description.padEnd(50)) + (inst ? kp(' ✔ installed') : ''));
    });
    if (ctx.skills.length) {
      const builtinNames = new Set(Object.values(SKILL_REGISTRY).map(s => s.name));
      const builtinInstalled = ctx.skills.filter(s => builtinNames.has(s.name));
      if (builtinInstalled.length) {
        console.log('\n  ' + rf(C.bold + 'Installed Skills'));
        builtinInstalled.forEach(s => console.log('  ' + kp('✔ ') + sd(s.name) + ab(' — ' + s.description)));
      }
    }
    console.log('\n  ' + ab('Install with: ') + sd('/skill install react') + ab(' (or any name above)'));

    // Plugin registry
    const installed = plugins().listPlugins();
    const available = plugins().listAvailableZips();
    const uninstalled = available.filter(z => !installed.find(p => p.zipname === z));

    if (installed.length) {
      console.log('\n  ' + cr(C.bold + '⚡ Installed Plugins'));
      for (const p of installed) {
        console.log('  ' + kp('◈ ') + sd(p.zipname) + ab(' (' + p.id + ')'));
        for (const c of p.commands) {
          console.log('    ' + ab(c.trigger.padEnd(18)) + sd(c.brief));
        }
      }
    }
    if (uninstalled.length) {
      console.log('\n  ' + ab('Available plugin ZIPs (not installed):'));
      uninstalled.forEach(z => console.log('  ' + sd('  ' + z + '.zip')));
      console.log('  ' + ab('Install with: ') + sd('/skill install <zipname>'));
    }
    if (!installed.length && !uninstalled.length) {
      console.log('\n  ' + dg('No plugins found in skills/plugs/'));
      console.log('  ' + ab('Place a .zip plugin file there, then run: ') + sd('/skill install <zipname>'));
    }
  }

  // ── /skill install <name|zipname> ───────────────────────────────────────────
  else if (sub === 'install') {
    const sn = args[1]?.toLowerCase();
    if (!sn) { console.log('\n  ' + dg('Usage: /skill install <name|zipname>')); ctx.prompt(); return true; }

    // Try built-in skill first
    const reg = SKILL_REGISTRY[sn];
    if (reg) {
      if (ctx.skills.find(s => s.name === reg.name)) {
        console.log('\n  ' + kp('Already installed: ') + sd(reg.name));
        ctx.prompt(); return true;
      }
      saveSkill(reg); ctx.skills.push(reg);
      console.log('\n  ' + kp('✔ Installed: ') + sd(reg.name) + ab(' — now active in all AI responses'));
      ctx.prompt(); return true;
    }

    // Try plugin ZIP
    console.log('\n  ' + ab('⟳ Installing plugin: ') + sd(sn) + ' ...');
    const result = await plugins().installPlugin(sn, ctx);
    if (result.ok) {
      console.log('  ' + kp(result.msg));
      console.log('  ' + ab('ID: ') + sd(result.id));
      console.log('  ' + ab('Commands registered:'));
      for (const c of result.meta.commands) {
        console.log('    ' + sd(c.trigger.padEnd(18)) + ab(c.brief));
      }
      console.log('  ' + ab('Use ') + sd(result.meta.commands[0]?.trigger || '/plugin') + ab(' to run it.'));
    } else {
      console.log('  ' + dg('✘ ' + result.msg));
    }
  }

  // ── /skill remove <name|zipname> ────────────────────────────────────────────
  else if (sub === 'remove') {
    const sn  = args[1];

    // Check built-in skills
    const idx = ctx.skills.findIndex(s => s.name.toLowerCase() === sn?.toLowerCase());
    if (idx >= 0) {
      try { fs.unlinkSync(path.join(SKILLS_DIR, ctx.skills[idx].name.toLowerCase().replace(/\s+/g, '_') + '.json')); } catch (_) {}
      ctx.skills.splice(idx, 1);
      console.log('\n  ' + kp('✔ Removed: ') + sd(sn));
      ctx.prompt(); return true;
    }

    // Try plugin
    const installed = plugins().listPlugins();
    const baseName  = sn?.replace(/\.zip$/i, '');
    if (installed.find(p => p.zipname === baseName)) {
      plugins().invalidateGate(baseName);
      const r = plugins().uninstallPlugin(baseName, ctx);
      console.log('\n  ' + (r.ok ? kp(r.msg) : dg('✘ ' + r.msg)));
    } else {
      console.log('\n  ' + dg('Skill/plugin not found: ' + sn));
    }
  }

  // ── /skill show <name|zipname> ──────────────────────────────────────────────
  else if (sub === 'show') {
    const sn = args[1];

    // Built-in skill
    const sk = ctx.skills.find(s => s.name.toLowerCase() === sn?.toLowerCase()) || SKILL_REGISTRY[sn?.toLowerCase()];
    if (sk) {
      console.log('\n  ' + rf(C.bold + sk.name));
      console.log('  ' + ab(sk.description));
      console.log('\n' + formatMD('```\n' + sk.prompt + '\n```'));
      ctx.prompt(); return true;
    }

    // Plugin
    const baseName = sn?.replace(/\.zip$/i, '');
    const plugin   = plugins().listPlugins().find(p => p.zipname === baseName);
    if (plugin) {
      console.log('\n  ' + cr(C.bold + '◈ Plugin: ' + plugin.zipname));
      console.log('  ' + ab('ID:') + ' ' + sd(plugin.id));
      console.log('  ' + ab(plugin.description));
      console.log('\n  ' + ab('Commands:'));
      for (const c of plugin.commands) {
        console.log('    ' + sd(c.trigger.padEnd(18)) + ab(c.brief));
      }
    } else {
      console.log('\n  ' + dg('Skill/plugin not found: ' + sn));
    }
  }

  // ── /skill plugins ──────────────────────────────────────────────────────────
  else if (sub === 'plugins') {
    const installed  = plugins().listPlugins();
    const available  = plugins().listAvailableZips();
    console.log('\n  ' + cr(C.bold + '⚡ Plugin System'));
    console.log('  ' + ab('Socket:   ') + sd(plugins().SOCKET_PATH));
    console.log('  ' + ab('Plugs dir:') + sd(plugins().PLUGS_DIR));
    console.log('  ' + ab('Cache:    ') + sd(plugins().CACHE_DIR));
    console.log('\n  ' + ab('Installed (' + installed.length + '):'));
    if (!installed.length) console.log('    ' + dg('none'));
    for (const p of installed) {
      console.log('    ' + kp('◈ ') + sd(p.zipname) + ab(' — ' + p.description.slice(0, 60)));
    }
    console.log('\n  ' + ab('Available ZIPs in plugs/ (' + available.length + '):'));
    if (!available.length) console.log('    ' + dg('none'));
    available.forEach(z => {
      const inst = installed.find(p => p.zipname === z);
      console.log('    ' + (inst ? kp('✔ ') : '  ') + sd(z));
    });
  }

  else {
    console.log('\n  ' + dg('Unknown /skill subcommand: ' + sub));
    console.log('  ' + ab('Subcommands: list · install · remove · show · plugins'));
  }

  ctx.prompt(); return true;
}

module.exports = { handleSkill };
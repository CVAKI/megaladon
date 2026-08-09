'use strict';

const { wh, cr, kp, rf, ab, sd, dg, vt, tl, dm } = require('../../colors');
const { saveConfig }                               = require('../../config');
const { PROVIDERS, ollamaAvailable, ollamaInstall, ollamaStart } = require('../../providers');
const { MODES }                                    = require('../../modes');

// ─── /mode ────────────────────────────────────────────────────────────────────
async function handleMode(text, ctx) {
  const arg        = text.split(/\s+/)[1]?.toLowerCase().replace(/[^a-z]/g, '');
  const validModes = Object.keys(MODES);
  if (!arg) {
    console.log('');
    Object.entries(MODES).forEach(([k, v]) =>
      console.log('  ' + v.colorFn(v.icon + ' ' + v.name.padEnd(12)) + ab('/mode ' + k) + (k === ctx.mode ? cr(' ◀ current') : '')));
  } else if (validModes.includes(arg)) {
    ctx.mode = arg;
    saveConfig({ provider: ctx.providerKey, apiKey: ctx.apiKey, model: ctx.modelId, mode: ctx.mode, autoTest: ctx.autoTest, autoScan: ctx.autoScan });
    console.log('\n  ' + kp('✔ Mode → ') + MODES[arg].colorFn(MODES[arg].icon + ' ' + MODES[arg].name));
    if (arg === 'agent') console.log('  ' + vt('Agent mode: ') + ab('AI will autonomously create and fix files'));
  } else {
    console.log('\n  ' + dg('Unknown mode. Options: ') + validModes.join(' · '));
  }
  ctx.prompt(); return true;
}

// ─── /model ───────────────────────────────────────────────────────────────────
async function handleModel(text, ctx) {
  const arg = text.split(/\s+/)[1];
  if (!arg) {
    console.log('\n  ' + ab('Current: ') + wh(ctx.modelMeta.label || ctx.modelMeta.id));
    ctx.availModels.forEach((m, i) =>
      console.log('  ' + ab('[' + (i + 1) + ']') + ' ' + sd(m.label || m.id) + (m.free ? ' ' + kp('FREE') : '') + (m.id === ctx.modelId ? cr(' ◀') : '')));
    console.log('\n  ' + ab('Type /model <n> to switch.'));
  } else {
    const idx = parseInt(arg) - 1, sel = ctx.availModels[idx];
    if (!sel) console.log('\n  ' + dg('Invalid.'));
    else {
      ctx.modelId = sel.id;
      saveConfig({ provider: ctx.providerKey, apiKey: ctx.apiKey, model: ctx.modelId, mode: ctx.mode, autoTest: ctx.autoTest, autoScan: ctx.autoScan });
      console.log('\n  ' + kp('✔ Model → ') + wh(sel.label || sel.id));
    }
  }
  ctx.prompt(); return true;
}

// ─── /provider ────────────────────────────────────────────────────────────────
async function handleProvider(ctx) {
  console.log('\n  ' + wh('[1]') + ' Anthropic (Claude)' + (ctx.providerKey === 'anthropic' ? cr(' ◀') : ''));
  console.log('  ' + cr('[2]') + ' OpenRouter'         + (ctx.providerKey === 'openrouter' ? cr(' ◀') : ''));
  console.log('  ' + rf('[3]') + ' Groq'               + (ctx.providerKey === 'groq'       ? rf(' ◀') : ''));
  const olOk = await ollamaAvailable();
  console.log('  ' + kp('[4]') + ' Ollama' + (ctx.providerKey === 'ollama' ? kp(' ◀') : '') + ' ' + (olOk ? kp('● running') : rf('○ not running — will auto-install if selected')));
  const ch = await ctx.ask(cr('\n  ❯ ') + ab('Switch [1-4] or Enter to cancel: '));
  const pk = { 1: 'anthropic', 2: 'openrouter', 3: 'groq', 4: 'ollama' }[ch.trim()];
  if (pk) {
    if (pk === 'ollama' && !olOk) {
      console.log('\n  ' + ab('Ollama not found — installing automatically...\n'));
      try {
        await ollamaInstall();
        console.log('\n  ' + kp('✔ Ollama installed!') + ab(' Starting server...'));
        const started = await ollamaStart();
        if (!started) {
          console.log('  ' + rf('⚠ Server did not respond — run: ') + sd('ollama serve'));
          ctx.prompt(); return true;
        }
        console.log('  ' + kp('✔ Ollama server is running!'));
      } catch (e) {
        console.log('  ' + dg('✘ Install failed: ') + e.message);
        console.log('  ' + ab('Install manually → ') + tl('https://ollama.com'));
        ctx.prompt(); return true;
      }
    }
    ctx.providerKey = pk; ctx.modelId = null;
    saveConfig({ provider: ctx.providerKey, apiKey: ctx.apiKey, model: '', mode: ctx.mode, autoTest: ctx.autoTest, autoScan: ctx.autoScan });
    console.log('\n  ' + kp('✔ Switched. Restart megaladon to apply.'));
  }
  ctx.prompt(); return true;
}

// ─── /token ───────────────────────────────────────────────────────────────────
async function handleToken(text, ctx) {
  const args  = text.trim().split(/\s+/);
  const sub   = args[1];

  const PRESETS = [
    { tokens: 1024,  label: 'Minimal',   desc: 'Short answers only — no full files',                 warn: true  },
    { tokens: 2048,  label: 'Basic',     desc: 'Simple functions, quick snippets',                   warn: false },
    { tokens: 4096,  label: 'Standard',  desc: 'Single-file scripts, REST endpoints  ✅ default',    warn: false },
    { tokens: 8192,  label: 'Good Code', desc: 'Full modules, multi-function files  ⭐ recommended',  warn: false },
    { tokens: 12000, label: 'Large',     desc: 'Complex classes, full API servers',                  warn: false },
    { tokens: 16000, label: 'Huge',      desc: 'Multi-file generation in one pass',                  warn: false },
    { tokens: 32000, label: 'Max',       desc: 'Only if your model supports it — may be ignored',    warn: true  },
  ];

  const current = ctx.maxTokens || 4096;

  if (!sub || sub === '-show') {
    console.log('\n  ' + cr('⚙ Token limit for AI responses') + ab('  (current: ') + kp(current.toLocaleString()) + ab(')'));
    console.log('');
    console.log('  ' + ab('Tokens'.padEnd(8)) + ab('Level'.padEnd(12)) + ab('What you get'));
    console.log('  ' + ab('─'.repeat(60)));
    PRESETS.forEach(p => {
      const isCurrent = p.tokens === current;
      const marker    = isCurrent ? cr(' ◀ current') : '';
      const warnTag   = p.warn ? dg(' ⚠') : '';
      console.log(
        '  ' +
        (isCurrent ? kp : sd)(String(p.tokens).padEnd(8)) +
        (isCurrent ? kp : ab)(p.label.padEnd(12)) +
        (isCurrent ? wh : dm)(p.desc) +
        warnTag + marker
      );
    });
    console.log('');
    console.log('  ' + tl('💡 Recommendations:'));
    console.log('  ' + ab('  • Quick questions / chat only    →  ') + sd('2048'));
    console.log('  ' + ab('  • Writing single files / APIs    →  ') + sd('8192  ⭐ sweet spot'));
    console.log('  ' + ab('  • Agent mode / multi-file tasks  →  ') + sd('12000 – 16000'));
    console.log('  ' + ab('  • Very large codebases           →  ') + sd('32000 (model must support it)'));
    console.log('');
    console.log('  ' + dm('Set with: ') + cr('/token -set-usage 8192'));
    ctx.prompt(); return true;
  }

  if (sub === '-set-usage' || sub === '-set-token') {
    const raw = parseInt(args[2], 10);
    if (!args[2] || isNaN(raw) || raw < 256) {
      console.log('\n  ' + rf('✘ Usage: /token -set-usage <number>  (min 256)'));
      console.log('  ' + dm('Example: /token -set-usage 8192'));
      ctx.prompt(); return true;
    }

    const capped = Math.min(raw, 200000);
    ctx.maxTokens = capped;
    saveConfig({ provider: ctx.providerKey, apiKey: ctx.apiKey, model: ctx.modelId, mode: ctx.mode, autoTest: ctx.autoTest, autoScan: ctx.autoScan, maxTokens: capped });

    const preset = PRESETS.find(p => p.tokens === capped);
    const label  = preset ? cr(' (' + preset.label + ') ') + dm(preset.desc) : '';

    if (capped < 2048) {
      console.log('\n  ' + dg('⚠ Warning: ') + ab(capped + ' tokens is very low — AI responses may be cut off mid-code.'));
    } else if (capped > 32000) {
      console.log('\n  ' + dg('⚠ Note: ') + ab('Very high token limits are ignored by most models. Check your model\'s context window.'));
    }

    console.log('\n  ' + kp('✔ Token limit set → ') + cr(capped.toLocaleString()) + label);
    console.log('  ' + dm('Applied to all AI calls. Persisted to ~/.meg/config.json'));
    ctx.prompt(); return true;
  }

  console.log('\n  ' + dg('Unknown option. Usage:'));
  console.log('  ' + cr('/token -set-usage <number>') + ab('  — set token limit'));
  console.log('  ' + cr('/token -show') +               ab('              — show current setting & recommendations'));
  ctx.prompt(); return true;
}

module.exports = { handleMode, handleModel, handleProvider, handleToken };
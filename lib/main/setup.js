'use strict';

const path = require('path');

const { C, wh, cr, kp, rf, ab, sd, dg, vt, tl }          = require('../colors');
const { saveConfig, buildMemoryContext, buildSkillsContext } = require('../config');
const { PROVIDERS, ollamaAvailable, ollamaModels, ollamaPull,
        ollamaInstall, ollamaStart, fetchLiveModels, callAI } = require('../providers');
const { renderPS1, printBanner, spinner }                   = require('../render');
const { CWD, scanFolder, buildFolderContext, formatSize }   = require('../filesystem');
const { MODES }                                             = require('../modes');
const { TOP_CODING_IDS, OLLAMA_DOWNLOADABLE, VERSION }      = require('./constants');

// ─── Provider selection ───────────────────────────────────────────────────────
async function setupProvider(ctx) {
  if (ctx.providerKey) return; // already set (loaded from saved config)

  console.log('  ' + ab('Select a provider:'));
  console.log('');
  console.log('  ' + wh('[1]') + '  ' + sd('Anthropic (Claude)') + '  ' + ab('claude-sonnet-4, opus-4 — most capable'));
  console.log('  ' + cr('[2]') + '  ' + sd('OpenRouter         ') + '  ' + kp('FREE models available'));
  console.log('  ' + rf('[3]') + '  ' + sd('Groq               ') + '  ' + kp('FREE ultra-fast inference'));
  const olOk = await ollamaAvailable();
  if (olOk) console.log('  ' + kp('[4]') + '  ' + sd('Ollama (Local)     ') + '  ' + kp('● running — no key needed'));
  else       console.log('  ' + ab('[4]') + '  ' + sd('Ollama (Local)     ') + '  ' + rf('○ not detected — will auto-install'));
  console.log('');

  const ch = await ctx.ask(cr('  ❯ ') + ab('Select [1/2/3/4]: '));

  if (ch.trim() === '4') {
    if (!olOk) {
      console.log('\n  ' + ab('Ollama not found — installing automatically...\n'));
      try {
        await ollamaInstall();
        console.log('\n  ' + kp('✔ Ollama installed!') + ab(' Starting server...'));
        const started = await ollamaStart();
        if (!started) {
          console.log('  ' + rf('⚠ Server did not respond in time.'));
          console.log('  ' + ab('Please open a new terminal and run: ') + sd('ollama serve'));
          console.log('  ' + ab('Then re-launch Megaladon.'));
          ctx.rl.close(); process.exit(1);
        }
        console.log('  ' + kp('✔ Ollama server is running!'));
      } catch (installErr) {
        console.log('\n  ' + dg('✘ Auto-install failed: ') + installErr.message);
        console.log('  ' + ab('Install manually → ') + tl('https://ollama.com'));
        ctx.rl.close(); process.exit(1);
      }
    }
    ctx.providerKey = 'ollama';
  } else if (ch.trim() === '3') ctx.providerKey = 'groq';
  else if (ch.trim() === '2')   ctx.providerKey = 'openrouter';
  else                           ctx.providerKey = 'anthropic';

  console.log('');
}

// ─── API key ──────────────────────────────────────────────────────────────────
async function setupApiKey(ctx) {
  const prov = PROVIDERS[ctx.providerKey] || PROVIDERS.openrouter;
  if (ctx.providerKey !== 'ollama' && !ctx.apiKey) {
    console.log('');
    console.log('  ' + ab('Get your key → ') + tl(prov.keyUrl));
    const ki = await ctx.ask(cr('  ❯ ') + ab('Enter API key: '));
    ctx.apiKey = ki.trim();
  }
}

// ─── Ollama model download helper ─────────────────────────────────────────────
async function _downloadOllamaModel(ctx) {
  console.log('\n  ' + rf('⚠ No Ollama models installed.') + ab(' Pick one to download:\n'));
  console.log('  ' + kp('── 🏆 TOP 10 FOR CODING ─────────────────────────────────────'));
  const codingList = OLLAMA_DOWNLOADABLE.filter(m => m.coding);
  const otherList  = OLLAMA_DOWNLOADABLE.filter(m => !m.coding);
  codingList.forEach((m, i) => {
    console.log('  ' + wh('[' + (i + 1) + ']') + ' ' + sd(m.label) + rf(m.size.padStart(8)) + '  ' + kp(m.desc));
  });
  console.log('  ' + ab('── OTHER MODELS ─────────────────────────────────────────────'));
  otherList.forEach((m, i) => {
    console.log('  ' + ab('[' + (codingList.length + i + 1) + ']') + ' ' + sd(m.label) + rf(m.size.padStart(8)) + '  ' + ab(m.desc));
  });
  console.log('');
  const mc  = await ctx.ask(cr('  ❯ ') + ab('Pick a model to download [1-' + OLLAMA_DOWNLOADABLE.length + ']: '));
  const idx = parseInt(mc.trim()) - 1;
  const chosen = OLLAMA_DOWNLOADABLE[isNaN(idx) || idx < 0 || idx >= OLLAMA_DOWNLOADABLE.length ? 0 : idx];
  console.log('\n  ' + wh('Downloading ') + sd(chosen.id) + ab('  (' + chosen.size + ') — this may take a few minutes...'));
  console.log('  ' + ab('Connecting to Ollama API...\n'));
  try {
    await ollamaPull(chosen.id);
    console.log('\n  ' + kp('✔ Download complete! Model ready: ') + wh(chosen.id));
  } catch (pullErr) {
    console.log('\n  ' + dg('✘ Download failed: ') + pullErr.message);
    console.log('  ' + ab('Try manually in a terminal: ') + sd('ollama pull ' + chosen.id));
    ctx.rl.close(); process.exit(1);
  }
  return await ollamaModels();
}

// ─── Fetch available models ───────────────────────────────────────────────────
async function fetchAvailModels(ctx) {
  if (ctx.providerKey === 'ollama') {
    let availModels = await ollamaModels();
    if (!availModels.length) availModels = await _downloadOllamaModel(ctx);
    if (!availModels.length) {
      const chosen = OLLAMA_DOWNLOADABLE[0];
      console.log('\n  ' + dg('Still no models found. Try manually: ') + sd('ollama pull ' + chosen.id));
      ctx.rl.close(); process.exit(1);
    }
    ctx.availModels = availModels.map(m => ({
      ...m,
      coding: TOP_CODING_IDS.some(id => m.id.startsWith(id) || id.startsWith(m.id.split(':')[0])),
    }));
  } else {
    const prov   = PROVIDERS[ctx.providerKey] || PROVIDERS.openrouter;
    const sp     = spinner('Fetching available models...');
    const liveModels = await fetchLiveModels(ctx.providerKey, ctx.apiKey);
    sp.stop();
    if (liveModels && liveModels.length) {
      ctx.availModels = liveModels;
      console.log('  ' + kp('✔') + ' ' + ab('Fetched ') + wh(String(liveModels.length)) + ab(' live models from ') + prov.colorFn(prov.name));
    } else {
      ctx.availModels = prov.models || [];
      if (ctx.availModels.length) console.log('  ' + rf('⚠') + ' ' + ab('Could not fetch live models — using built-in list'));
    }
  }
}

// ─── Model selection + connection test loop ───────────────────────────────────
async function setupModel(ctx) {
  const prov = PROVIDERS[ctx.providerKey] || PROVIDERS.openrouter;

  if (ctx.modelId && !ctx.availModels.find(m => m.id === ctx.modelId)) ctx.modelId = null;

  let connected = false;
  while (!connected) {
    if (!ctx.modelId) {
      console.log('');
      if (ctx.providerKey === 'ollama') {
        const codingModels = ctx.availModels.filter(m => m.coding);
        const otherModels  = ctx.availModels.filter(m => !m.coding);
        let idx = 0;
        if (codingModels.length) {
          console.log('  ' + kp('── 🏆 TOP CODING MODELS (installed) ────────────────────────'));
          codingModels.forEach(m => {
            const sz = m.size ? '  ' + ab((m.size / 1e9).toFixed(1) + 'GB') : '';
            console.log('  ' + wh('[' + (++idx) + ']') + ' ' + sd(m.label || m.id) + kp(' ★ CODING') + sz);
          });
        }
        if (otherModels.length) {
          console.log('  ' + ab('── OTHER INSTALLED MODELS ───────────────────────────────────'));
          otherModels.forEach(m => {
            const sz = m.size ? '  ' + ab((m.size / 1e9).toFixed(1) + 'GB') : '';
            console.log('  ' + ab('[' + (++idx) + ']') + ' ' + sd(m.label || m.id) + sz);
          });
        }
        ctx.availModels = [...codingModels, ...otherModels];
      } else {
        ctx.availModels.forEach((m, i) => {
          const sz = m.size ? '  ' + ab((m.size / 1e9).toFixed(1) + 'GB') : '';
          console.log('  ' + ab('[' + (i + 1) + ']') + ' ' + sd(m.label || m.id) + (m.free ? ' ' + kp('FREE') : '') + sz);
        });
      }
      console.log('');
      const mc  = await ctx.ask(cr('  ❯ ') + ab('Select model [1-' + ctx.availModels.length + ']: '));
      const idx = parseInt(mc.trim()) - 1;
      ctx.modelId = ctx.availModels[isNaN(idx) || idx < 0 || idx >= ctx.availModels.length ? 0 : idx].id;
    }

    ctx.modelMeta = ctx.availModels.find(m => m.id === ctx.modelId) || ctx.availModels[0];
    console.log('  ' + ab('Model    › ') + wh(ctx.modelMeta.label || ctx.modelMeta.id));

    saveConfig({ provider: ctx.providerKey, apiKey: ctx.apiKey, model: ctx.modelId, mode: ctx.mode, autoTest: ctx.autoTest, autoScan: ctx.autoScan });

    console.log('');
    const stopTest = spinner('Testing connection...');
    try {
      await callAI(ctx.providerKey, ctx.apiKey, ctx.modelId, [{ role: 'user', content: 'hi' }]);
      stopTest.stop();
      console.log('  ' + kp('✔ Connected!') + ab(' Megaladon v' + VERSION + ' is ready.'));
      connected = true;
    } catch (err) {
      stopTest.stop();
      console.log('  ' + dg('✘ ') + err.message);
      console.log('  ' + ab('This model may require terms acceptance or may not support chat.'));
      ctx.availModels = ctx.availModels.filter(m => m.id !== ctx.modelId);
      ctx.modelId = null;
      if (!ctx.availModels.length) {
        console.log('  ' + dg('No more models to try. Check your API key or run: ') + sd('megaladon --reset'));
        ctx.rl.close(); process.exit(1);
      }
      console.log('  ' + rf('↩ Pick a different model:'));
    }
  }
}

// ─── Folder scan ──────────────────────────────────────────────────────────────
async function setupFolderScan(ctx) {
  if (!ctx.autoScan) return;
  const sp    = spinner('Scanning project directory...');
  const files = scanFolder(CWD(), 8);
  sp.stop();
  if (files.length) {
    ctx.folderCtx = buildFolderContext(files, CWD());
    console.log('  ' + tl('◈') + ' ' + ab('Scanned: ') + sd(files.length + ' project files') + ab(' in ') + tl(path.basename(CWD())));
  }
}

// ─── Memory / Skills / Connections report ─────────────────────────────────────
function reportMemoryAndSkills(ctx) {
  if (ctx.mem.facts.length || ctx.mem.sessionSummaries?.length) {
    console.log('  ' + vt('◈') + ' ' + ab('Memory: ') + sd(ctx.mem.facts.length + ' facts') + ab(', ') + sd((ctx.mem.sessionSummaries?.length || 0) + ' past sessions'));
  }
  if (ctx.skills.length) {
    console.log('  ' + rf('◈') + ' ' + ab('Skills: ') + sd(ctx.skills.map(s => s.name).join(', ')));
  }
  console.log('  ' + ab('◈') + ' ' + ab('Auto-Test: ') + (ctx.autoTest ? kp('ON') : ab('OFF')) + ab('  Auto-Scan: ') + (ctx.autoScan ? kp('ON') : ab('OFF')));

  // ── WhatsApp connection status in banner ──────────────────────────────────
  try {
    const { getConnectionStatus } = require('../connections');
    const waStatus = getConnectionStatus('whatsapp');
    const G  = '\x1b[38;5;35m';
    const GR = '\x1b[38;5;245m';
    const Y  = '\x1b[38;5;226m';
    const R  = '\x1b[0m';
    if (waStatus?.connected) {
      const owner = waStatus.ownerNumber ? GR + '  (+' + waStatus.ownerNumber + ')' + R : '';
      console.log('  ' + G + '◈' + R + ' ' + ab('WhatsApp: ') + G + '✅ linked' + R + owner);
    } else {
      console.log('  ' + ab('◈') + ' ' + ab('WhatsApp: ') + GR + 'not linked' + R + ab('  (run ') + sd('/wp') + ab(' to connect)'));
    }
  } catch (_) {
    // connections module not available — skip silently
  }
}

// ─── Welcome banner ───────────────────────────────────────────────────────────
function printWelcome(ctx) {
  const modeS = () => { const m = MODES[ctx.mode]; return m.colorFn(m.icon + ' ' + m.name); };
  console.log('');
  const DW = Math.min((process.stdout.columns || 80) - 2, 72);
  console.log('  ' + ab('─'.repeat(DW)));
  console.log('  ' + ab('Mode: ') + modeS() + '  ' + ab('│  cwd: ') + tl(CWD()));
  console.log('  ' + ab('Type ') + sd('/help') + ab(' · ') + sd('!cmd') + ab(' runs shell · ') + sd('/skill install <n>') + ab(' for skills · ') + sd('/memory') + ab(' to view memory'));
  console.log('');
}


// ─── askConnections — optional first-run WhatsApp setup ───────────────────────
// Called once after the AI connection test. Asks the user if they want to link
// WhatsApp to Megaladon. Skipped if a connection is already set up.
async function askConnections(ctx) {
  const { CONNECTION_REGISTRY, getConnectionStatus, setupConnection } = require('../connections');

  // Skip if any connection is already set up
  const anyConnected = Object.keys(CONNECTION_REGISTRY)
    .filter(id => !CONNECTION_REGISTRY[id].comingSoon)
    .some(id => getConnectionStatus(id)?.connected);
  if (anyConnected) return;

  const G  = '\x1b[38;5;35m';
  const GR = '\x1b[38;5;245m';
  const R  = '\x1b[0m';

  console.log('');
  console.log('  ' + G + '◈' + R + ' ' + ab('Connect WhatsApp to Megaladon?'));
  console.log('  ' + GR + '  Chat with your AI from WhatsApp — no extra app needed.' + R);
  console.log('  ' + GR + '  (You can also do this later with ' + R + sd('/wp') + GR + ')' + R);
  console.log('');

  const ch = await ctx.ask(cr('  ❯ ') + ab('Connect WhatsApp now? [y/N]: '));
  if (ch.trim().toLowerCase() !== 'y' && ch.trim().toLowerCase() !== 'yes') return;

  // Show available (non-coming-soon) connections
  const available = Object.values(CONNECTION_REGISTRY).filter(c => !c.comingSoon);
  console.log('');
  available.forEach((conn, i) => {
    console.log('  ' + ab('[' + (i + 1) + ']') + '  ' + conn.icon + '  ' + wh(conn.name.padEnd(14)) + ab(conn.description));
  });
  console.log('');

  const pick = await ctx.ask(cr('  ❯ ') + ab('Select [1-' + available.length + '] or Enter to skip: '));
  const idx  = parseInt(pick.trim()) - 1;
  if (!isNaN(idx) && available[idx]) {
    await setupConnection(available[idx].id, ctx);
  }
}

// ─── runSetup — runs all setup steps in order ─────────────────────────────────
async function runSetup(ctx) {
  const prov = PROVIDERS[ctx.providerKey] || PROVIDERS.openrouter;
  printBanner(VERSION);

  // Track whether this is a first-time setup (no saved provider yet)
  const isFirstRun = !ctx.providerKey;

  await setupProvider(ctx);

  const resolvedProv = PROVIDERS[ctx.providerKey] || PROVIDERS.openrouter;
  console.log('  ' + ab('Provider › ') + resolvedProv.colorFn(resolvedProv.name));

  await setupApiKey(ctx);
  await fetchAvailModels(ctx);
  await setupModel(ctx);
  await setupFolderScan(ctx);
  // Only ask about WhatsApp during first-time setup.
  // Users can always run /wp or /connection to set this up later.
  if (isFirstRun) await askConnections(ctx);
  reportMemoryAndSkills(ctx);
  printWelcome(ctx);
}

module.exports = { runSetup };
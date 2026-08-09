'use strict';

// ─── lib/main/commands.js ─────────────────────────────────────────────────────
// Thin router — all handler logic lives in lib/main/command/*.js
// This file's only job is to dispatch the right handler for each command.
//
// Sub-module map:
//   command/shell.js        !shell passthrough
//   command/session.js      /exit /help /clear /stats /save /load /export …
//   command/files.js        /scan /ls /tree /read /create /delete /rename /run
//   command/settings.js     /mode /model /provider /token
//   command/memory.js       /memory
//   command/skills.js       /skill  (built-ins + ZIP plugins)
//   command/ai.js           /analyse /write /debug -fix /dashboard
//   command/connections.js  /connection /wa
//   plugins/dispatcher.js   dynamic plugin commands (e.g. /pdfcry)

const {
  handleShell,
} = require('./command/shell');

const {
  handleExit,
  handleHelp,
  handleClear,
  handleStats,
  handleSave,
  handleLoad,
  handleExport,
  handleTokensInline,
  handleSystem,
  handleCopy,
  handleReset,
  handleAutoTest,
  handleAutoScan,
  handleHistory,
} = require('./command/session');

const {
  handleScan,
  handleLs,
  handleTree,
  handleRead,
  handleCreate,
  handleDelete,
  handleRename,
  handleRun,
} = require('./command/files');

const {
  handleMode,
  handleModel,
  handleProvider,
  handleToken,
} = require('./command/settings');

const { handleMemory }              = require('./command/memory');
const { handleSkill }               = require('./command/skills');
const { handleAnalyse, handleWrite,
        handleDebugFix, handleDashboard } = require('./command/ai');
const { handleConnection, handleWa } = require('./command/connections');

// ─── Plugin engine (lazy-loaded so missing plugins/ folder is graceful) ───────
function getPluginDispatcher() {
  try { return require('../../plugins/index').dispatchPlugin; }
  catch (_) { return null; }
}

// ─── Plugin output renderer ───────────────────────────────────────────────────
function renderPluginOutput(result, ctx) {
  if (!result || result.output == null) return;
  const { output } = result;

  if (typeof output === 'string') {
    const { formatMD } = require('../render');
    console.log('\n' + formatMD(output) + '\n');
    return;
  }

  if (output.error) {
    console.log('\n  \x1b[38;5;196m✘ ' + output.error + '\x1b[0m\n');
    return;
  }

  if (output.text !== undefined) {
    const { formatMD } = require('../render');
    if (output.pages) console.log('\n  \x1b[38;5;245mPages: ' + output.pages + '\x1b[0m');
    if (output.info)  {
      const info = output.info;
      if (info.Title)  console.log('  \x1b[38;5;245mTitle:  ' + info.Title + '\x1b[0m');
      if (info.Author) console.log('  \x1b[38;5;245mAuthor: ' + info.Author + '\x1b[0m');
    }
    console.log('\n' + formatMD(output.text || '(no text content found)') + '\n');
    return;
  }

  // Generic object fallback
  console.log('\n' + JSON.stringify(output, null, 2) + '\n');
}

// ─── dispatchCommand ──────────────────────────────────────────────────────────
async function dispatchCommand(text, ctx) {
  if (text.startsWith('!'))                                    return handleShell(text, ctx);

  if (['/exit', '/quit', '/q'].includes(text))                 return handleExit(text, ctx);
  if (text === '/help')                                        return handleHelp(ctx);
  if (text === '/clear')                                       return handleClear(ctx);
  if (text === '/stats')                                       return handleStats(ctx);
  if (text === '/tokens')                                      return handleTokensInline(ctx);
  if (text === '/system')                                      return handleSystem(ctx);
  if (text === '/copy')                                        return handleCopy(ctx);
  if (text === '/reset')                                       return handleReset(ctx);
  if (text === '/autotest')                                    return handleAutoTest(ctx);
  if (text === '/autoscan')                                    return handleAutoScan(ctx);

  if (text === '/scan')                                        return handleScan(ctx);
  if (text.startsWith('/ls'))                                  return handleLs(text, ctx);
  if (text.startsWith('/tree'))                                return handleTree(text, ctx);
  if (text.startsWith('/read '))                               return handleRead(text, ctx);
  if (text.startsWith('/create '))                             return handleCreate(text, ctx);
  if (text.startsWith('/delete '))                             return handleDelete(text, ctx);
  if (text.startsWith('/rename '))                             return handleRename(text, ctx);
  if (text.startsWith('/run'))                                 return handleRun(text, ctx);

  if (text.startsWith('/token'))                               return handleToken(text, ctx);
  if (text.startsWith('/coding'))                              return handleToken(text, ctx);   // legacy alias
  if (text.startsWith('/mode'))                                return handleMode(text, ctx);
  if (text.startsWith('/model'))                               return handleModel(text, ctx);
  if (text === '/provider')                                    return handleProvider(ctx);

  if (text.startsWith('/memory'))                              return handleMemory(text, ctx);
  if (text.startsWith('/skill'))                               return handleSkill(text, ctx);

  if (text.startsWith('/save'))                                return handleSave(text, ctx);
  if (text === '/load')                                        return handleLoad(ctx);
  if (text === '/export')                                      return handleExport(ctx);
  if (text === '/history')                                     return handleHistory(ctx);

  if (text.startsWith('/debug'))                               return handleDebugFix(text, ctx);
  if (text.startsWith('/analyse ') || text.startsWith('/analyze ')) return handleAnalyse(text, ctx);
  if (text.startsWith('/write '))                              return handleWrite(text, ctx);
  if (text.startsWith('/dashboard'))                           return handleDashboard(text, ctx);

  if (text.startsWith('/connection'))                          return handleConnection(text, ctx);
  if (text === '/wp' || text.startsWith('/wp '))               return handleConnection('/connection whatsapp' + text.slice(3), ctx);
  if (text === '/wa' || text.startsWith('/wa '))               return handleWa(text, ctx);

  // ── Plugin dispatch (dynamic commands from installed ZIP plugins) ────────────
  if (text.startsWith('/')) {
    const dispatcher = getPluginDispatcher();
    if (dispatcher) {
      const result = await dispatcher(text, ctx);
      if (result.handled) {
        renderPluginOutput(result, ctx);
        ctx.prompt();
        return true;
      }
    }
  }

  return false;
}

module.exports = { dispatchCommand };
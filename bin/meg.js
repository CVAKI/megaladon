#!/usr/bin/env node
'use strict';
// ─── Megaladon CLI entry ──────────────────────────────────────────────────────
const fs   = require('fs');
const { main, VERSION } = require('../lib/main');
const { CONFIG_PATH, loadMemory } = require('../lib/config');
const { listSessions } = require('../lib/selftest');

const arg = process.argv[2];
if (arg==='--reset')    { if (fs.existsSync(CONFIG_PATH)) { fs.unlinkSync(CONFIG_PATH); console.log('Config reset.'); } process.exit(0); }
if (arg==='--version'||arg==='-v') { console.log('Megaladon v'+VERSION+' · Node.js '+process.version); process.exit(0); }
if (arg==='--memory')   { console.log(JSON.stringify(loadMemory(),null,2)); process.exit(0); }
if (arg==='--sessions') { listSessions().forEach(s=>console.log(s.name+' ('+s.count+' msgs · '+s.saved+')')); process.exit(0); }
if (arg==='--help'||arg==='-h') { console.log('Megaladon v'+VERSION+'\nUsage: megaladon [--reset|--version|--memory|--sessions|--help]\nInside the app: /help'); process.exit(0); }

main().catch(e=>{ console.error('\x1b[31mFatal:\x1b[0m',e.message); process.exit(1); });
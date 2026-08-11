'use strict';
const fs   = require('fs');
const path = require('path');
const os   = require('os');

// ─── Paths ────────────────────────────────────────────────────────────────────
const HOME_DIR    = os.homedir();
const BASE_DIR    = path.join(HOME_DIR, '.meg');
const CONFIG_PATH = path.join(BASE_DIR, 'config.json');
const MEMORY_PATH = path.join(BASE_DIR, 'memory.json');
const SESS_DIR    = path.join(BASE_DIR, 'sessions');
const SKILLS_DIR  = path.join(BASE_DIR, 'skills');

function ensureDir(d) { try { if (!fs.existsSync(d)) fs.mkdirSync(d,{recursive:true}); } catch(_){} }

function loadConfig() {
  try { if (fs.existsSync(CONFIG_PATH)) return JSON.parse(fs.readFileSync(CONFIG_PATH,'utf8')); } catch(_){}
  return {};
}
function saveConfig(cfg) { try { fs.writeFileSync(CONFIG_PATH,JSON.stringify(cfg,null,2)); } catch(_){} }

function loadMemory() {
  try {
    if (fs.existsSync(MEMORY_PATH)) {
      const mem = JSON.parse(fs.readFileSync(MEMORY_PATH,'utf8'));
      return sanitizeMemory(mem);
    }
  } catch(_){}
  return { facts:[], projects:{}, sessionSummaries:[], created:new Date().toISOString(), lastUpdated:null };
}

// FIX: saveMemory used to be a blind full-file overwrite — it serialized
// whatever THIS process's in-memory `mem` object held, with no regard for
// what's currently on disk. If a second Megaladon instance is running in a
// different terminal window (easy to end up with — nothing prevents it),
// that second process's `ctx.mem` is a stale snapshot from whenever IT last
// loaded memory.json. The moment that stale process calls saveMemory() for
// ANY reason — even something unrelated to your facts — it wipes out
// whatever the other process had just saved, with no warning. This is what
// caused facts to vanish between two /memory calls with no /memory clear
// ever run.
//
// Fix: read-merge-write instead of blind-overwrite. Facts already on disk
// (which may have been written by a different process a moment ago) are
// unioned with this process's own facts by key; this process's version wins
// on a key conflict (it's the most "current" action), but a fact this
// process never touched is never silently dropped just because this
// process's in-memory snapshot didn't happen to have it.
//
// force:true bypasses the merge entirely (blind overwrite) — use this ONLY
// for an explicit, deliberate wipe such as /memory clear or the dashboard's
// "Clear All Memory" button, where the person's intent really is "erase
// everything," not "merge my sparse state with disk."
function saveMemory(mem, opts) {
  const force = !!(opts && opts.force);
  try {
    mem.lastUpdated = new Date().toISOString();

    if (!force) {
      let onDisk = {};
      try {
        if (fs.existsSync(MEMORY_PATH)) onDisk = JSON.parse(fs.readFileSync(MEMORY_PATH, 'utf8'));
      } catch (_) { onDisk = {}; }

      const onDiskFacts = Array.isArray(onDisk.facts) ? onDisk.facts : [];
      const merged = new Map();
      onDiskFacts.forEach(f => { if (f && f.key) merged.set(f.key, f); });
      (mem.facts || []).forEach(f => { if (f && f.key) merged.set(f.key, f); }); // this process's value wins on conflict
      mem.facts = [...merged.values()];

      // Session summaries: union by array identity is wasteful to dedupe
      // perfectly here, so just prefer whichever list is longer (more
      // history) rather than risk truncating a longer on-disk list.
      const onDiskSummaries = Array.isArray(onDisk.sessionSummaries) ? onDisk.sessionSummaries : [];
      if (onDiskSummaries.length > (mem.sessionSummaries || []).length) {
        mem.sessionSummaries = onDiskSummaries;
      }
    }

    fs.writeFileSync(MEMORY_PATH, JSON.stringify(mem, null, 2));
  } catch(_){}
}

const _NOISE_KEYS = new Set([
  'conversation_start','session_status','intent_disambiguation','disambiguation_steps',
  'temperature_setting','code_generation_example','extended_thinking','internal_reasoning',
  'visible_thinking','conversation_topic','user_input','user_greeting','code_representation',
  'current_phase','task_decomposition','transformer_architecture','transformer_layer',
  'greeting','assistance','issue_description','fix_target','project_files',
  'project_status','api_endpoints','user_preference','clarification_needed',
  'response_format','thinking_mode','reasoning_mode','system_status',
]);

const _SLASH_CMD_RE = /\/(?:scan|memory|mode|skill|read|write|analyse|analyze|save|load|export|dashboard|stats|history|exit|ls|tree|create|delete|rename|run|tokens|system|copy|reset|autotest|autoscan|help|clear|provider|model)\b/;

function parseMemoryBlocks(text) {
  if (typeof text !== 'string') return [];
  const stripped = text.replace(/```[\s\S]*?```/g, '');
  const blocks=[], re=/@@MEMORY:\s*([^\n:]+):\s*([^\n]+)/g; let m;
  while ((m=re.exec(stripped))!==null) {
    const key = m[1].trim().replace(/:$/, '');
    if (!key) continue;
    if (/\s/.test(key)) continue;
    if (key.length < 2 || key.length > 50) continue;
    if (_NOISE_KEYS.has(key)) continue;
    const value = m[2].trim();
    if (!value || value.length < 2 || value.length > 300) continue;
    if (value.startsWith('@@') || value.startsWith('@MEMORY')) continue;
    if (/@@(?:FILE|END|MEMORY):/.test(value)) continue;
    if (/^[!]/.test(value)) continue;
    if (_SLASH_CMD_RE.test(value)) continue;
    if (/^(true|false|yes|no|ok|done|none|null|undefined|acknowledged|started|running|offered|scanned|empty)$/i.test(value)) continue;
    blocks.push({ key, value });
    if (blocks.length >= 3) break;
  }
  return blocks;
}
function sanitizeMemory(mem) {
  if (!Array.isArray(mem.facts)) mem.facts = [];
  if (!Array.isArray(mem.sessionSummaries)) mem.sessionSummaries = [];

  mem.facts = mem.facts.filter(f => {
    if (!f || typeof f !== 'object') return false;
    if (!f.key || !f.value) return false;
    const key = f.key.trim();
    const val = String(f.value).trim();
    if (_NOISE_KEYS.has(key)) return false;
    if (/:$/.test(key)) return false;
    if (/\s/.test(key)) return false;
    if (val.startsWith('@@') || val.includes('@@MEMORY:') || val.includes('@@FILE:')) return false;
    if (_SLASH_CMD_RE.test(val)) return false;
    if (/^(true|false|yes|no|ok|done|none|null|undefined|acknowledged|started|running|offered|scanned|empty)$/i.test(val)) return false;
    if (val.length < 2 || val.length > 300) return false;
    return true;
  });

  const seen = new Map();
  mem.facts.forEach(f => {
    const cleanKey = f.key.replace(/:$/, '');
    seen.set(cleanKey, { ...f, key: cleanKey });
  });
  mem.facts = [...seen.values()];

  return mem;
}

function updateMemory(mem, blocks) {
  blocks.forEach(mb => {
    const i=mem.facts.findIndex(f=>f.key===mb.key);
    if (i>=0) mem.facts[i].value=mb.value;
    else mem.facts.push({key:mb.key,value:mb.value,added:new Date().toISOString()});
  });
}
function buildMemoryContext(mem, cwd) {
  const parts=[];
  if (mem.facts.length) {
    parts.push('## Persistent Memory (from previous sessions)');
    mem.facts.slice(-25).forEach(f=>parts.push(`- ${f.key}: ${f.value}`));
  }
  const projKey=cwd.replace(/[^a-zA-Z0-9]/g,'_');
  if (mem.projects[projKey]?.summary) {
    parts.push('## Project Memory (this directory)');
    parts.push(mem.projects[projKey].summary);
  }
  if (mem.sessionSummaries?.length) {
    const last=mem.sessionSummaries[mem.sessionSummaries.length-1];
    parts.push('## Last Session');
    parts.push(last.summary);
  }
  return parts.join('\n');
}

const SKILL_REGISTRY = {
  react:       { name:'React',        description:'Modern React with hooks, TypeScript, patterns',        prompt:'When writing React: use functional components with hooks (useState,useEffect,useCallback,useMemo), TypeScript interfaces, error boundaries, proper keys. No class components unless asked.' },
  python:      { name:'Python',       description:'Idiomatic Python with type hints and best practices',  prompt:'When writing Python: use type hints, f-strings, dataclasses, pathlib, context managers. PEP 8 compliance. Use list comprehensions appropriately. Write docstrings for all functions.' },
  security:    { name:'Security',     description:'Security-first code review and hardening',             prompt:'When reviewing/writing code: check for XSS, SQL injection, CSRF, auth flaws, sensitive data exposure, hardcoded secrets, input validation, OWASP Top 10. Always suggest fixes.' },
  testing:     { name:'Testing',      description:'Comprehensive test writing (unit, integration, e2e)',  prompt:'When writing tests: cover happy path, edge cases, error cases. Use descriptive names. AAA pattern (Arrange,Act,Assert). Mock external deps. Aim for meaningful coverage, not 100%.' },
  'api-design':{ name:'API Design',   description:'REST/GraphQL API design and OpenAPI specs',           prompt:'When designing APIs: proper HTTP methods and status codes, versioning strategy, pagination, rate limiting, auth patterns, clear error messages, consistent naming. Generate OpenAPI specs when useful.' },
  docker:      { name:'Docker',       description:'Containerization and Compose best practices',          prompt:'When writing Docker: multi-stage builds, minimal base images (alpine/distroless), non-root users, health checks, .dockerignore, env var handling, proper volume mounts.' },
  database:    { name:'Database',     description:'Schema design, queries, and optimization',             prompt:'When working with databases: proper indexing strategy, normalized schemas, efficient queries (avoid N+1), migrations, connection pooling, transactions, explain plan analysis.' },
  git:         { name:'Git',          description:'Git workflows, conventional commits, CI/CD',           prompt:'When working with git: conventional commits (feat/fix/docs/chore), branching strategy, meaningful PRs, proper .gitignore, conflict resolution, semantic versioning.' },
  performance: { name:'Performance',  description:'Code and app performance optimization',                prompt:'When optimizing performance: profile before optimizing, Big-O analysis, memoization, lazy loading, caching strategies, bundle size analysis, database query optimization, rendering performance.' },
  typescript:  { name:'TypeScript',   description:'Advanced TypeScript types and patterns',               prompt:'When writing TypeScript: prefer strict mode, use utility types (Partial,Required,Pick,Omit,Record), discriminated unions, generics, avoid any. Leverage the type system fully.' },
};

function loadSkills() {
  ensureDir(SKILLS_DIR);
  try {
    return fs.readdirSync(SKILLS_DIR).filter(f=>f.endsWith('.json')).map(f=>{
      try { return JSON.parse(fs.readFileSync(path.join(SKILLS_DIR,f),'utf8')); } catch(_){ return null; }
    }).filter(Boolean);
  } catch(_){ return []; }
}
function saveSkill(skill) {
  ensureDir(SKILLS_DIR);
  fs.writeFileSync(path.join(SKILLS_DIR,skill.name.toLowerCase().replace(/\s+/g,'_')+'.json'),JSON.stringify(skill,null,2));
}
function buildSkillsContext(skills) {
  if (!skills.length) return '';
  return '## Installed Skills (apply these to all relevant code)\n'+skills.map(s=>`- **${s.name}**: ${s.prompt}`).join('\n');
}

module.exports = {
  HOME_DIR, BASE_DIR, CONFIG_PATH, MEMORY_PATH, SESS_DIR, SKILLS_DIR,
  ensureDir, loadConfig, saveConfig,
  loadMemory, saveMemory, sanitizeMemory, parseMemoryBlocks, updateMemory, buildMemoryContext,
  SKILL_REGISTRY, loadSkills, saveSkill, buildSkillsContext,
};
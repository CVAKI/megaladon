'use strict';

const { rf, ab, sd }                        = require('../colors');
const { saveConfig, SKILL_REGISTRY, saveSkill } = require('../config');
const { MODES }                              = require('../modes');

// ─── Mode detection rules ─────────────────────────────────────────────────────
// Each entry: { patterns, mode, reason }. First match wins.
const MODE_RULES = [
  {
    mode: 'agent',
    reason: 'autonomous file creation detected',
    patterns: [
      /\b(build|create|generate|scaffold|write|make|implement|set up)\b.{0,60}\b(full|complete|entire|whole|all)\b/,
      /\b(build|create|generate)\b.{0,80}\b(app|application|project|api|server|cli|tool|system)\b/,
      /\b(multi.?file|multiple files|several files)\b/,
      /@@file:/i,
      /\bauto(matically)?\s+(fix|create|write|build)\b/,
    ],
  },
  {
    mode: 'debug',
    reason: 'debugging intent detected',
    patterns: [
      /\b(fix|debug|broken|error|crash(?:ing|es)?|failing|not working|doesn'?t work|bug|issue|problem|exception|traceback|stack ?trace)\b/,
      /\bwhy (is|does|won'?t|can'?t|isn'?t)\b.{0,60}\b(work|run|start|connect|return|fail|crash)\b/,
      /\bgetting (an? )?(error|exception|crash|warning)\b/,
    ],
  },
  {
    mode: 'review',
    reason: 'code review intent detected',
    patterns: [
      /\b(review|audit|check|critique|evaluate|rate|assess|feedback on)\b.{0,60}\b(code|file|function|class|module|script|server\.js|client\.js)\b/,
      /\bhow (good|clean|solid|well.?written) is\b/,
      /\brate (it|this|my code)\b/,
    ],
  },
  {
    mode: 'plan',
    reason: 'planning intent detected',
    patterns: [
      /\b(plan|planning)\b.{0,60}\b(feature|features|task|tasks|project|roadmap|sprint|milestone)\b/,
      /\bbreak\s+down\b.{0,60}\b(project|task|tasks|feature|features|work|story|stories)\b/,
      /\b(create|make|write)\b.{0,40}\b(plan|roadmap|timeline|checklist|todo|task list)\b/,
      /\bhow (should|do) (i|we) (approach|tackle|start|begin|organise|organize)\b/,
    ],
  },
  {
    mode: 'architect',
    reason: 'system design intent detected',
    patterns: [
      /\b(design|architect|plan|structure|diagram|scalab|system design)\b.{0,80}\b(api|service|system|architecture|database|infra|backend|microservice)\b/,
      /\bhow (should|would|do) (i|we|you) (structure|design|scale|organise|organize)\b/,
      /\b(draw|sketch|map out|lay out).{0,40}\b(architecture|system|flow|diagram)\b/,
    ],
  },
  {
    mode: 'explain',
    reason: 'explanation intent detected',
    patterns: [
      /\b(explain|teach|help me understand|what is|what are|how does|how do|walk me through|eli5|break.?down)\b/,
      /\b(for a (junior|beginner|newbie)|like (i'?m|i am) (5|new|a beginner))\b/,
      /\bwhat.{0,20}(mean|difference between|better than)\b/,
    ],
  },
  {
    mode: 'code',
    reason: 'coding task detected',
    patterns: [
      /\b(write|add|implement|code|function|endpoint|route|method|class|module|script)\b/,
      /\b(refactor|optimise|optimize|improve|update|modify|change|edit)\b.{0,40}\b(code|function|file|class|module)\b/,
    ],
  },
];

// ─── Skill detection rules ────────────────────────────────────────────────────
const SKILL_RULES = [
  { key: 'react',       patterns: [/\breact\b/, /\bjsx\b/, /\bhooks?\b/, /\busestate\b/, /\buseeffect\b/, /\bcomponent\b/] },
  { key: 'typescript',  patterns: [/\btypescript\b/, /\b\.tsx?\b/, /\btype.?hints?\b/, /\binterface\b.*\btype\b/] },
  { key: 'testing',     patterns: [/\b(test|tests|testing|spec|jest|mocha|vitest|unit test|integration test|e2e)\b/] },
  { key: 'security',    patterns: [/\b(security|auth|jwt|oauth|xss|sql.?inject|csrf|sanitize|encrypt|hash|bcrypt)\b/] },
  { key: 'docker',      patterns: [/\b(docker|container|dockerfile|compose|k8s|kubernetes|image|pod)\b/] },
  { key: 'database',    patterns: [/\b(database|postgres|mysql|mongodb|sqlite|sequelize|prisma|orm|schema|migration|sql)\b/] },
  { key: 'api-design',  patterns: [/\b(rest|api|endpoint|openapi|swagger|graphql|grpc|rate.?limit|versioning)\b/] },
  { key: 'python',      patterns: [/\bpython\b/, /\bpip\b/, /\bdjango\b/, /\bflask\b/, /\bfastapi\b/, /\b\.py\b/] },
  { key: 'performance', patterns: [/\b(perf|performance|optim|speed|slow|latency|cache|memo|profil|bundle.?size)\b/] },
  { key: 'git',         patterns: [/\b(git|commit|branch|merge|pr|pull.?request|ci\/cd|pipeline|workflow)\b/] },
];

// ─── autoDetectModeAndSkills ──────────────────────────────────────────────────
// Analyse the user's message, auto-switch mode and auto-install skills if
// the intent is clear, and print an announcement for each change made.
function autoDetectModeAndSkills(text, ctx) {
  const t = text.toLowerCase();

  // ── Mode detection ─────────────────────────────────────────────────────────
  let detectedMode = null;
  let modeReason   = '';

  // When the AI has written files this session (agentTaskActive),
  // suppress auto-switching away so follow-up turns keep write permissions.
  // Exception: only allow switching TO agent, never AWAY from it mid-task.
  const suppressSwitch = ctx.agentTaskActive && ctx.mode === 'agent';

  if (!suppressSwitch) {
    for (const rule of MODE_RULES) {
      if (rule.mode === ctx.mode) continue; // already in this mode
      // Never auto-switch away from agent mode using the generic 'code' rule
      // (follow-up messages naturally contain words like "write" or "add")
      if (ctx.mode === 'agent' && rule.mode === 'code') continue;
      if (rule.patterns.some(p => p.test(t))) {
        detectedMode = rule.mode;
        modeReason   = rule.reason;
        break;
      }
    }
  }

  // ── Skill detection ────────────────────────────────────────────────────────
  const skillsToInstall = [];
  for (const rule of SKILL_RULES) {
    // Only suggest if not already installed
    if (ctx.skills.find(s => s.name.toLowerCase() === (SKILL_REGISTRY[rule.key]?.name || '').toLowerCase())) continue;
    if (rule.patterns.some(p => p.test(t))) {
      const reg = SKILL_REGISTRY[rule.key];
      if (reg) skillsToInstall.push({ key: rule.key, reg });
    }
  }

  // ── Apply and announce changes ─────────────────────────────────────────────
  const changes = [];

  if (detectedMode) {
    ctx.mode = detectedMode;
    saveConfig({ provider: ctx.providerKey, apiKey: ctx.apiKey, model: ctx.modelId, mode: ctx.mode, autoTest: ctx.autoTest, autoScan: ctx.autoScan });
    ctx.statusRef.mode = ctx.mode;
    changes.push(MODES[ctx.mode].colorFn('⟳ Auto-switched to ' + MODES[ctx.mode].icon + ' ' + MODES[ctx.mode].name) + ab(' (' + modeReason + ')'));
  }

  for (const { reg } of skillsToInstall) {
    saveSkill(reg);
    ctx.skills.push(reg);
    changes.push(rf('⟳ Auto-installed skill: ') + sd(reg.name) + ab(' — ' + reg.description));
  }

  if (changes.length) {
    console.log('');
    changes.forEach(c => console.log('  ' + c));
  }
}

module.exports = { autoDetectModeAndSkills };
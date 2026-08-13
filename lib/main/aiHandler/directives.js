'use strict';

// Reuse the abilities module's own parser instead of duplicating the regex
// here — keeps the directive format defined in exactly one place.
// Wrapped in try/catch so a missing/uninstalled abilities skill never
// breaks @@FILE / @@RUN / @@MEMORY / @@SEARCH / @@EMAIL parsing.
let parseAbilityDirectives = () => [];
try {
  ({ parseAbilityDirectives } = require('../../../skills/abilities'));
} catch (_) { /* abilities skill not installed — abilities: [] stays empty, harmless */ }

// ─── parseDirectives ──────────────────────────────────────────────────────────
// @@FILE / @@RUN / @@MEMORY  — original directives
// @@SEARCH / @@EMAIL_READ / @@EMAIL_SEND  — tool directives
// @@ABILITY  — desktop control directives (screen / mouse / keyboard)
function parseDirectives(text) {
  const results = { files: [], runs: [], memory: [], search: [], emailRead: [], emailSend: [], abilities: [] };

  // @@FILE: path\n...content...\n@@END
  // Tolerates Windows \r\n, spaces after colon, and blank lines before content
  const fileRe = /@@FILE:\s*([^\r\n]+)\r?\n([\s\S]*?)@@END/g;
  const runRe  = /@@RUN:\s*([^\r\n]+)/g;
  // Accept both @@MEMORY: key=value  AND  @@MEMORY: key: value  (AI sometimes mirrors user's colon format)
  const memRe  = /@@MEMORY:\s*([^=:\r\n][^=:\r\n]*)(?:=|:\s*)([^\r\n]+)/g;

  let m;
  while ((m = fileRe.exec(text)) !== null)
    results.files.push({ path: m[1].trim(), content: m[2] });

  // Deduplicate @@RUN: lines (model sometimes repeats them)
  const seenRuns = new Set();
  while ((m = runRe.exec(text)) !== null) {
    const cmd = m[1].trim();
    if (!seenRuns.has(cmd)) { seenRuns.add(cmd); results.runs.push(cmd); }
  }

  while ((m = memRe.exec(text)) !== null)
    results.memory.push({ key: m[1].trim(), value: m[2].trim() });

  // ── Web search / email directives ───────────────────────────────────────────
  const searchRe    = /@@SEARCH:\s*([^\r\n]+)/g;
  const emailReadRe = /@@EMAIL_READ:\s*([^\r\n]+)/g;
  const emailSendRe = /@@EMAIL_SEND:\r?\n([\s\S]*?)@@END/g;

  while ((m = searchRe.exec(text)) !== null) {
    const q = m[1].trim();
    // ── Reject placeholder/template text the model may have echoed literally ──
    const isPlaceholder = /^your query here\.?`*$/i.test(q) || q.length < 2;
    if (!isPlaceholder) results.search.push(q.replace(/`+$/, '').trim());
  }
  while ((m = emailReadRe.exec(text)) !== null) results.emailRead.push(m[1].trim());
  while ((m = emailSendRe.exec(text)) !== null) {
    const block   = m[1];
    const to      = block.match(/^to:\s*(.+)$/mi)?.[1]?.trim() || '';
    const subject = block.match(/^subject:\s*(.+)$/mi)?.[1]?.trim() || '';
    const bodyM   = block.match(/^body:\s*\r?\n([\s\S]*)$/mi);
    const body    = bodyM ? bodyM[1].trim() : '';
    if (to) results.emailSend.push({ to, subject, body });
  }

  // ── Desktop abilities: @@ABILITY:namespace.action \n {json} \n @@END ───────
  // Delegates to skills/abilities' own parser (see try/catch above) so the
  // directive grammar for this feature lives in one place, not two.
  results.abilities = parseAbilityDirectives(text);

  return results;
}

// NOTE: executeDirectives() (the old duplicate directive-runner) has been
// removed — it was dead code, never called. Real execution happens inline
// inside handleAiMessage() (Phase 6 / 5b / 5c). Ability execution should be
// added there too — see toolRunner.js's runAbilities() for the ready-to-call
// wrapper, and skills/abilities/README.md for the exact snippet.

module.exports = { parseDirectives };
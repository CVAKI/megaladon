'use strict';

const { buildMemoryContext, buildSkillsContext } = require('../config');
const { CWD }                                   = require('../filesystem');
const { MODES }                                  = require('../modes');

// ─── stripFileBlocks ──────────────────────────────────────────────────────────
// Strip @@FILE:...@@END blocks from AI reply before markdown rendering.
// The actual file content is handled by parseFileBlocks/applyFileBlocks and
// printed separately via printFileResults — rendering it again through
// formatMD causes the code to spill out unstyled when the AI wraps @@FILE
// inside a code fence (which closes immediately, leaving raw code outside).
function stripFileBlocks(text) {
  return text
    // Remove fenced @@FILE blocks: ```lang\n@@FILE: ...\n``` (AI sometimes wraps the tag)
    .replace(/```[^\n]*\n@@FILE:[^\n]*\n```\n?/g, '')
    // Remove full @@FILE:...@@END blocks (with or without inner fences)
    .replace(/@@FILE:[^\n]*\n(?:```[^\n]*\n)?[\s\S]*?(?:```\n)?@@END\n?/g, '')
    // Remove @@RUN: lines — they are executed live, not for display
    .replace(/^@@RUN:.*$/gm, '')
    .trim();
}

// ─── buildSystemPrompt ────────────────────────────────────────────────────────
// Rebuilds the system prompt from ctx on every turn so freshly saved memory
// facts and newly installed skills are reflected without a restart.
function buildSystemPrompt(ctx) {
  const base             = MODES[ctx.mode]?.prompt || MODES.code.prompt;
  const parts            = [base];
  const currentMemCtx    = buildMemoryContext(ctx.mem, CWD());
  const currentSkillsCtx = buildSkillsContext(ctx.skills);
  if (currentMemCtx)    parts.push('\n---\n' + currentMemCtx);
  if (ctx.folderCtx)    parts.push('\n---\n' + ctx.folderCtx);
  if (currentSkillsCtx) parts.push('\n---\n' + currentSkillsCtx);
  return parts.join('\n');
}

module.exports = { stripFileBlocks, buildSystemPrompt };
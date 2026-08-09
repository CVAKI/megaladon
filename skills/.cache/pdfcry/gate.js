'use strict';

/**
 * gate.js — pdfcry plugin bridge
 * ──────────────────────────────
 * Receives commands from the whyWhale plugin dispatcher and
 * routes them to the appropriate core function inside pdfcry/.
 *
 * Contract (do not change this signature):
 *   module.exports = { handle({ command, args, ctx, pluginDir }) }
 *
 * Return value:
 *   { output: string | object }   success
 *   { error: string }             user-visible error
 */

const path = require('path');

module.exports = {
  async handle({ command, args, ctx, pluginDir }) {
    // Lazy-load core so we don't crash if pdf-parse isn't installed yet
    const core = (() => {
      try { return require(path.join(pluginDir, 'pdfcry', 'reader.js')); }
      catch (e) {
        return null;
      }
    })();

    if (!core) {
      return {
        error:
          'pdfcry core module not found. The plugin may be corrupted.\n' +
          'Try: /skill remove pdfcry  then  /skill install pdfcry',
      };
    }

    // ── /pdfcry <filepath> ────────────────────────────────────────────────────
    if (command === '/pdfcry') {
      const filePath = args[0];
      if (!filePath) return { error: 'Usage: /pdfcry <filepath>\nExample: /pdfcry report.pdf' };
      return core.readPdf(filePath);
    }

    // ── /pdfcry-info <filepath> ───────────────────────────────────────────────
    if (command === '/pdfcry-info') {
      const filePath = args[0];
      if (!filePath) return { error: 'Usage: /pdfcry-info <filepath>' };
      return core.pdfInfo(filePath);
    }

    // ── /pdfcry-ask <filepath> <question...> ──────────────────────────────────
    if (command === '/pdfcry-ask') {
      const filePath = args[0];
      const question = args.slice(1).join(' ');
      if (!filePath || !question)
        return { error: 'Usage: /pdfcry-ask <filepath> <your question>\nExample: /pdfcry-ask contract.pdf summarise the key clauses' };

      const extracted = await core.readPdf(filePath);
      if (extracted.error) return extracted;

      // Inject extracted content into the AI conversation
      if (ctx && ctx.messages !== undefined) {
        const snippet = extracted.text.length > 12000
          ? extracted.text.slice(0, 12000) + '\n...[truncated]'
          : extracted.text;

        const prompt =
          `[PDF: ${filePath} | ${extracted.pages || '?'} pages]\n\n` +
          `${snippet}\n\n---\n${question}`;

        // Push as user message and let whyWhale handle the AI response
        return { aiPrompt: prompt };
      }

      return {
        output:
          `Extracted ${extracted.pages || '?'} page(s) from ${filePath}.\n\n` +
          `**Question:** ${question}\n\n` +
          `*(No AI context available — use whyWhale interactively for AI analysis.)*`,
      };
    }

    return { error: `Unknown command: ${command}` };
  },
};

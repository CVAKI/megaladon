'use strict';

const path = require('path');
const fs   = require('fs');

const { loadConfig, loadMemory, saveMemory, updateMemory } = require('../../config');
const { formatMD, spinner, createPhaseTracker }             = require('../../render');
const { ab, cr, kp, rf, sd }                                 = require('../../colors');
const { selfTestLoop }                                       = require('../../selftest');
const sessionCache                                           = require('../../session-cache');
const { playNotification }                                   = require('../../aug/notify');
const { autoExtractFacts, extractContacts }                  = require('../factExtract');
const { webSearch, formatResultsForModel }                   = require('../../tools/websearch');
const { listInbox, formatInboxForModel, sendEmail }          = require('../../tools/email');

const { runToolWithAutoInstall }        = require('./toolRunner');
const { runShell }                      = require('./safeShell');
const { looksSearchWorthy }             = require('./searchHeuristics');
const {
  detectEmailComposeIntent,
  parseEmailDraftFallback,
  parseEmailReadSpec,
  resolveMailRecipient,
  findSensitiveMemoryHits,
}                                        = require('./emailIntent');
const { parseDirectives }               = require('./directives');
const { extractFilesFromMarkdown }      = require('./markdownFallback');
const { getActivityLabel }              = require('./activityLabels');
const { amplifyRequest }                = require('./amplifier');
const { buildSystemPrompt }             = require('./systemPrompt');
const { callProvider }                  = require('./provider');

// ─── handleAiMessage ──────────────────────────────────────────────────────────
//
// Called by lib/main/index.js as: await handleAiMessage(text, ctx)

async function handleAiMessage(text, ctx) {
  if (!ctx || !ctx.prov) {
    console.log('\n  ' + rf('✘ Provider not ready. Run `megaladon --setup`.'));
    return;
  }

  if (!Array.isArray(ctx.messages)) ctx.messages = [];

  const tracker = createPhaseTracker(7);
  const tw      = Math.min((process.stdout.columns || 80) - 4, 100);
  console.log('\n  ' + ab('─'.repeat(tw)));

  // ── Phase 1: Tokenization ────────────────────────────────────────────────
  tracker.start(1, 'Tokenizing intent');
  if (ctx.mode) tracker.note(1, 'mode: ' + ctx.mode);
  tracker.done(1);

  // ── Phase 2: Context assembly ─────────────────────────────────────────────
  tracker.start(2, 'Assembling context');
  const mem       = ctx.mem || loadMemory();
  // FIX: if ctx.mem was never set by the caller (first AI call of a session),
  // attach it here so every later `if (ctx.mem) {...}` write actually lands.
  // Without this, facts still saved to disk correctly, but `/memory` and the
  // in-session system prompt could show stale data for the rest of the run.
  if (!ctx.mem) ctx.mem = mem;

  // ── Deterministic fact capture ─────────────────────────────────────────────
  // Runs regardless of which model/provider is active. Guarantees basic
  // personal facts (name, role, workplace, etc.) get persisted to
  // ~/.meg/memory.json even if the AI itself never emits an @@MEMORY: line.
  // See lib/main/factExtract.js for the pattern list.
  try {
    const autoFacts = autoExtractFacts(text);
    // Also capture "name -> email" pairs so the mail agent can resolve a
    // person's name to an address from memory instead of guessing one. Runs
    // independently of autoFacts — a message can contain both.
    const contactFacts = extractContacts(text).map(c => ({ key: c.key, value: c.value }));
    const allNewFacts = [...autoFacts, ...contactFacts];
    if (allNewFacts.length) {
      const newOnes = allNewFacts.filter(f =>
          !(mem.facts || []).some(existing => existing.key === f.key && existing.value === f.value)
      );
      if (newOnes.length) {
        updateMemory(mem, newOnes);
        saveMemory(mem);
        if (ctx.mem) ctx.mem.facts = mem.facts;
        tracker.note(2, '💾 auto-saved: ' + newOnes.map(f => f.key + '=' + f.value).join(', '));
      }
    }
  } catch (_) { /* never let fact extraction break the main flow */ }

  const factCount = (Array.isArray(mem?.facts) ? mem.facts : []).length;
  const skillCount= (ctx.skills || []).length;
  tracker.note(2, [
    factCount  ? factCount  + ' memory facts' : null,
    skillCount ? skillCount + ' skills'       : null,
    ctx.folderCtx ? 'folder context loaded'  : null,
  ].filter(Boolean).join(' · ') || 'no extra context');

  const systemPrompt = buildSystemPrompt(ctx);

  // ── Request Amplifier ─────────────────────────────────────────────────────
  // Detects brief "build/create" prompts and expands them into detailed specs
  // so the model writes comprehensive, production-grade output.
  const amplifiedText = amplifyRequest(text, ctx);

  ctx.messages.push({ role: 'user', content: amplifiedText });
  if (ctx.messages.length > 80) ctx.messages.splice(0, ctx.messages.length - 80);
  ctx.msgN = (ctx.msgN || 0) + 1;
  if (ctx.statusRef) ctx.statusRef.msgCount = ctx.msgN;
  tracker.done(2);

  // ── Phase 3: Provider call ────────────────────────────────────────────────
  const cfg     = loadConfig();
  const provKey = ctx.providerKey || cfg.provider || 'anthropic';
  const modelId = ctx.modelId     || cfg.model    || '';
  tracker.start(3, 'Calling ' + provKey);
  tracker.note(3, (provKey === 'ollama' ? 'local · ' : '') + (modelId || 'default model') + ' · max_tokens: ' + (ctx.maxTokens || cfg.maxTokens || 4096).toLocaleString());

  let reply = '';
  const t0  = Date.now();

  // ── Live spinner — label updates every 80ms based on elapsed time ────────
  const spin = spinner(getActivityLabel(ctx.mode || 'code', 0), ctx.mode);

  // Separate interval to update the label as time progresses
  const labelIv = setInterval(() => {
    const sec = Math.floor((Date.now() - t0) / 1000);
    spin.update(getActivityLabel(ctx.mode || 'code', sec));
  }, 500);

  try {
    reply = await callProvider(ctx, [
      { role: 'system', content: systemPrompt },
      ...ctx.messages,
    ]);
  } catch (err) {
    clearInterval(labelIv);
    spin.stop();
    tracker.fail(3, err.message);
    ctx.messages.pop();
    return;
  }
  clearInterval(labelIv);
  spin.stop();
  const elapsed3 = ((Date.now() - t0) / 1000).toFixed(1) + 's';
  tracker.done(3, elapsed3);

  // ── Session cache: record token usage for this provider call ─────────────
  // ctx.totalTok is a running session total (incremented inside callProvider
  // for whichever provider was used), so we record the delta since before
  // this call rather than the cumulative figure.
  try {
    const cacheTok = sessionCache.loadCache();
    const tokDelta = (ctx.totalTok || 0) - (ctx._prevTotalTok || 0);
    if (tokDelta > 0) sessionCache.recordTokens(cacheTok, tokDelta);
    ctx._prevTotalTok = ctx.totalTok || 0;
  } catch (_) { /* never let cache bookkeeping break the main flow */ }

  // ── Phase 4: Thinking / parsing ────────────────────────────────────────────
  tracker.start(4, 'Parsing AI response');
  ctx.messages.push({ role: 'assistant', content: reply });
  ctx.lastReply = reply;
  tracker.done(4);

  // ── Phase 5: Code generation / directive extraction ───────────────────────
  tracker.start(5, 'Extracting files & commands');
  let directives = parseDirectives(reply);

  // ── Email-compose intent detection ─────────────────────────────────────────
  // Detected up front, independently of whether the model already emitted
  // @@SEARCH: on its own or we're about to force one below.
  //
  // FIX: this used to be computed INSIDE the forced-search-fallback `if`
  // block below, and ctx._forcedEmailIntent was only ever set in that same
  // branch. That meant: whenever the model self-emitted @@SEARCH: on its own
  // (directives.search.length > 0 already), the whole fallback `if` was
  // skipped — including this detection — so ctx._forcedEmailIntent stayed
  // null even for a genuine "email X about Y" request. Phase 5b's follow-up
  // then used the generic "answer the question" instruction instead of the
  // email-specific "write the email now, emit @@EMAIL_SEND:" one, and the
  // model just produced a plain prose answer with no To:/Subject: header —
  // not even catchable by parseEmailDraftFallback() — so nothing ever got
  // queued to send. Detecting this unconditionally, and setting
  // ctx._forcedEmailIntent based on whether a search is going to run at all
  // (forced OR model-initiated), fixes that regardless of which path search
  // takes.
  const emailIntent = detectEmailComposeIntent(text);

  // ── Deterministic search fallback ─────────────────────────────────────────
  // Small local models (e.g. qwen2.5-coder:7b) are unreliable at deciding
  // WHEN to emit @@SEARCH: — they sometimes skip it and hallucinate instead,
  // or copy the literal example text. If the user's own message clearly
  // needs current info and the model didn't search, force it here using the
  // user's raw text as the query rather than trusting the model to write one.
  // FIX: this used to be gated to `ctx.mode === 'assistant'` only. But the
  // system prompt (buildSystemPrompt, rule 12) tells the model it CAN use
  // @@SEARCH: in every mode, not just assistant — so a small/local model
  // that ignores that directive (common with e.g. qwen2.5-coder:7b) would
  // just hallucinate an answer instead of searching in every other mode
  // (chat, explain, code, debug, etc.), with nothing here to catch it.
  // Now the deterministic fallback applies regardless of mode — it only
  // triggers on messages that already look clearly search-worthy AND aren't
  // pure "explain a concept" questions, so it stays conservative.
  //
  // FIX 2: this used to push the user's ENTIRE raw sentence as the search
  // query — e.g. "can u send a mail to x@y.com that latest infromation
  // about the openclaw bot" got sent to DDG verbatim, including the email
  // address and imperative phrasing, and returned nothing useful. Now,
  // detectEmailComposeIntent() extracts just the topic when this looks like
  // an "email X about Y" request, so the search query is "openclaw bot and
  // new update" instead of the whole sentence.
  if (directives.search.length === 0 &&
      looksSearchWorthy(text) &&
      !/^(hi|hey|hello|thanks|thank you|ok|okay)\b/i.test(text.trim())) {

    const forcedQuery = emailIntent ? emailIntent.topic : text.trim();
    directives.search.push(forcedQuery);

    tracker.note(5, emailIntent
        ? '⟳ forced search fallback (email-compose topic): "' + forcedQuery + '"'
        : '⟳ forced search fallback — model did not emit @@SEARCH: for a search-worthy message');
  }

  // Set regardless of WHY a search is about to run — forced by the fallback
  // above, or emitted by the model on its own — as long as search will
  // actually happen and this looks like an email-compose request. Cleared
  // again in Phase 5b once the follow-up resolves.
  ctx._forcedEmailIntent = (directives.search.length > 0) ? (emailIntent || null) : null;

  // ── Markdown fallback — local models that ignore @@FILE: ─────────────────
  if (directives.files.length === 0) {
    const extracted = extractFilesFromMarkdown(reply);
    if (extracted.length > 0) {
      directives.files.push(...extracted);
      tracker.note(5, '⟳ auto-extracted ' + directives.files.length + ' file(s) from markdown (model ignored @@FILE: format)');
    }
  }

  const hasWork = directives.files.length > 0 ||
      directives.runs.length  > 0 ||
      directives.memory.length > 0;
  tracker.done(5, hasWork
      ? directives.files.length + ' file(s)  ·  ' + directives.runs.length + ' command(s)'
      : 'chat response — no files');

  // ── Phase 5b: Tools (search / email read) — safe, read-only, auto-run ─────
  // If the model asked to search or check mail, run those NOW, then make one
  // follow-up call so the model can give a real answer using the results,
  // instead of just saying "let me check" and stopping there.
  //
  // Both webSearch() and listInbox() are run through runToolWithAutoInstall()
  // so a missing npm package (e.g. imap-simple, mailparser) is installed and
  // the call retried automatically — this now applies to EVERY tool, not just
  // whichever one happened to fail in testing.
  const needsToolFollowup = directives.search.length > 0 || directives.emailRead.length > 0;
  let lastSearchResults = []; // kept so we can print clickable sources after the reply

  if (needsToolFollowup) {
    tracker.start(6, 'Running tools');
    const toolResults = [];

    for (const q of directives.search) {
      tracker.sub(6, 'run', 'search: ' + q);
      try {
        const r = await runToolWithAutoInstall(webSearch, q, 5);
        toolResults.push(formatResultsForModel(q, r));
        if (r && !r.error) lastSearchResults.push({ query: q, result: r });
        else if (r && r.error) tracker.sub(6, 'info', r.message.slice(0, 100));
      } catch (e) {
        toolResults.push('Search for "' + q + '" failed: ' + e.message);
      }
    }

    for (const spec of directives.emailRead) {
      tracker.sub(6, 'run', 'email inbox: ' + spec);
      try {
        const opts = parseEmailReadSpec(spec);
        const items = await runToolWithAutoInstall(listInbox, opts);
        toolResults.push('Inbox (' + spec + '):\n' + formatInboxForModel(items));
      } catch (e) {
        toolResults.push('Inbox read failed: ' + e.message);
      }
    }

    // FIX: this used to always send a generic "now answer the original
    // question" follow-up, regardless of WHY the search was forced. When
    // the forced-search fallback fired because of an "email X about Y"
    // request (see detectEmailComposeIntent above), that generic wording
    // left small local models stalling on a vague "let me draft that"
    // non-answer instead of actually emitting @@EMAIL_SEND:. Now, if
    // ctx._forcedEmailIntent is set, the follow-up explicitly instructs the
    // model to write the email using the search results and states the
    // recipient address so it doesn't have to guess or re-ask.
    const followUpInstruction = ctx._forcedEmailIntent
        ? `Tool results:\n\n${toolResults.join('\n\n')}\n\nThe person asked you to email ${ctx._forcedEmailIntent.recipient} about "${ctx._forcedEmailIntent.topic}". Using the search results above, write the email now: emit @@EMAIL_SEND: with to: ${ctx._forcedEmailIntent.recipient}, a relevant subject, and a body built from the real information found. Do not re-emit @@SEARCH or @@EMAIL_READ. If the results above are empty or unhelpful, say so plainly and still draft a short email explaining that current info couldn't be found — do not invent facts.`
        : `Tool results:\n\n${toolResults.join('\n\n')}\n\nNow answer the original question using this data. Do not re-emit @@SEARCH or @@EMAIL_READ.`;

    ctx.messages.push({ role: 'user', content: followUpInstruction });

    try {
      const followUp = await callProvider(ctx, [
        { role: 'system', content: systemPrompt },
        ...ctx.messages,
      ]);
      ctx.messages.push({ role: 'assistant', content: followUp });
      reply = followUp;
      ctx.lastReply = reply;
      // Re-parse in case the follow-up itself contains @@FILE/@@EMAIL_SEND/etc.
      directives = parseDirectives(reply);
      tracker.sub(6, 'pass', 'follow-up answer generated from tool results');
    } catch (e) {
      tracker.sub(6, 'fail', 'tool follow-up call failed: ' + e.message);
    }
    // Clear the stashed intent now that the follow-up has resolved (success
    // or failure) — it must never leak into the next unrelated turn.
    ctx._forcedEmailIntent = null;
    tracker.done(6, toolResults.length + ' tool call(s)');
  }

  // ── Deterministic email-draft fallback ─────────────────────────────────────
  // If the model wrote a "To: / Subject: / body" draft as prose instead of
  // emitting @@EMAIL_SEND: — common with small local models even after being
  // explicitly steered there — catch it here so it still reaches the normal
  // confirm-before-send flow below instead of silently going nowhere.
  if (directives.emailSend.length === 0 && /\b(email|mail)\b/i.test(text)) {
    const draft = parseEmailDraftFallback(reply);
    if (draft) {
      directives.emailSend.push(draft);
      console.log('  ' + ab('⟳ auto-extracted email draft from prose (model ignored @@EMAIL_SEND: format)'));
    }
  }

  // ── Phase 5c: Email SEND — never auto-send, always confirm first ──────────
  if (directives.emailSend.length > 0) {
    for (const mail of directives.emailSend) {
      // ── Contact resolution — if "to" isn't a bare email address, try to
      // resolve it against a `contact:<name>` memory fact before showing
      // the preview. This is a courtesy resolve; the model's system prompt
      // (rule 13) is what actually instructs it to prefer memory when
      // the person names someone instead of giving an address directly.
      mail.to = resolveMailRecipient(mail.to, ctx);

      console.log('\n  ' + ab('📧 Megaladon wants to send an email:'));
      console.log('  ' + ab('To: ')      + sd(mail.to));
      console.log('  ' + ab('Subject: ') + sd(mail.subject || '(none)'));
      console.log('  ' + ab('Body:'));
      console.log((mail.body || '(empty)').split('\n').map(l => '    ' + l).join('\n'));

      // ── Secondary confirmation for sensitive/personal data pulled from
      // memory. Separate from the send confirmation below — this specifically
      // flags when the drafted body contains a value that lives in persistent
      // memory (phone numbers, addresses, other people's emails, etc.), since
      // the person should get an explicit heads-up before that data leaves
      // the machine in an email, not just a generic "send this? y/n".
      const sensitiveHits = findSensitiveMemoryHits(mail.body, ctx);
      if (sensitiveHits.length && ctx.ask) {
        console.log('\n  ' + rf('⚠ This email includes data from memory:'));
        sensitiveHits.forEach(h => console.log('  ' + rf('  • ') + sd(h.key + ' = ' + h.value)));
        const sensConfirm = (await ctx.ask('\n  ' + cr('❯ Include this in the email? [y/N]: '))).trim().toLowerCase();
        if (sensConfirm !== 'y' && sensConfirm !== 'yes') {
          sensitiveHits.forEach(h => {
            mail.body = mail.body.split(h.value).join('[REDACTED]');
          });
          console.log('  ' + ab('Redacted from body — you can edit and resend if needed.'));
        }
      }

      let confirm = '';
      if (ctx.ask) {
        confirm = (await ctx.ask('\n  ' + cr('❯ Send this? [y/N]: '))).trim().toLowerCase();
      }
      if (confirm === 'y' || confirm === 'yes') {
        try {
          await runToolWithAutoInstall(sendEmail, mail, ctx);
          console.log('  ' + kp('✔ Sent to ' + mail.to));
        } catch (e) {
          console.log('  ' + rf('✘ Send failed: ' + e.message));
        }
      } else {
        console.log('  ' + ab('Skipped — not sent.'));
      }
    }
  }

  // (re-evaluate hasWork in case the follow-up call above produced new files/runs)
  const hasWorkFinal = directives.files.length > 0 ||
      directives.runs.length  > 0 ||
      directives.memory.length > 0;

  // ── Phase 6: Self-test loop ───────────────────────────────────────────────
  if (hasWorkFinal) {
    tracker.start(6, 'Executing & self-testing');

    // Mark agent task as active so autoDetect won't switch mode on follow-ups
    if (directives.files.length > 0 && ctx) ctx.agentTaskActive = true;

    const appliedFiles = [];

    // Write files
    for (const f of directives.files) {
      try {
        const abs = path.isAbsolute(f.path)
            ? f.path
            : path.join(process.cwd(), f.path);
        fs.mkdirSync(path.dirname(abs), { recursive: true });
        fs.writeFileSync(abs, f.content, 'utf8');
        const lineCount = f.content.split('\n').length;
        tracker.sub(6, 'file', f.path + ' · ' + lineCount + ' lines');
        appliedFiles.push({ path: f.path, full: abs, ok: true });

        // ── Session cache: record the write ───────────────────────────────
        try {
          const cacheF = sessionCache.loadCache();
          sessionCache.recordFile(cacheF, f.path, f.content, 'created');
        } catch (_) {}
      } catch (e) {
        tracker.sub(6, 'fail', 'write failed: ' + f.path + ' — ' + e.message);
        // ── Session cache: record the failure too (used by /memory + BROKEN FILES) ─
        try {
          const cacheF2 = sessionCache.loadCache();
          sessionCache.recordFile(cacheF2, f.path, e.message, 'error');
        } catch (_) {}
      }
    }

    // Run shell commands
    for (let cmd of directives.runs) {
      if (process.platform === 'win32') {
        if (/&\s*$/.test(cmd)) {
          cmd = 'start /B ' + cmd.replace(/&\s*$/, '').trim();
        } else {
          const nodeServerPat = /(^|&&\s*)node\s+\S+\.js\s*$/;
          if (nodeServerPat.test(cmd.trim())) {
            const parts = cmd.split('&&').map(s => s.trim());
            parts[parts.length - 1] = 'start /B ' + parts[parts.length - 1];
            cmd = parts.join(' && ');
          }
        }
      }
      tracker.sub(6, 'run', cmd);
      const r = runShell(cmd);
      if (r.stdout.trim()) tracker.sub(6, 'info', r.stdout.trim().split('\n')[0].slice(0, 80));
      if (r.code !== 0 && r.stderr.trim()) tracker.sub(6, 'fail', r.stderr.trim().split('\n')[0].slice(0, 80));

      // ── Session cache: record the command result ────────────────────────
      try {
        const cacheC = sessionCache.loadCache();
        sessionCache.recordCommand(cacheC, cmd, r.code, r.code !== 0 ? r.stderr : '');
      } catch (_) {}
    }

    // Save memory
    if (directives.memory.length > 0) {
      const m = loadMemory();
      // FIX: facts is an array, not an object — keep it consistent everywhere.
      if (!Array.isArray(m.facts)) m.facts = [];
      for (const { key, value } of directives.memory) {
        updateMemory(m, [{ key, value }]);
        tracker.sub(6, 'info', '💾 memory: ' + key + ' = ' + value);
      }
      try { saveMemory(m); } catch (_) {}
      if (ctx && ctx.mem) Object.assign(ctx.mem, m);
    }

    // Live self-test
    if (ctx.autoTest !== false && appliedFiles.length > 0) {
      tracker.sub(6, 'wait', 'running live self-test on created files…');

      // Spinner while self-test runs
      const testSpin = spinner('running tests', ctx.mode);
      let testAttempt = 0;
      const testLabelIv = setInterval(() => {
        const labels = ['running tests', 'checking output', 'verifying logic', 'reading errors', 'applying fix'];
        testSpin.update(labels[testAttempt % labels.length]);
        testAttempt++;
      }, 2000);

      try {
        const tr = await selfTestLoop(
            ctx.providerKey || cfg.provider,
            ctx.apiKey      || cfg.apiKey,
            ctx.modelId     || cfg.model,
            ctx.messages,
            appliedFiles,
            3
        );
        clearInterval(testLabelIv);
        testSpin.stop();
        if (tr.tested) {
          if (tr.passed) {
            const preview = tr.output ? tr.output.trim().split('\n')[0].slice(0, 70) : '';
            tracker.sub(6, 'pass', 'self-test PASSED' + (preview ? ' — ' + preview : ''));
          } else {
            tracker.sub(6, 'fail', 'self-test FAILED after ' + tr.iterations + ' attempt(s)');
            if (tr.error) {
              tr.error.split('\n').slice(0, 3).forEach(l => tracker.sub(6, 'info', l.slice(0, 80)));
            }
          }
        } else {
          tracker.sub(6, 'info', 'no testable files found');
        }
      } catch (testErr) {
        clearInterval(testLabelIv);
        testSpin.stop();
        tracker.sub(6, 'fail', 'test error: ' + testErr.message.slice(0, 80));
      }
    }

    tracker.done(6);

  } else if (!needsToolFollowup) {
    tracker.start(6, 'Self-test loop');
    tracker.note(6, 'skipped — chat response, no files created');
    tracker.done(6);
  }

  // ── Phase 7: Response assembly ────────────────────────────────────────────
  tracker.start(7, 'Assembling response');
  const display = reply
      .replace(/@@FILE:\s*[^\r\n]+\r?\n[\s\S]*?@@END/g, '')
      .replace(/@@RUN:\s*[^\r\n]+/g, '')
      .replace(/@@MEMORY:\s*[^\r\n]+/g, '')
      .replace(/@@SEARCH:\s*[^\r\n]+/g, '')
      .replace(/@@EMAIL_READ:\s*[^\r\n]+/g, '')
      .replace(/@@EMAIL_SEND:\s*[^\r\n]+\r?\n[\s\S]*?@@END/g, '')
      .trim();
  tracker.done(7);

  // ── Summary ───────────────────────────────────────────────────────────────
  tracker.finish({
    provider: provKey === 'ollama' ? 'Ollama (local)' : provKey,
    model:    modelId || undefined,
    tokens:   ctx.totalTok || undefined,
    elapsed:  elapsed3,
  });

  if (display) console.log(formatMD(display));

  // ── Clickable sources — printed under the AI's own answer, blue + underlined ──
  // Uses OSC 8 terminal hyperlinks (supported by Windows Terminal, most modern
  // terminals). Falls back gracefully to plain text on terminals that don't
  // support it — the escape codes are simply ignored, link text still shows.
  if (lastSearchResults.length > 0) {
    const { C } = require('../../colors');
    console.log('  ' + ab('Sources:'));
    let n = 1;
    for (const { result } of lastSearchResults) {
      if (!result || result.error || !result.results) continue;
      for (const r of result.results) {
        const hyperlink = '\x1b]8;;' + r.url + '\x07' +
            C.whale + C.bold + '🔗 ' + r.title + C.reset +
            '\x1b]8;;\x07';
        console.log('  ' + ab(String(n) + '. ') + hyperlink);
        n++;
      }
    }
  }

  console.log('');

  // ── Notification — play audio chime when AI finishes any response ─────────
  playNotification();

  // ── WA Notification — send terminal work summary to owner ─────────────────
  if (hasWorkFinal && (directives.files.length + directives.runs.length > 0)) {
    try {
      const waPath = path.resolve(__dirname, '../../../connections/whatsapp/index.js');
      if (fs.existsSync(waPath)) {
        const { sendToOwner } = require(waPath);
        if (typeof sendToOwner === 'function') {
          const lines = [
            '🦈 *Terminal work done*',
            '',
            ...directives.files.map(f => '📄 `' + f.path + '`'),
            ...directives.runs.map(r  => '⚡ `' + r + '`'),
            ...directives.memory.map(m => '💾 ' + m.key + ' = ' + m.value),
            '',
            '✅ All phases complete',
          ].filter(l => l !== undefined);
          sendToOwner(lines.join('\n')).catch(() => {});
        }
      }
    } catch (_) {}
  }
}

module.exports = { handleAiMessage };

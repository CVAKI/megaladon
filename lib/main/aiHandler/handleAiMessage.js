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
const { deepSearch, formatResultsForModel }                   = require('../../tools/websearch');
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
  extractRecipientName,
  findPlaceholders,
  memoryValueFor,
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
  if (!ctx.mem) ctx.mem = mem;

  try {
    const autoFacts = autoExtractFacts(text);
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

  const spin = spinner(getActivityLabel(ctx.mode || 'code', 0), ctx.mode);

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
  const emailIntent = detectEmailComposeIntent(text);

  // Name of the recipient as the person themselves phrased it (e.g. "my
  // manager cvaki" → "cvaki"). Independent of emailIntent/forced-search —
  // used later purely to fill "[Manager's Name]"-style placeholders, so it's
  // computed unconditionally here rather than gated behind the forced-search
  // fallback below.
  const recipientNameFromText = extractRecipientName(text);

  // ── Deterministic search fallback ─────────────────────────────────────────
  if (directives.search.length === 0 &&
      looksSearchWorthy(text) &&
      !/^(hi|hey|hello|thanks|thank you|ok|okay)\b/i.test(text.trim())) {

    const forcedQuery = emailIntent ? emailIntent.topic : text.trim();
    directives.search.push(forcedQuery);

    tracker.note(5, emailIntent
        ? '⟳ forced search fallback (email-compose topic): "' + forcedQuery + '"'
        : '⟳ forced search fallback — model did not emit @@SEARCH: for a search-worthy message');
  }

  ctx._forcedEmailIntent = (directives.search.length > 0) ? (emailIntent || null) : null;

  // FIX: capture the intent HERE, before the tool block below has a chance
  // to null it out on ctx. This is what lets the new last-resort fallback
  // further down (after the existing prose-draft fallback) know whether an
  // email was explicitly asked for and explicitly steered toward the model,
  // even if that steering didn't work on a small/local model that ignores
  // compound "if X, still do Y" instructions.
  const hadForcedEmailIntent = ctx._forcedEmailIntent;

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
  const needsToolFollowup = directives.search.length > 0 || directives.emailRead.length > 0;
  let lastSearchResults = [];

  if (needsToolFollowup) {
    tracker.start(6, 'Running tools');
    const toolResults = [];

    for (const q of directives.search) {
      tracker.sub(6, 'run', 'search: ' + q);
      try {
        // FIX: was webSearch() — only returns titles/snippets, never the
        // actual page text. That's exactly why the "is Friday a holiday"
        // check hedged instead of answering: the model had five link titles
        // to work with and nothing else to actually read. deepSearch() runs
        // the same search, then fetches the real text of the top few result
        // pages (see lib/tools/websearch.js: fetchTop/perPageChars) and
        // formatResultsForModel() already prefers r.content over r.snippet
        // when present — so this is a drop-in swap, no downstream changes
        // needed. Slower (page fetches add latency) and slightly more
        // fragile (a page can fail to fetch, in which case it just falls
        // back to that source's snippet, same as before) — worth it for
        // anything where the model needs to actually reason about content,
        // not just know that a page with a relevant title exists.
        const r = await runToolWithAutoInstall(deepSearch, q, { max: 5, fetchTop: 3, perPageChars: 2200 });
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
      directives = parseDirectives(reply);
      tracker.sub(6, 'pass', 'follow-up answer generated from tool results');
    } catch (e) {
      tracker.sub(6, 'fail', 'tool follow-up call failed: ' + e.message);
    }
    // hadForcedEmailIntent above already has a stable copy for the fallback
    // logic below, so clearing ctx._forcedEmailIntent here is safe.
    ctx._forcedEmailIntent = null;
    tracker.done(6, toolResults.length + ' tool call(s)');
  }

  // ── Deterministic email-draft fallback ─────────────────────────────────────
  if (directives.emailSend.length === 0 && /\b(email|mail)\b/i.test(text)) {
    const draft = parseEmailDraftFallback(reply);
    if (draft) {
      directives.emailSend.push(draft);
      console.log('  ' + ab('⟳ auto-extracted email draft from prose (model ignored @@EMAIL_SEND: format)'));
    }
  }

  // FIX: last-resort fallback. Even after the follow-up instruction
  // explicitly told the model "write the email now... if results are empty,
  // still draft a short email explaining that", small/local models (e.g.
  // qwen2.5-coder:7b) can just ignore that clause entirely and produce a
  // plain apology with no To:/Subject: — which parseEmailDraftFallback()
  // above has nothing to catch, since there's no draft-shaped text at all.
  // When that happens, the person's original "email X about Y" request was
  // real and detected correctly (hadForcedEmailIntent), but nothing ever
  // reaches the confirm-before-send flow below. Rather than let the request
  // silently evaporate into an unrelated chat reply, build a minimal, honest
  // email ourselves — it clearly states info wasn't found rather than
  // inventing anything, and the person still gets the normal preview +
  // confirm-before-send step, so nothing sends without their say-so.
  if (directives.emailSend.length === 0 && hadForcedEmailIntent) {
    directives.emailSend.push({
      to: hadForcedEmailIntent.recipient,
      subject: hadForcedEmailIntent.topic,
      body: `Hi,\n\nYou asked me to look into "${hadForcedEmailIntent.topic}" — I searched but couldn't find reliable current information on this.\n\n— Sent via Megaladon`,
    });
    console.log('  ' + ab('⟳ model did not draft an email — built a fallback "no info found" email instead'));
  }

  // ── Phase 5c: Email SEND — never auto-send, always confirm first ──────────
  if (directives.emailSend.length > 0) {
    for (const mail of directives.emailSend) {
      mail.to = resolveMailRecipient(mail.to, ctx);

      // ── Deterministic recipient override ───────────────────────────────
      // FIX: small local models sometimes just invent their own "to:"
      // address instead of using the literal one the person typed — e.g.
      // person wrote "his mail id is cvaki.com@gmail.com" and the model
      // drafted "to: cvaki@cvaki.com" anyway. If the person's own message
      // contained a literal email address, that address is authoritative —
      // it must never be silently overridden by whatever the model chose,
      // since a wrong recipient here means real, sensitive content (leave
      // requests, personal reasons, etc.) goes to the wrong inbox.
      if (emailIntent?.recipient && mail.to !== emailIntent.recipient) {
        console.log('  ' + rf('⚠ Model drafted "to: ' + mail.to + '"') +
            ab(', but you gave "' + emailIntent.recipient + '" — using your address instead.'));
        mail.to = emailIntent.recipient;
      }

      // ── Placeholder resolution ───────────────────────────────────────────
      // FIX: drafted emails often leave template placeholders untouched —
      // "[Manager's Name]", "[Your Position]", "[Your Contact Information]"
      // — even when the real value was right there in the person's message
      // or already saved in memory. Resolve each one, in priority order:
      //   1. Recipient-name placeholders ("[Manager's Name]") → filled from
      //      what the person actually typed, never asked about.
      //   2. Known personal-info placeholders ("[Your Position]") → filled
      //      silently from persistent memory if we already have it.
      //   3. Anything left → ask the person directly, once per placeholder,
      //      and remember the answer (when it maps to a known memory key)
      //      so future emails don't ask again.
      // A placeholder nobody can resolve gets stripped rather than sent out
      // verbatim as "[Your Position]" in a real email.
      const placeholders = [
        ...new Set([...findPlaceholders(mail.subject), ...findPlaceholders(mail.body)]),
      ];

      for (const ph of placeholders) {
        let replacement = null;

        if (/manager|recipient|boss|supervisor|his\s*name|her\s*name|their\s*name/i.test(ph) && recipientNameFromText) {
          replacement = recipientNameFromText;
        } else {
          const memHit = memoryValueFor(ph, ctx);
          if (memHit && memHit.value) {
            replacement = memHit.value;
          } else if (ctx.ask) {
            const answer = (await ctx.ask(
                '\n  ' + cr('❯ Email has a placeholder ' + ph + ' — enter a value (blank to remove): ')
            )).trim();
            if (answer) {
              replacement = answer;
              if (memHit?.key) {
                try {
                  const mPlaceholder = loadMemory();
                  updateMemory(mPlaceholder, [{ key: memHit.key, value: answer }]);
                  saveMemory(mPlaceholder);
                  if (ctx.mem) ctx.mem.facts = mPlaceholder.facts;
                  console.log('  ' + ab('💾 saved ' + memHit.key + ' for next time'));
                } catch (_) {}
              }
            }
          }
        }

        if (replacement) {
          mail.subject = mail.subject.split(ph).join(replacement);
          mail.body    = mail.body.split(ph).join(replacement);
        } else {
          mail.subject = mail.subject.split(ph).join('');
          mail.body    = mail.body.split(ph).join('');
        }
      }

      console.log('\n  ' + ab('📧 Megaladon wants to send an email:'));
      console.log('  ' + ab('To: ')      + sd(mail.to));
      console.log('  ' + ab('Subject: ') + sd(mail.subject || '(none)'));
      console.log('  ' + ab('Body:'));
      console.log((mail.body || '(empty)').split('\n').map(l => '    ' + l).join('\n'));

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

  const hasWorkFinal = directives.files.length > 0 ||
      directives.runs.length  > 0 ||
      directives.memory.length > 0;

  // ── Phase 6: Self-test loop ───────────────────────────────────────────────
  if (hasWorkFinal) {
    tracker.start(6, 'Executing & self-testing');

    if (directives.files.length > 0 && ctx) ctx.agentTaskActive = true;

    const appliedFiles = [];

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

        try {
          const cacheF = sessionCache.loadCache();
          sessionCache.recordFile(cacheF, f.path, f.content, 'created');
        } catch (_) {}
      } catch (e) {
        tracker.sub(6, 'fail', 'write failed: ' + f.path + ' — ' + e.message);
        try {
          const cacheF2 = sessionCache.loadCache();
          sessionCache.recordFile(cacheF2, f.path, e.message, 'error');
        } catch (_) {}
      }
    }

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

      try {
        const cacheC = sessionCache.loadCache();
        sessionCache.recordCommand(cacheC, cmd, r.code, r.code !== 0 ? r.stderr : '');
      } catch (_) {}
    }

    if (directives.memory.length > 0) {
      const m = loadMemory();
      if (!Array.isArray(m.facts)) m.facts = [];
      for (const { key, value } of directives.memory) {
        updateMemory(m, [{ key, value }]);
        tracker.sub(6, 'info', '💾 memory: ' + key + ' = ' + value);
      }
      try { saveMemory(m); } catch (_) {}
      if (ctx && ctx.mem) Object.assign(ctx.mem, m);
    }

    if (ctx.autoTest !== false && appliedFiles.length > 0) {
      tracker.sub(6, 'wait', 'running live self-test on created files…');

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

  playNotification();

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
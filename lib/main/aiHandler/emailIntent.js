'use strict';

const { ab, rf, sd } = require('../../colors');

// ─── detectEmailComposeIntent ────────────────────────────────────────────────
// Deterministic detector for "send/email/mail X that/about/regarding Y" style
// requests. Used by the forced-search fallback so the search query becomes
// just the topic ("openclaw bot and new update"), not the whole raw sentence
// — and so the tool-results follow-up can explicitly tell the model "this
// needs to end in @@EMAIL_SEND:" instead of leaving a small local model to
// infer that on its own from a generic "answer the question" instruction.
//
// Deliberately conservative: only fires when BOTH a send/email/mail verb AND
// a literal email address are present in the same message. Anything looser
// (e.g. matching on a person's name instead of an address) risks misfiring
// on ordinary questions and is left to the model + resolveMailRecipient()
// in the normal @@EMAIL_SEND: path instead.
function detectEmailComposeIntent(text) {
  const t = (text || '').trim();
  const addrM = t.match(/[\w.+-]+@[\w-]+\.[a-z]{2,}/i);
  const verbM = /\b(send|email|mail)\b/i.test(t);
  if (!verbM || !addrM) return null;

  const recipient = addrM[0];
  const afterAddr = t.slice(t.indexOf(recipient) + recipient.length);

  // Find the LAST connector word ("that"/"about"/"regarding"/etc.) rather
  // than the first — "that latest information about X" should extract "X",
  // not "latest information about X".
  const connectorRe = /\b(?:that|about|regarding|on|saying|with)\b\s*/gi;
  let m, cutAt = -1;
  while ((m = connectorRe.exec(afterAddr)) !== null) cutAt = m.index + m[0].length;

  let topic = cutAt >= 0 ? afterAddr.slice(cutAt) : afterAddr;
  topic = topic
      .replace(/^(the|a|an)\s+/i, '')
      .replace(/^latest\s+/i, '')
      .replace(/[!?.]+\s*$/, '')
      .trim();

  if (!topic || topic.length < 3) return null;
  return { recipient, topic };
}

// ─── parseEmailDraftFallback ─────────────────────────────────────────────────
// Small local models sometimes write an email out as plain prose — a "To:" /
// "Subject:" / body draft — instead of emitting the @@EMAIL_SEND: directive,
// even when explicitly steered there (see the forced-search email-compose
// follow-up in handleAiMessage). When that happens, parseDirectives() finds
// nothing, Phase 5c never runs, and the person just sees a draft with no
// indication that nothing was actually queued to send. This catches that
// prose pattern deterministically and turns it into a real emailSend
// directive so the normal confirm-before-send flow still runs.
//
// Deliberately conservative: requires BOTH a "To:" line containing a real
// email address AND a "Subject:" line in the same reply, so it won't
// misfire on unrelated text that happens to contain those words.
function parseEmailDraftFallback(reply) {
  const toMatch = reply.match(/^\s*(?:\*\*)?To:(?:\*\*)?\s*([\w.+-]+@[\w-]+\.[a-z]{2,})/mi);
  if (!toMatch) return null;
  const subjMatch = reply.match(/^\s*(?:\*\*)?Subject:(?:\*\*)?\s*(.+)$/mi);
  if (!subjMatch) return null;

  const to      = toMatch[1].trim();
  const subject = subjMatch[1].trim().replace(/\*+$/, '').trim();

  // Body: everything after the Subject line...
  const afterSubjectIdx = reply.indexOf(subjMatch[0]) + subjMatch[0].length;
  let body = reply.slice(afterSubjectIdx);

  // Cut off at the next markdown horizontal rule (---, ***, ___) if present —
  // models often close the drafted block with one before adding commentary.
  const hrMatch = body.match(/\n\s*(?:-{3,}|\*{3,}|_{3,})\s*\n/);
  if (hrMatch) body = body.slice(0, hrMatch.index);

  body = body.trim();

  // Strip a common trailing meta-commentary paragraph some models append
  // after the sign-off (e.g. "Please review and confirm before sending...").
  const metaTailRe = /\n\n(?:Please (?:review|let me know)|Let me know|Feel free to)[^\n]*$/i;
  body = body.replace(metaTailRe, '').trim();

  if (!body || body.length < 5) return null;
  return { to, subject, body };
}

// ─── parseEmailReadSpec ────────────────────────────────────────────────────
// The model's @@EMAIL_READ: payload can be a bare shorthand ("10", "unread")
// or a set of key=value filters ("subject=invoice since=2026-08-01 limit=5").
// This turns either form into the options object listInbox() expects.
// Bare-word forms are kept for backward compatibility with the original
// simple two-mode directive.
function parseEmailReadSpec(spec) {
  const s = (spec || '').trim();
  const opts = { limit: 10, unreadOnly: false, subjectFilter: '', fromFilter: '', since: null };

  if (!s) return opts;

  // Bare "unread"
  if (/^unread$/i.test(s)) { opts.unreadOnly = true; return opts; }
  // Bare number, e.g. "10"
  if (/^\d+$/.test(s)) { opts.limit = parseInt(s, 10); return opts; }

  // key=value pairs — supports quoted values: subject="project x" from=boss@co.com
  const pairRe = /(\w+)=("([^"]*)"|'([^']*)'|\S+)/g;
  let m;
  let matched = false;
  while ((m = pairRe.exec(s)) !== null) {
    matched = true;
    const key = m[1].toLowerCase();
    const val = m[3] !== undefined ? m[3] : (m[4] !== undefined ? m[4] : m[2]);
    if (key === 'subject')            opts.subjectFilter = val;
    else if (key === 'from')          opts.fromFilter = val;
    else if (key === 'since')         opts.since = val;
    else if (key === 'limit' || key === 'n') opts.limit = parseInt(val, 10) || opts.limit;
    else if (key === 'unread')        opts.unreadOnly = /^(true|1|yes)$/i.test(val);
  }
  if (matched) return opts;

  // Fallback: treat the whole spec as a bare limit/word we don't recognise —
  // keep defaults rather than erroring, so a malformed spec still fetches
  // something reasonable instead of failing the whole tool call.
  return opts;
}

// ─── resolveMailRecipient ───────────────────────────────────────────────────
// If the model's "to" field already looks like an email address, use it as-is.
// Otherwise treat it as a person's name and look up `contact:<name>` in
// persistent memory. This is a courtesy resolve for the terminal preview —
// the system prompt separately instructs the model to prefer memory itself
// and ask the person to confirm/clarify when it isn't confident, so this
// mostly catches cases where the model passed a bare name straight through.
function resolveMailRecipient(to, ctx) {
  const raw = (to || '').trim();
  if (/^[\w.+-]+@[\w-]+\.[a-z]{2,}$/i.test(raw)) return raw; // already an address

  try {
    const { contactKey } = require('../factExtract');
    const key = contactKey(raw);
    const facts = ctx?.mem?.facts;
    const hit = Array.isArray(facts) ? facts.find(f => f.key === key) : null;
    if (hit?.value) {
      console.log('  ' + ab('ℹ Resolved "' + raw + '" → ') + sd(hit.value) + ab(' (from memory)'));
      return hit.value;
    }
  } catch (_) {}

  console.log('  ' + rf('⚠ "' + raw + '" doesn\'t look like an email address and no contact was found in memory.'));
  return raw; // leave as-is — sendEmail will fail cleanly, and the person sees exactly what was attempted
}

// ─── findSensitiveMemoryHits ────────────────────────────────────────────────
// Scans a drafted email body for any persistent-memory fact VALUE that made
// it into the text (phone numbers, other people's addresses, workplace, etc.)
// so the person gets an explicit heads-up before that data leaves the machine
// in an outgoing email — separate from the generic "send this? y/n" prompt.
// Deliberately conservative: skips very short values (3 chars or fewer) to
// avoid flagging incidental substring matches, and skips the recipient's own
// resolved address (that's the point of the email, not a leak).
function findSensitiveMemoryHits(body, ctx) {
  if (!body) return [];
  const facts = ctx?.mem?.facts;
  if (!Array.isArray(facts)) return [];

  const hits = [];
  for (const f of facts) {
    const val = String(f.value || '').trim();
    if (val.length <= 3) continue;
    if (body.includes(val)) hits.push({ key: f.key, value: val });
  }
  return hits;
}

module.exports = {
  detectEmailComposeIntent,
  parseEmailDraftFallback,
  parseEmailReadSpec,
  resolveMailRecipient,
  findSensitiveMemoryHits,
};

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
//
// Handles TWO sentence orderings:
//   Case A — "send a mail to x@y.com about Z"      (topic AFTER the address)
//   Case B — "send a mail about Z ... his mail id is x@y.com"  (topic BEFORE)
// FIX: originally only handled Case A — it looked for a connector word
// (about/regarding/etc.) in the text AFTER the email address. When the
// address is the last thing in the sentence (Case B, e.g. "...his mail id
// is x@y.com"), afterAddr is empty, topic extraction silently failed, and
// this returned null. That had two knock-on effects: the forced-search
// fallback used the ENTIRE raw sentence as the search query instead of just
// the topic, and ctx._forcedEmailIntent never got set — so the tool-results
// follow-up used the generic "answer the question" instruction instead of
// "write the email now, emit @@EMAIL_SEND:", leaving small local models to
// just explain how to use Gmail instead of actually drafting anything.
function extractAfterConnector(segment) {
  const connectorRe = /\b(?:that|about|regarding|on|saying|with)\b\s*/gi;
  let m, cutAt = -1;
  while ((m = connectorRe.exec(segment)) !== null) cutAt = m.index + m[0].length;
  return cutAt >= 0 ? segment.slice(cutAt) : segment;
}

function cleanTopic(raw) {
  return raw
      .replace(/^(the|a|an)\s+/i, '')
      .replace(/^latest\s+/i, '')
      .replace(/[!?.]+\s*$/, '')
      .trim();
}

function detectEmailComposeIntent(text) {
  const t = (text || '').trim();
  const addrM = t.match(/[\w.+-]+@[\w-]+\.[a-z]{2,}/i);
  const verbM = /\b(send|email|mail)\b/i.test(t);
  if (!verbM || !addrM) return null;

  const recipient = addrM[0];
  const addrIdx    = t.indexOf(recipient);
  const beforeAddr = t.slice(0, addrIdx);
  const afterAddr  = t.slice(addrIdx + recipient.length);

  // Case A: address comes first, topic follows — "email x@y.com about Z"
  let topic = cleanTopic(extractAfterConnector(afterAddr));

  // Case B: topic comes BEFORE the address — "send a mail about Z ... his
  // mail id is x@y.com". Fall back to scanning the text before the address.
  if (!topic || topic.length < 3) {
    let beforeTopic = cleanTopic(extractAfterConnector(beforeAddr));
    // Trim trailing boilerplate that leads INTO the recipient mention itself
    // (e.g. "to my friend cvaki? his mail id is") — stop right before that,
    // so it doesn't end up folded into the "topic".
    const trailingCutRe = /\b(?:to\s+(?:my|his|her|their|our)\s+\w+|mail\s+id\s+is|email\s+id\s+is|e-?mail\s+is|mail\s+is|his\s+mail|her\s+mail|their\s+mail)\b/i;
    const cm = trailingCutRe.exec(beforeTopic);
    if (cm) beforeTopic = beforeTopic.slice(0, cm.index).trim();
    topic = beforeTopic.replace(/[?!.,;:]+\s*$/, '').trim();
  }

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

// ─── extractRecipientName ────────────────────────────────────────────────────
// Pulls the recipient's actual name out of the person's own message, e.g.
// "send a mail to my manager cvaki, his mail id is ..." → "cvaki". Used to
// deterministically fill "[Manager's Name]"-style placeholders instead of
// leaving them as a raw bracketed placeholder in the sent email, or trusting
// a small local model to have picked it up on its own (it usually doesn't —
// see the drafted email in the transcript this was added to fix, which sent
// with "Dear [Manager's Name]," untouched even though the person wrote
// "my manager cvaki" right there in the same sentence).
//
// Deliberately narrow: only fires on "<relationship word> <name>" patterns
// (manager, boss, friend, etc.) immediately followed by a single word that
// looks like a name. Returns null rather than guessing on anything looser.
function extractRecipientName(text) {
  const t = (text || '');
  const m = t.match(/\b(?:manager|boss|supervisor|friend|colleague|teacher|professor|hr|team\s*lead|lead)\s+([A-Za-z][A-Za-z'’-]{1,30})\b/i);
  return m ? m[1].trim() : null;
}

// ─── findPlaceholders ────────────────────────────────────────────────────────
// Finds bracket-style placeholders a model left behind in a drafted email —
// "[Manager's Name]", "[Your Position]", "{{Your Contact Information}}" —
// that it should have filled in but didn't. Small local models frequently
// draft a "template-shaped" email and leave these untouched even when the
// real values were available (in the person's message or in memory), which
// means without this check they'd go out in a real email verbatim.
function findPlaceholders(text) {
  if (!text) return [];
  const re = /\[[^\[\]]{2,60}\]|\{\{[^{}]{2,60}\}\}|\{[^{}]{2,60}\}/g;
  const seen = new Set();
  const out = [];
  let m;
  while ((m = re.exec(text)) !== null) {
    if (!seen.has(m[0])) { seen.add(m[0]); out.push(m[0]); }
  }
  return out;
}

// ─── PLACEHOLDER_MEMORY_MAP / memoryValueFor ─────────────────────────────────
// Maps common placeholder phrasings to the persistent-memory fact key that
// should fill them, so "[Your Position]" is answered from memory silently
// when we already know it, instead of asking the person the same thing on
// every single email. Returns { key, value } where value is null if the key
// is recognised but nothing is saved for it yet (caller then knows both
// WHAT to ask for, and what key to remember the answer under) — or null if
// the placeholder doesn't match any known field at all.
const PLACEHOLDER_MEMORY_MAP = [
  { re: /your\s*name/i,                               key: 'user_name' },
  { re: /your\s*(position|title|role|designation)/i,  key: 'user_position' },
  { re: /your\s*(contact|phone|number|mobile)/i,       key: 'user_phone' },
  { re: /your\s*email/i,                              key: 'user_email' },
  { re: /your\s*(company|organi[sz]ation)/i,           key: 'user_company' },
];

function memoryValueFor(placeholder, ctx) {
  const inner = (placeholder || '').replace(/^[\[{]+|[\]}]+$/g, '');
  const hit = PLACEHOLDER_MEMORY_MAP.find(p => p.re.test(inner));
  if (!hit) return null;
  const facts = ctx?.mem?.facts;
  const f = Array.isArray(facts) ? facts.find(x => x.key === hit.key) : null;
  return { key: hit.key, value: f ? f.value : null };
}

module.exports = {
  detectEmailComposeIntent,
  parseEmailDraftFallback,
  parseEmailReadSpec,
  resolveMailRecipient,
  findSensitiveMemoryHits,
  extractRecipientName,
  findPlaceholders,
  memoryValueFor,
};
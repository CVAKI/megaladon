'use strict';

// ─── factExtract.js ────────────────────────────────────────────────────────────
// Deterministic (non-AI) extraction of common personal/project facts from the
// user's raw message.
//
// WHY THIS EXISTS:
// Persistent memory in Megaladon is normally only saved when the MODEL itself
// decides to emit an "@@MEMORY: key=value" line in its reply. Small / local
// models (e.g. Ollama qwen2.5-coder:7b) very often just don't do this for
// casual info like "my name is Siva" — so nothing gets written to
// ~/.meg/memory.json, and the next session the AI has no idea who you are.
// It *looks* like memory works because the model can still see your name
// earlier in the same conversation (ctx.messages) — but that's just
// short-term chat context, not persistent memory, and it's gone the moment
// you restart Megaladon.
//
// This module runs BEFORE the AI call on every user message and guarantees
// a small set of high-value personal/project facts get captured and saved
// to persistent memory regardless of what the model does or doesn't do.
//
// UPDATE — contact extraction:
// Adds a SEPARATE extractor, extractContacts(), that captures "name -> email"
// pairs (e.g. "Rahul's email is rahul@x.com") so the mail agent can resolve a
// person's name to an address from memory instead of guessing or hallucinating
// one. These are stored under keys like `contact:rahul` so they're easy for
// both this code and the AI's system-prompt Memory block to find and use.

const RULES = [
    { key: 'user_name',      re: /\bmy name is ([a-zA-Z][a-zA-Z '-]{1,30})/i },
    { key: 'user_name',      re: /\byou can call me ([a-zA-Z][a-zA-Z '-]{1,30})/i },
    { key: 'user_name',      re: /\bcall me ([a-zA-Z][a-zA-Z '-]{1,30})/i },
    { key: 'user_name',      re: /\bthis is ([a-zA-Z][a-zA-Z '-]{1,30}) (?:speaking|here)\b/i },
    { key: 'user_workplace', re: /\bi work at ([a-zA-Z0-9][\w .,'&-]{1,40})/i },
    { key: 'user_role',      re: /\bi'?m an? ([a-zA-Z][\w .-]{1,40}?) (?:developer|engineer|designer|student|manager|founder)/i },
    { key: 'user_editor',    re: /\bi use ([a-zA-Z0-9][\w .-]{1,30}) as my (?:editor|ide)\b/i },
    { key: 'user_os',        re: /\bi(?:'?m| am) on (windows|mac(?:os)?|linux|ubuntu)\b/i },
    { key: 'project_name',   re: /\bthis project is called ([a-zA-Z0-9][\w .-]{1,40})/i },
    { key: 'preferred_lang', re: /\bi (?:prefer|mostly use|mainly code in) (javascript|typescript|python|java|c\+\+|c#|go|rust|php|ruby|kotlin|swift)\b/i },
    // Phone number — matches "my number is X", "my phone is X", "contact me at X"
    { key: 'user_phone_number', re: /\bmy (?:phone|number|mobile|whatsapp)(?:\s+number)? is\s*[:\-]?\s*(\+?\d[\d\s-]{6,15}\d)/i },
    // The user's OWN outgoing-mail identity/signature name, distinct from user_name
    // (lets someone go by "Siva" in chat but sign mail as "Sivanand Shibu").
    { key: 'user_mail_signature', re: /\bsign (?:my )?(?:emails?|mails?) as ([a-zA-Z][a-zA-Z .'-]{1,40})/i },
];

// ── Generic catch-all: "remember (that) <anything>" ────────────────────────
// The README explicitly advertises this as a supported feature
// ("remember that the backend runs on port 4000") but it previously only
// worked if the AI itself chose to emit @@MEMORY: — which small/local models
// unreliably do. This makes the phrase deterministically saved regardless of
// the model. Unlike the fixed-key RULES above (one value per key, overwritten
// on update), each "remember that X" gets its own timestamped key so multiple
// notes accumulate instead of clobbering each other.
const REMEMBER_RE = /\bremember (?:that|to)?\s*(.+)/i;

// ── Contact extraction: "Name's email is x@y.com" ──────────────────────────
// Deliberately separate from RULES because it captures TWO values (a name
// AND an address) rather than one — RULES assumes a single capture group
// mapped to a single fixed key.
const EMAIL_ADDR_RE = '([\\w.+-]+@[\\w-]+\\.[a-z]{2,})';
// Name capture is lazy and excludes the apostrophe from the greedy class so
// "Rahul's" doesn't swallow the apostrophe into the name itself. Allows a
// single space (one middle/last name) for the "of|for" phrasing.
const NAME_CAP        = '([A-Za-z][A-Za-z-]{1,20}(?:\\s[A-Za-z][A-Za-z-]{1,20})?)';
// Single-word variant for the bracket-shorthand rule below — deliberately
// NOT the two-word NAME_CAP, otherwise "ping Rahul <rahul@x.com>" greedily
// swallows "ping Rahul" as the name instead of just "Rahul".
const NAME_CAP_SINGLE = '([A-Za-z][A-Za-z-]{1,20})';
const CONTACT_RULES = [
    // "Rahul's email is rahul@x.com" / "Rahul's mail id is ..." / "Rahul's gmail is ..."
    new RegExp('\\b' + NAME_CAP + '\'s\\s+(?:email|mail|gmail)(?:\\s+id)?(?:\\s+address)?\\s+is\\s*[:\\-]?\\s*' + EMAIL_ADDR_RE, 'i'),
    // "email of Rahul is rahul@x.com" / "the email for Priya Nair is ..."
    new RegExp('\\b(?:email|mail)\\s+(?:of|for)\\s+' + NAME_CAP + '\\s+is\\s*[:\\-]?\\s*' + EMAIL_ADDR_RE, 'i'),
    // "Rahul <rahul@x.com>" or "Rahul (rahul@x.com)" — quick shorthand people type
    new RegExp('\\b' + NAME_CAP_SINGLE + '\\s*[\\(<]\\s*' + EMAIL_ADDR_RE + '\\s*[\\)>]', 'i'),
];

function isSane(value) {
    if (!value) return false;
    const v = value.trim();
    if (v.length < 2 || v.length > 60) return false;
    if (/https?:\/\//i.test(v)) return false;
    if (/[{}<>@#$%^*]/.test(v)) return false;
    return true;
}

// Longer cap for freeform "remember that ..." notes — these are meant to be
// short reminders/facts, not essays, but 60 chars (the RULES cap) is too
// tight for a full sentence like "the staging server runs on port 4000".
function isSaneNote(value) {
    if (!value) return false;
    const v = value.trim();
    if (v.length < 3 || v.length > 200) return false;
    if (/[{}<>]/.test(v)) return false;
    return true;
}

// Words that should never be swept into a captured value — trims greedy
// matches like "call me Siva from now on" down to just "Siva".
const STOPWORDS = new Set([
    'from', 'now', 'on', 'and', 'but', 'so', 'today', 'here', 'please',
    'thanks', 'thank', 'ok', 'okay', 'by', 'the', 'a', 'an', 'is', 'was',
    'to', 'for', 'if', 'when', 'then', 'also', 'just', 'still', 'again',
]);

// Trims a raw capture (e.g. "Siva from now on") down to at most the first
// two real words (first name + surname), stopping at the first stopword.
function trimToName(raw) {
    const words = raw.trim().split(/\s+/);
    const kept  = [];
    for (const w of words) {
        if (STOPWORDS.has(w.toLowerCase())) break;
        kept.push(w);
        if (kept.length >= 2) break;
    }
    return kept.join(' ');
}

// "user_name" facts get the stopword trim; other keys (workplace, role,
// project name, etc.) are allowed to keep more of the phrase.
const TRIM_KEYS = new Set(['user_name', 'user_mail_signature']);

// Timestamp-based key for freeform notes, e.g. note_20260811_061725
function noteKey() {
    const d = new Date();
    const p = n => String(n).padStart(2, '0');
    return 'note_' + d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) +
        '_' + p(d.getHours()) + p(d.getMinutes()) + p(d.getSeconds());
}

// Normalises a captured display name into a memory key, e.g. "Rahul K" -> "rahul_k"
function contactKey(name) {
    return 'contact:' + name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
}

/**
 * @param {string} text - raw user message
 * @returns {Array<{key:string, value:string}>}
 */
function autoExtractFacts(text) {
    if (!text || typeof text !== 'string') return [];
    const found = [];
    const seenKeys = new Set();

    for (const rule of RULES) {
        if (seenKeys.has(rule.key)) continue; // first match per key wins
        const m = rule.re.exec(text);
        if (m && m[1]) {
            let value = m[1].trim().replace(/[.!,;]+$/, '');
            if (TRIM_KEYS.has(rule.key)) value = trimToName(value);
            if (isSane(value)) {
                found.push({ key: rule.key, value });
                seenKeys.add(rule.key);
            }
        }
    }

    // ── "remember that X" catch-all ─────────────────────────────────────────
    // Runs independently of the fixed-key RULES above — a message can both
    // match a specific rule (e.g. "remember my name is Siva" hits user_name)
    // AND still get logged as a freeform note, which is fine since they're
    // different keys and both are useful.
    const rm = REMEMBER_RE.exec(text);
    if (rm && rm[1]) {
        const note = rm[1].trim().replace(/[.!]+$/, '');
        if (isSaneNote(note)) {
            found.push({ key: noteKey(), value: note });
        }
    }

    return found;
}

/**
 * extractContacts — captures "name -> email" pairs from a message so the
 * mail agent can resolve a person's name to an address from memory instead
 * of guessing. Returns facts shaped like { key: 'contact:rahul', value: 'rahul@x.com' }.
 *
 * Deliberately conservative: only matches when the message explicitly pairs
 * a name with an address in one of a few common phrasings. It will NOT try
 * to guess an address from a name alone, and it will NOT overwrite an
 * existing contact with a different address without the caller treating
 * that as an update (same behaviour as updateMemory() elsewhere — last
 * write wins, which mirrors how the rest of memory already works).
 *
 * @param {string} text - raw user message
 * @returns {Array<{key:string, value:string, displayName:string}>}
 */
function extractContacts(text) {
    if (!text || typeof text !== 'string') return [];
    const found = [];
    const seen  = new Set();

    for (const re of CONTACT_RULES) {
        const m = re.exec(text);
        if (!m) continue;
        const rawName = trimToName(m[1] || '');
        const email   = (m[2] || '').trim().toLowerCase();
        if (!rawName || !email) continue;
        // Basic address sanity — the regex already constrains shape, this is
        // just a belt-and-braces length/format guard.
        if (email.length > 100 || !/^[\w.+-]+@[\w-]+\.[a-z]{2,}$/i.test(email)) continue;

        const key = contactKey(rawName);
        if (seen.has(key)) continue;
        seen.add(key);
        found.push({ key, value: email, displayName: rawName });
    }

    return found;
}

module.exports = { autoExtractFacts, extractContacts, contactKey };
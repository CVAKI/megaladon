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
];

// Guard against saving obvious junk (URLs, code, very long matches, etc.)
function isSane(value) {
    if (!value) return false;
    const v = value.trim();
    if (v.length < 2 || v.length > 60) return false;
    if (/https?:\/\//i.test(v)) return false;
    if (/[{}<>@#$%^*]/.test(v)) return false;
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
const TRIM_KEYS = new Set(['user_name']);

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
    return found;
}

module.exports = { autoExtractFacts };
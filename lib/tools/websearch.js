'use strict';

// ─── lib/tools/websearch.js ───────────────────────────────────────────────────
// Pluggable web search + page-content fetching.
//
// Workflow this file supports (used by lib/main/aiHandler.js):
//   1. webSearch(query)      → list of {title, url, snippet}
//   2. deepSearch(query)     → same, PLUS fetches the actual page text for the
//                              top N results, so the AI reads real content
//                              instead of guessing from a one-line snippet.
//   3. formatResultsForModel → turns that into a plain-text block fed to the AI
//   4. formatResultsForTerminal → turns just the links into clickable OSC-8
//                              hyperlinks for the terminal display
//
// Provider is chosen via ~/.meg/config.json → searchProvider (default 'ddgo').
// Switch in-app with:  /searchengine ddgo   or   /searchengine edge
//
// ─── Content safety ──────────────────────────────────────────────────────────
// isUnsafeQuery() is checked INSIDE webSearch() itself — the single choke
// point every caller routes through (the AI's own @@SEARCH: directive, the
// deterministic search fallback, and the manual /search command all end up
// calling webSearch()). That means the filter can't be bypassed by adding a
// new call site later; there is exactly one place that decides whether a
// query runs. This is a basic keyword/pattern filter, not a full moderation
// system — it catches obvious illegal/sexual-content requests, not everything.

const https = require('https');
const http  = require('http');
const { loadConfig } = require('../config');

function getProvider() {
    const cfg = loadConfig();
    return cfg.searchProvider || 'ddgo';
}

// ── Content safety filter ────────────────────────────────────────────────────
const UNSAFE_PATTERNS = [
    // Child sexual abuse material — any phrasing combining minors + sexual content
    /\bchild(ren)?\b.{0,25}\b(porn|sex|nude|naked)\b/i,
    /\b(porn|sex|nude|naked)\b.{0,25}\bchild(ren)?\b/i,
    /\b(loli|shota)\b/i,
    // Weapons / explosives instructions
    /\bhow to (make|build) (a )?(bomb|explosive)\b/i,
    // Illegal purchase facilitation
    /\bbuy (illegal )?(drugs|weapons|guns) online\b/i,
    // Account/device intrusion
    /\bhack (into|someone'?s) (account|phone|email|instagram|facebook)\b/i,
    // Non-consensual intimate imagery
    /\b(leaked|stolen) nudes?\b/i,
];

function isUnsafeQuery(query) {
    const q = (query || '').toLowerCase();
    return UNSAFE_PATTERNS.some(re => re.test(q));
}

function httpGetText(url, headers) {
    return new Promise((resolve, reject) => {
        const req = https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0 (Megaladon)', ...headers } }, res => {
            // Follow one redirect (DDG sometimes 302s)
            if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                return resolve(httpGetText(res.headers.location, headers));
            }
            let data = '';
            res.on('data', c => data += c);
            res.on('end', () => resolve(data));
        });
        req.on('error', reject);
        req.setTimeout(10000, () => { req.destroy(new Error('search request timed out')); });
    });
}

function decodeEntities(s) {
    return s
        .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&#x27;/g, "'")
        .replace(/&nbsp;/g, ' ');
}
function stripTags(s) { return decodeEntities(s.replace(/<[^>]*>/g, '')).trim(); }

// Extract DDG's redirect-wrapped href: /l/?uddg=<encoded real url>&...
function unwrapDdgUrl(href) {
    const m = href.match(/uddg=([^&]+)/);
    if (m) { try { return decodeURIComponent(m[1]); } catch (_) { return href; } }
    return href.startsWith('//') ? 'https:' + href : href;
}

async function searchDDG(query, max = 5) {
    const url  = 'https://html.duckduckgo.com/html/?q=' + encodeURIComponent(query);
    const html = await httpGetText(url);

    const results = [];
    const blockRe = /<a rel="nofollow" class="result__a" href="([^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?<a class="result__snippet"[^>]*>([\s\S]*?)<\/a>/g;
    let m;
    while ((m = blockRe.exec(html)) !== null && results.length < max) {
        const url_    = unwrapDdgUrl(decodeEntities(m[1]));
        const title   = stripTags(m[2]);
        const snippet = stripTags(m[3]);
        if (title && url_) results.push({ title, url: url_, snippet });
    }

    // Fallback: looser pattern if DDG changes markup and the strict one finds nothing
    if (!results.length) {
        const linkRe = /<a[^>]+class="result__a"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g;
        while ((m = linkRe.exec(html)) !== null && results.length < max) {
            results.push({ title: stripTags(m[2]), url: unwrapDdgUrl(decodeEntities(m[1])), snippet: '' });
        }
    }
    return results;
}

async function searchEdge(query, max = 5) {
    // Placeholder for a future Playwright-driven Edge browser provider.
    // Kept as a distinct function so wiring it up later is a one-function swap.
    return {
        error: true,
        message: 'Edge browser search provider is not implemented yet. Switch back with: /searchengine ddgo',
    };
}

/**
 * @param {string} query
 * @param {number} max
 * @returns {Promise<{provider:string, results:Array<{title,url,snippet}>} | {error:true,message:string}>}
 */
async function webSearch(query, max = 5) {
    if (isUnsafeQuery(query)) {
        return {
            error: true,
            message: 'This search was blocked — it looks like it may involve illegal or sexual content. Megaladon does not run searches like this.',
        };
    }

    const provider = getProvider();
    try {
        if (provider === 'edge') {
            const r = await searchEdge(query, max);
            if (r.error) return r;
            return { provider, results: r };
        }
        const results = await searchDDG(query, max);
        return { provider: 'ddgo', results };
    } catch (e) {
        return { error: true, message: 'Search failed: ' + e.message };
    }
}

// ─── fetchPageText ────────────────────────────────────────────────────────────
// Fetches a single URL and returns cleaned, readable plain text (scripts,
// styles, and tags stripped). Follows a few redirects. Has a hard timeout and
// a hard byte cap so one slow/huge page can't stall the whole search.
// Returns null (never throws) on any failure — callers just skip that source.
function fetchPageText(url, maxChars = 2500, timeoutMs = 6000, redirectsLeft = 3) {
    return new Promise((resolve) => {
        let settled = false;
        const done = (val) => { if (!settled) { settled = true; resolve(val); } };

        let parsed;
        try { parsed = new URL(url); } catch (_) { return done(null); }
        const lib = parsed.protocol === 'http:' ? http : https;

        const req = lib.get(url, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Megaladon/1.0',
                'Accept': 'text/html,application/xhtml+xml',
                // Ask for uncompressed body — avoids needing a gzip/deflate decoder
                'Accept-Encoding': 'identity',
            },
        }, (res) => {
            // Follow redirects manually (max 3 hops)
            if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && redirectsLeft > 0) {
                res.resume();
                const nextUrl = new URL(res.headers.location, url).toString();
                fetchPageText(nextUrl, maxChars, timeoutMs, redirectsLeft - 1).then(done);
                return;
            }

            const contentType = res.headers['content-type'] || '';
            if (res.statusCode >= 400 || (!contentType.includes('text/html') && !contentType.includes('text/plain') && contentType !== '')) {
                res.resume();
                return done(null);
            }

            let raw = '';
            let bytes = 0;
            const HARD_CAP = 400_000; // stop reading after ~400KB of raw HTML
            res.on('data', (chunk) => {
                bytes += chunk.length;
                raw += chunk.toString('utf8');
                if (bytes >= HARD_CAP) { res.destroy(); }
            });
            res.on('end', () => {
                try {
                    let text = raw
                        .replace(/<script[\s\S]*?<\/script>/gi, ' ')
                        .replace(/<style[\s\S]*?<\/style>/gi, ' ')
                        .replace(/<!--[\s\S]*?-->/g, ' ')
                        .replace(/<(nav|header|footer|form|noscript)[\s\S]*?<\/\1>/gi, ' ')
                        .replace(/<[^>]+>/g, ' ');
                    text = decodeEntities(text).replace(/\s+/g, ' ').trim();
                    done(text.slice(0, maxChars) || null);
                } catch (_) { done(null); }
            });
            res.on('error', () => done(null));
        });

        req.on('error', () => done(null));
        req.setTimeout(timeoutMs, () => { req.destroy(); done(null); });
    });
}

/**
 * deepSearch — search, then fetch the actual page content of the top N
 * results so the AI reads real content instead of a one-line snippet.
 *
 * @param {string} query
 * @param {object} opts
 * @param {number} opts.max        total search results to retrieve (default 5)
 * @param {number} opts.fetchTop   how many of those to actually fetch content for (default 3)
 * @param {number} opts.perPageChars max characters kept per fetched page (default 2200)
 */
async function deepSearch(query, opts = {}) {
    const { max = 5, fetchTop = 3, perPageChars = 2200 } = opts;
    const searchResult = await webSearch(query, max); // safety filter applied inside webSearch()
    if (searchResult.error || !searchResult.results?.length) return searchResult;

    const results = searchResult.results.map((r) => ({ ...r, content: null, fetched: false }));

    // Fetch top N pages in parallel (bounded), each with its own timeout —
    // one slow site never blocks the others.
    const toFetch = results.slice(0, fetchTop);
    await Promise.all(toFetch.map(async (r) => {
        const text = await fetchPageText(r.url, perPageChars);
        r.content = text;
        r.fetched = !!text;
    }));

    return { provider: searchResult.provider, results };
}

// ── Plain-text formatter — fed INTO the AI's context ────────────────────────
// No ANSI/OSC escape codes here. Includes full fetched page content when
// available (from deepSearch), falling back to the snippet when a page
// couldn't be fetched (paywall, timeout, blocked, non-HTML, etc.).
function formatResultsForModel(query, searchResult) {
    if (searchResult.error) return `Search for "${query}" failed: ${searchResult.message}`;
    if (!searchResult.results.length) return `Search for "${query}" returned no results.`;
    const lines = [`Web search results for "${query}" (via ${searchResult.provider}):`, ''];
    searchResult.results.forEach((r, i) => {
        lines.push(`Source ${i + 1}: ${r.title}`);
        lines.push(`URL: ${r.url}`);
        if (r.content) {
            lines.push(`Page content:\n${r.content}`);
        } else if (r.snippet) {
            lines.push(`Snippet (full page could not be fetched): ${r.snippet}`);
        } else {
            lines.push(`(no content available for this source)`);
        }
        lines.push('');
    });
    lines.push('Using the sources above, write a direct, accurate answer in your own words. Cite which source(s) you used if relevant.');
    return lines.join('\n');
}

// ── Terminal formatter — what actually gets printed to the screen ───────────
// Wraps each result's URL in an OSC 8 hyperlink escape so terminals that
// support it (Windows Terminal, iTerm2, most modern ones) render "🔗 source"
// in blue/underlined and clicking it opens the real URL. Terminals without
// OSC 8 support just ignore the escape codes and show the link text plainly.
function formatResultsForTerminal(query, searchResult) {
    const { C } = require('../colors');
    if (searchResult.error) return `Search for "${query}" failed: ${searchResult.message}`;
    if (!searchResult.results.length) return `Search for "${query}" returned no results.`;
    const lines = [`Web search results for "${query}" (via ${searchResult.provider}):`];
    searchResult.results.forEach((r, i) => {
        const link = '\x1b]8;;' + r.url + '\x07' + C.whale + C.bold + '🔗 source' + C.reset + '\x1b]8;;\x07';
        const fetchedTag = r.fetched ? C.kelp + ' (page fetched)' + C.reset : '';
        lines.push(`${i + 1}. ${r.title}  ${link}${fetchedTag}${r.snippet ? '\n   ' + r.snippet : ''}`);
    });
    return lines.join('\n');
}

module.exports = {
    webSearch, deepSearch, fetchPageText,
    getProvider, isUnsafeQuery,
    formatResultsForModel, formatResultsForTerminal,
};
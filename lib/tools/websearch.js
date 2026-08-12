'use strict';

// ─── lib/tools/websearch.js ───────────────────────────────────────────────────
// Pluggable web search + page-content fetching.
//
// Provider chain: DDG html-post → DDG lite-post → Bing (fallback).
// Both DDG endpoints were confirmed redirecting every request to the DDG
// homepage regardless of GET/POST/UA on this network — that's network-level
// interference (ISP/router/AV), not something fixable from inside Node.
// Bing is a different domain entirely and unaffected by that redirect.

const https = require('https');
const http  = require('http');
const { loadConfig } = require('../config');

function getProvider() {
    const cfg = loadConfig();
    return cfg.searchProvider || 'ddgo';
}

// ── Tier 1: severe / always-illegal content ─────────────────────────────────
const SEVERE_PATTERNS = [
    /\bchild(ren)?\b.{0,25}\b(porn|sex|nude|naked)\b/i,
    /\b(porn|sex|nude|naked)\b.{0,25}\bchild(ren)?\b/i,
    /\b(loli|shota)\b/i,
    /\b(teen|barely legal|jailbait)\b.{0,25}\b(porn|sex|nude|naked|xxx)\b/i,
    /\bhow to (make|build) (a )?(bomb|explosive)\b/i,
    /\bbuy (illegal )?(drugs|weapons|guns) online\b/i,
    /\bhack (into|someone'?s) (account|phone|email|instagram|facebook)\b/i,
    /\b(leaked|stolen) nudes?\b/i,
    /\brevenge porn\b/i,
];

// ── Tier 2: general explicit / adult content — blocked regardless of legality ─
const ADULT_PATTERNS = [
    /\b(porn|pornographic|pornhub|xxx|xnxx|xvideos)\b/i,
    /\b(nude|naked)\s+(pic|pics|picture|pictures|photo|photos|image|images)\b/i,
    /\b(sex|fuck(ing)?|anal|blowjob|handjob|deepthroat|creampie|cumshot)\b.{0,20}\b(pic|pics|picture|pictures|photo|photos|image|images|video|videos|gif|gifs)\b/i,
    /\b(pic|pics|picture|pictures|photo|photos|image|images|video|videos|gif|gifs)\b.{0,20}\b(sex|fuck(ing)?|anal|blowjob|handjob|deepthroat|cumshot)\b/i,
    /\b(hentai|rule ?34|nsfw)\b/i,
    /\bescort(s)?\b.{0,15}\b(near me|service|hire|book)\b/i,
    /\bcam ?girls?\b/i,
    /\bonlyfans\b.{0,15}\b(leak|leaked|free)\b/i,
];

function isUnsafeQuery(query) {
    const q = (query || '').toLowerCase();
    return SEVERE_PATTERNS.some(re => re.test(q)) || ADULT_PATTERNS.some(re => re.test(q));
}

const BROWSER_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

function httpGetText(url, headers) {
    return new Promise((resolve, reject) => {
        const req = https.get(url, {
            headers: {
                'User-Agent': BROWSER_UA,
                'Accept-Language': 'en-US,en;q=0.9',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                ...headers,
            },
        }, res => {
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

function httpPostText(url, bodyStr, headers) {
    return new Promise((resolve, reject) => {
        const parsed = new URL(url);
        const data = Buffer.from(bodyStr, 'utf8');
        const req = https.request({
            hostname: parsed.hostname,
            path: parsed.pathname + parsed.search,
            method: 'POST',
            headers: {
                'User-Agent': BROWSER_UA,
                'Accept-Language': 'en-US,en;q=0.9',
                'Content-Type': 'application/x-www-form-urlencoded',
                'Content-Length': data.length,
                ...headers,
            },
        }, res => {
            if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                return resolve(httpGetText(res.headers.location, headers));
            }
            let out = '';
            res.on('data', c => out += c);
            res.on('end', () => resolve(out));
        });
        req.on('error', reject);
        req.setTimeout(10000, () => req.destroy(new Error('search request timed out')));
        req.write(data);
        req.end();
    });
}

function decodeEntities(s) {
    return s
        .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&#x27;/g, "'")
        .replace(/&nbsp;/g, ' ');
}
function stripTags(s) { return decodeEntities(s.replace(/<[^>]*>/g, '')).trim(); }

function unwrapDdgUrl(href) {
    const m = href.match(/uddg=([^&]+)/);
    if (m) { try { return decodeURIComponent(m[1]); } catch (_) { return href; } }
    return href.startsWith('//') ? 'https:' + href : href;
}

function parseHtmlEndpoint(html, max) {
    const results = [];
    const blockRe = /<a rel="nofollow" class="result__a" href="([^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?<a class="result__snippet"[^>]*>([\s\S]*?)<\/a>/g;
    let m;
    while ((m = blockRe.exec(html)) !== null && results.length < max) {
        const url_    = unwrapDdgUrl(decodeEntities(m[1]));
        const title   = stripTags(m[2]);
        const snippet = stripTags(m[3]);
        if (title && url_) results.push({ title, url: url_, snippet });
    }
    if (!results.length) {
        const linkRe = /<a[^>]+class="result__a"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g;
        while ((m = linkRe.exec(html)) !== null && results.length < max) {
            results.push({ title: stripTags(m[2]), url: unwrapDdgUrl(decodeEntities(m[1])), snippet: '' });
        }
    }
    return results;
}

function parseLiteEndpoint(html, max) {
    const rows = html.split(/<tr[^>]*>/i).slice(1);
    const results = [];
    let pending = null;

    for (const rawRow of rows) {
        const row = rawRow.split(/<\/tr>/i)[0];
        const linkM = row.match(/<a[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i);

        if (linkM) {
            const href = decodeEntities(linkM[1]);
            if (/duckduckgo\.com/i.test(href) || href.startsWith('/') || !href.startsWith('http')) continue;
            const title = stripTags(linkM[2]);
            if (!title) continue;
            if (pending) results.push(pending);
            pending = { title, url: href, snippet: '' };
            if (results.length >= max) break;
            continue;
        }

        if (pending && !pending.snippet) {
            const text = stripTags(row);
            if (text && text.length > 3 && !/^\d+\.\s*$/.test(text)) {
                pending.snippet = text;
            }
        }
    }
    if (pending) results.push(pending);
    return results.slice(0, max);
}

// ── Bing HTML results parser ────────────────────────────────────────────────
// FIX: was matching the LI's class attribute as the exact literal string
// `class="b_algo"`. Bing frequently renders it with extra classes tacked on
// (e.g. `class="b_algo b_topborder"`, or with a data-attribute inserted
// before class, or classes in a different order) depending on the page
// variant/experiment bucket you land in. An exact-string match against that
// meant a completely normal, content-ful Bing results page (confirmed by the
// logged HTML snippet showing a real <title>, not a captcha/consent wall)
// parsed as zero results every time the class attribute didn't match
// character-for-character.
//
// Fixed by:
//   1. Matching `<li ... class="...b_algo...">` with a word-boundary check
//      inside the class attribute instead of requiring class="b_algo" verbatim
//      — so extra classes before/after b_algo, or in any order, still match.
//   2. Capturing the LI body once, then pulling title/link/snippet out of
//      that body independently (rather than one long chained regex spanning
//      <li>...<h2>...<p>...</li>), so unrelated markup shifts inside the card
//      (wrapper divs, reordered elements, etc.) don't break the whole match.
function parseBing(html, max) {
    const results = [];
    const liRe = /<li[^>]*\bclass="[^"]*\bb_algo\b[^"]*"[^>]*>([\s\S]*?)<\/li>/g;
    let m;
    while ((m = liRe.exec(html)) !== null && results.length < max) {
        const block = m[1];
        const linkM = block.match(/<h2[^>]*>[\s\S]*?<a[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/);
        if (!linkM) continue;
        const url_    = decodeEntities(linkM[1]);
        const title   = stripTags(linkM[2]);
        const snipM   = block.match(/<p[^>]*>([\s\S]*?)<\/p>/);
        const snippet = snipM ? stripTags(snipM[1]) : '';
        if (title && url_ && url_.startsWith('http')) results.push({ title, url: url_, snippet });
    }
    return results;
}

async function searchBing(query, max) {
    const html = await httpGetText('https://www.bing.com/search?q=' + encodeURIComponent(query) + '&count=' + max);
    const results = parseBing(html, max);
    if (!results.length) {
        console.log('  [websearch] Bing also returned 0 results for "' + query + '". HTML snippet: ' +
            html.slice(0, 300).replace(/\s+/g, ' '));
    }
    return results;
}

async function searchDDG(query, max = 5) {
    const htmlBody = await httpPostText(
        'https://html.duckduckgo.com/html/',
        'q=' + encodeURIComponent(query),
    );
    let results = parseHtmlEndpoint(htmlBody, max);
    let sourceUsed = 'ddg-html';

    if (!results.length) {
        try {
            const liteBody = await httpPostText(
                'https://lite.duckduckgo.com/lite/',
                'q=' + encodeURIComponent(query),
            );
            results = parseLiteEndpoint(liteBody, max);
            sourceUsed = 'ddg-lite';
        } catch (e) {
            console.log('  [websearch] DDG lite fallback failed: ' + e.message);
        }
    }

    if (!results.length) {
        try {
            results = await searchBing(query, max);
            sourceUsed = 'bing';
        } catch (e) {
            console.log('  [websearch] Bing fallback failed: ' + e.message);
        }
    }

    if (!results.length) {
        console.log('  [websearch] All providers (ddg-html, ddg-lite, bing) returned 0 results for "' + query + '".');
    } else if (sourceUsed !== 'ddg-html') {
        console.log('  [websearch] Used fallback provider: ' + sourceUsed);
    }

    return results.filter(r => {
        const combined = (r.title + ' ' + r.snippet + ' ' + r.url).toLowerCase();
        return !ADULT_PATTERNS.some(re => re.test(combined)) && !SEVERE_PATTERNS.some(re => re.test(combined));
    });
}

async function searchEdge(query, max = 5) {
    return {
        error: true,
        message: 'Edge browser search provider is not implemented yet. Switch back with: /searchengine ddgo',
    };
}

async function webSearch(query, max = 5) {
    if (isUnsafeQuery(query)) {
        return {
            error: true,
            message: 'This search was blocked — Megaladon does not run searches for explicit/adult content or other unsafe categories.',
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

function fetchPageText(url, maxChars = 2500, timeoutMs = 6000, redirectsLeft = 3) {
    return new Promise((resolve) => {
        let settled = false;
        const done = (val) => { if (!settled) { settled = true; resolve(val); } };

        let parsed;
        try { parsed = new URL(url); } catch (_) { return done(null); }
        const lib = parsed.protocol === 'http:' ? http : https;

        const req = lib.get(url, {
            headers: {
                'User-Agent': BROWSER_UA,
                'Accept': 'text/html,application/xhtml+xml',
                'Accept-Encoding': 'identity',
            },
        }, (res) => {
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
            const HARD_CAP = 400_000;
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

async function deepSearch(query, opts = {}) {
    const { max = 5, fetchTop = 3, perPageChars = 2200 } = opts;
    const searchResult = await webSearch(query, max);
    if (searchResult.error || !searchResult.results?.length) return searchResult;

    const results = searchResult.results.map((r) => ({ ...r, content: null, fetched: false }));

    const toFetch = results.slice(0, fetchTop);
    await Promise.all(toFetch.map(async (r) => {
        const text = await fetchPageText(r.url, perPageChars);
        r.content = text;
        r.fetched = !!text;
    }));

    return { provider: searchResult.provider, results };
}

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
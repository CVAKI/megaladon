'use strict';

// ─── lib/tools/websearch.js ───────────────────────────────────────────────────
// Pluggable web search. Provider is chosen via ~/.meg/config.json → searchProvider
// (default 'ddgo'). Switch it in-app with:  /searchengine ddgo   or   /searchengine edge
//
// 'ddgo'  — DuckDuckGo HTML results, no API key, works today.
// 'edge'  — reserved for a future Edge-browser automation provider (Playwright).
//           Currently returns a clear "not implemented yet" result instead of crashing.

const https = require('https');
const { loadConfig } = require('../config');

function getProvider() {
    const cfg = loadConfig();
    return cfg.searchProvider || 'ddgo';
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
        .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&#x27;/g, "'");
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

function formatResultsForModel(query, searchResult) {
    if (searchResult.error) return `Search for "${query}" failed: ${searchResult.message}`;
    if (!searchResult.results.length) return `Search for "${query}" returned no results.`;
    const lines = [`Web search results for "${query}" (via ${searchResult.provider}):`];
    searchResult.results.forEach((r, i) => {
        lines.push(`${i + 1}. ${r.title}\n   ${r.url}${r.snippet ? '\n   ' + r.snippet : ''}`);
    });
    return lines.join('\n');
}

module.exports = { webSearch, getProvider, formatResultsForModel };
'use strict';

const { execSync } = require('child_process');
const path = require('path');
const { ab, cr, dg, kp, rf, sd, vt, C } = require('../../colors');
const { loadConfig, saveConfig }        = require('../../config');
const { formatMD }                      = require('../../render');
const { webSearch, formatResultsForModel, formatResultsForTerminal } = require('../../tools/websearch');
const { saveEmailConfig, listInbox, readEmailBody, sendEmail, formatInboxForModel, resetEmailConfig, getEmailStatus } = require('../../tools/email');
// FIX: /search used to be a pure "print raw results" command — it never
// touched the model at all (see the old handleSearch below for the previous
// behaviour). That's inconsistent with the @@SEARCH: directive path in
// aiHandler/handleAiMessage.js, which DOES feed results back to the model
// with "answer the original question using this data" and shows a real
// summarized answer. A person typing /search reasonably expects the same
// "the assistant read this and answered me" behaviour, not a bare link dump.
// callProvider is what handleAiMessage.js itself uses for that follow-up
// call, so reuse it here rather than duplicating provider-call logic.
const { callProvider }                  = require('../aiHandler/provider');

// This file lives at lib/main/command/tools.js — three levels below the
// Megaladon install root. Used so npm installs for missing tool packages
// (imap-simple, mailparser, nodemailer, ...) land where email.js/websearch.js
// can actually find them, instead of wherever the user's shell happens to be
// cd'd into (see withAutoInstall below for why this matters).
const MEGALADON_ROOT = path.resolve(__dirname, '../../..');

// ─── Generic "run a tool, auto-install on missing module, retry once" wrapper ─
// Same helper as lib/main/aiHandler.js — kept as a small local copy since this
// is a separate module. Covers /email inbox|read|send when a required package
// (imap-simple, mailparser, nodemailer) isn't installed yet.
function extractMissingModule(errText) {
    const m = /Cannot find module '([^'.][^']*)'/.exec(errText || '');
    if (!m) return null;
    const name = m[1];
    return name.startsWith('@') ? name.split('/').slice(0, 2).join('/') : name.split('/')[0];
}

async function withAutoInstall(fn, ...args) {
    try {
        return await fn(...args);
    } catch (err) {
        const missing = extractMissingModule(err.message || String(err));
        if (!missing) throw err;
        console.log('\n  ' + ab('⬇ missing package "' + missing + '" — installing...'));
        try {
            // FIX: was `cwd: process.cwd()` — the user's CURRENT terminal
            // directory (e.g. Desktop\meg-pic), which is almost never where
            // Megaladon itself lives. npm would install into
            // <user's cwd>\node_modules, but email.js's `require('imap-simple')`
            // resolves relative to email.js's own location (Megaladon's
            // install root), so it would never find a package installed into
            // some unrelated folder the user happened to be cd'd into. That's
            // why "installed successfully" was immediately followed by the
            // exact same "Cannot find module" error every time. Install into
            // Megaladon's own root instead, regardless of the user's cwd.
            execSync('npm install ' + missing + ' --save', { cwd: MEGALADON_ROOT, stdio: 'ignore', timeout: 60000 });
            console.log('  ' + kp('✔ installed ' + missing + ' — retrying...'));
        } catch (installErr) {
            throw new Error('Missing module "' + missing + '" and auto-install failed: ' + installErr.message);
        }
        try { delete require.cache[require.resolve(missing)]; } catch (_) {}
        return await fn(...args);
    }
}

// ─── /searchengine [ddgo|edge] ─────────────────────────────────────────────────
async function handleSearchEngine(text, ctx) {
    const arg = text.slice('/searchengine'.length).trim().toLowerCase();
    const cfg = loadConfig();

    if (!arg) {
        console.log('\n  ' + vt('Current search provider: ') + sd(cfg.searchProvider || 'ddgo'));
        console.log('  ' + ab('Usage: /searchengine ddgo   or   /searchengine edge'));
        ctx.prompt(); return true;
    }
    if (!['ddgo', 'edge'].includes(arg)) {
        console.log('\n  ' + dg('Unknown provider. Options: ddgo, edge'));
        ctx.prompt(); return true;
    }
    cfg.searchProvider = arg;
    saveConfig(cfg);
    console.log('\n  ' + kp('✔ Search provider set to: ') + sd(arg) +
        (arg === 'edge' ? ab('  (not implemented yet — falls back to an error message)') : ''));
    ctx.prompt(); return true;
}

// ─── /search <query> — one-off search, now summarized by the model ────────────
// FIX: previously printed raw formatResultsForTerminal() output only — no
// model involved at all, unlike the AI's own @@SEARCH: directive path in
// handleAiMessage.js which reads the results and answers the question. Now
// this does the same: fetch results, hand them to the model with the exact
// same "answer using this data" framing handleAiMessage.js uses, print the
// model's actual answer, THEN the clickable source links below it (so the
// person still gets to click through, they just also get a real answer
// instead of having to read 5 snippets and synthesize it themselves).
//
// Content-safety filtering happens inside webSearch() itself
// (lib/tools/websearch.js), so it applies here automatically — no separate
// check needed in this handler.
async function handleSearch(text, ctx) {
    const query = text.slice('/search'.length).trim();
    if (!query) { console.log('\n  ' + dg('Usage: /search <query>')); ctx.prompt(); return true; }
    console.log('\n  ' + ab('⟳ searching...'));
    const result = await webSearch(query, 5);

    if (result.error || !result.results?.length) {
        console.log('\n' + formatResultsForTerminal(query, result) + '\n');
        ctx.prompt(); return true;
    }

    console.log('  ' + ab('⟳ reading results...'));
    let summary = '';
    try {
        summary = await callProvider(ctx, [
            {
                role: 'system',
                content: 'You are a concise research assistant. Answer the question directly ' +
                    'and accurately using ONLY the search results you are given below — do not ' +
                    'add outside knowledge or invent anything not present in them. If the results ' +
                    'do not actually answer the question, say so plainly instead of guessing.',
            },
            { role: 'user', content: formatResultsForModel(query, result) },
        ]);
    } catch (e) {
        // Model call failed (provider down, no API key, etc.) — don't lose
        // the search itself, just fall back to the old raw-list behaviour.
        console.log('\n  ' + dg('⚠ Could not summarise (' + e.message + ') — showing raw results instead.'));
        console.log('\n' + formatResultsForTerminal(query, result) + '\n');
        ctx.prompt(); return true;
    }

    console.log('\n' + formatMD(summary.trim()));

    console.log('\n  ' + ab('Sources:'));
    result.results.forEach((r, i) => {
        const link = '\x1b]8;;' + r.url + '\x07' + C.whale + C.bold + '🔗 ' + r.title + C.reset + '\x1b]8;;\x07';
        console.log('  ' + ab(String(i + 1) + '. ') + link);
    });
    console.log('');

    ctx.prompt(); return true;
}

// ─── Email auto-setup (Outlook-style) ──────────────────────────────────────────
// If /email inbox|read|send is run before /email setup has ever been done,
// don't just error out — walk the person through setup right there, then
// automatically retry the original action once setup succeeds. This mirrors
// what Outlook/Mail apps do: the first real action IS the setup prompt.
//
// Detection is done by matching common "not configured yet" style errors that
// lib/tools/email.js throws (missing user/pass, no account, ENOTFOUND on a
// blank host, auth failure on empty credentials, etc.) rather than depending
// on knowing that file's internal storage format — this way the fallback
// works correctly even if email.js's config shape changes later.
const NOT_CONFIGURED_RE = /(not configured|no account|no email|missing (user|credentials|password)|set ?up.*first|invalid credentials|auth(entication)? failed|ENOTFOUND|getaddrinfo)/i;

async function runEmailSetup(ctx) {
    console.log('\n  ' + vt(C.bold + '📧 Email setup') + ab(' — Gmail App Password required (not your normal password)'));
    console.log('  ' + ab('Create one at: myaccount.google.com/apppasswords') + '\n');
    const user = (await ctx.ask('  ' + cr('❯ Gmail address: '))).trim();
    const pass = (await ctx.ask('  ' + cr('❯ App password (16 chars, spaces ok): '))).trim().replace(/\s+/g, '');
    if (!user || !pass) {
        console.log('\n  ' + dg('✘ Both fields required.'));
        return false;
    }
    saveEmailConfig(user, pass);
    console.log('\n  ' + kp('✔ Email configured for: ') + sd(user));
    return true;
}

// Runs fn(...args); if it fails looking like "email isn't set up yet", prompts
// setup inline and retries fn once. Any other kind of error (missing module,
// network issue after real credentials exist, etc.) is rethrown untouched so
// withAutoInstall / the caller's own catch still handles it normally.
async function withEmailAutoSetup(ctx, fn, ...args) {
    try {
        return await fn(...args);
    } catch (err) {
        const msg = err?.message || String(err);
        if (!NOT_CONFIGURED_RE.test(msg)) throw err;

        console.log('\n  ' + ab('⚠ Email isn\'t set up yet — let\'s connect an account first.'));
        const ok = await runEmailSetup(ctx);
        if (!ok) throw err; // user aborted setup — surface the original error

        console.log('\n  ' + ab('⟳ retrying...'));
        return await fn(...args);
    }
}

// ─── /email ... ────────────────────────────────────────────────────────────────
async function handleEmail(text, ctx) {
    const rest = text.slice('/email'.length).trim();
    const [sub, ...restArgs] = rest.split(/\s+/);

    // /email setup
    if (sub === 'setup') {
        await runEmailSetup(ctx);
        ctx.prompt(); return true;
    }

    // /email reset — disconnect the current account so /email setup can be
    // run again from a clean slate (switching accounts, rotating an app
    // password, or fixing a botched setup).
    if (sub === 'reset') {
        const { wasConfigured } = resetEmailConfig();
        console.log('\n  ' + (wasConfigured
            ? kp('✔ Email config cleared.')
            : ab('No email was configured.')) + '  Run /email setup to reconnect.');
        ctx.prompt(); return true;
    }

    // /email status — read-only check, confirms setup persisted without
    // exposing the app password.
    if (sub === 'status') {
        const st = getEmailStatus();
        if (st.configured) console.log('\n  ' + kp('✔ Configured: ') + sd(st.user) + ab('  (' + st.provider + ')'));
        else                console.log('\n  ' + ab('No email configured yet. Run /email setup.'));
        ctx.prompt(); return true;
    }

    // /email inbox [n]
    if (sub === 'inbox') {
        const n = parseInt(restArgs[0], 10) || 10;
        console.log('\n  ' + ab('⟳ fetching inbox...'));
        try {
            const items = await withEmailAutoSetup(ctx, () => withAutoInstall(listInbox, { limit: n }));
            console.log('\n' + formatInboxForModel(items) + '\n');
        } catch (e) { console.log('\n  ' + dg('✘ ' + e.message)); }
        ctx.prompt(); return true;
    }

    // /email read <uid>
    if (sub === 'read') {
        const uid = restArgs[0];
        if (!uid) { console.log('\n  ' + dg('Usage: /email read <uid>')); ctx.prompt(); return true; }
        console.log('\n  ' + ab('⟳ fetching message...'));
        try {
            const m = await withEmailAutoSetup(ctx, () => withAutoInstall(readEmailBody, uid));
            console.log('\n  ' + vt('From: ') + sd(m.from));
            console.log('  ' + vt('Subject: ') + sd(m.subject));
            console.log('  ' + vt('Date: ') + sd(m.date));
            console.log('\n' + m.text + '\n');
        } catch (e) { console.log('\n  ' + dg('✘ ' + e.message)); }
        ctx.prompt(); return true;
    }

    // /email send <to> | <subject> | <body>   (manual, bypasses AI — still asks to confirm)
    if (sub === 'send') {
        const raw = restArgs.join(' ');
        const [to, subject, ...bodyParts] = raw.split('|').map(s => s.trim());
        if (!to || !subject) {
            console.log('\n  ' + dg('Usage: /email send <to> | <subject> | <body>'));
            ctx.prompt(); return true;
        }
        const body = bodyParts.join('|').trim();
        console.log('\n  ' + vt('Preview:'));
        console.log('  ' + ab('To: ')      + sd(to));
        console.log('  ' + ab('Subject: ') + sd(subject));
        console.log('  ' + ab('Body: ')    + sd(body || '(empty)'));
        const confirm = (await ctx.ask('\n  ' + cr('❯ Send this email? [y/N]: '))).trim().toLowerCase();
        if (confirm !== 'y' && confirm !== 'yes') {
            console.log('\n  ' + ab('Cancelled.'));
            ctx.prompt(); return true;
        }
        try {
            await withEmailAutoSetup(ctx, () => withAutoInstall(sendEmail, { to, subject, body }));
            console.log('\n  ' + kp('✔ Email sent to ') + sd(to));
        } catch (e) { console.log('\n  ' + dg('✘ ' + e.message)); }
        ctx.prompt(); return true;
    }

    console.log('\n  ' + vt(C.bold + '/email commands'));
    console.log('  ' + ab('  /email setup            ') + sd('connect a Gmail account (App Password)'));
    console.log('  ' + ab('  /email status           ') + sd('show whether email is configured'));
    console.log('  ' + ab('  /email reset            ') + sd('disconnect the current account'));
    console.log('  ' + ab('  /email inbox [n]        ') + sd('show last n messages (default 10)'));
    console.log('  ' + ab('  /email read <uid>       ') + sd('read full body of one message'));
    console.log('  ' + ab('  /email send to|subj|body') + sd('send an email (asks to confirm)'));
    ctx.prompt(); return true;
}

module.exports = { handleSearchEngine, handleSearch, handleEmail };
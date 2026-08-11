'use strict';

const { execSync } = require('child_process');
const { ab, cr, dg, kp, rf, sd, vt, C } = require('../../colors');
const { loadConfig, saveConfig }        = require('../../config');
const { webSearch, formatResultsForModel, formatResultsForTerminal } = require('../../tools/websearch');
const { saveEmailConfig, listInbox, readEmailBody, sendEmail, formatInboxForModel } = require('../../tools/email');

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
            execSync('npm install ' + missing + ' --save', { cwd: process.cwd(), stdio: 'ignore', timeout: 60000 });
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

// ─── /search <query> — manual one-off search, prints results directly ─────────
// Uses formatResultsForTerminal so sources render as clickable blue "🔗 source"
// links (OSC 8 hyperlinks) instead of plain pasted URLs. Content-safety
// filtering happens inside webSearch() itself (lib/tools/websearch.js), so it
// applies here automatically — no separate check needed in this handler.
async function handleSearch(text, ctx) {
    const query = text.slice('/search'.length).trim();
    if (!query) { console.log('\n  ' + dg('Usage: /search <query>')); ctx.prompt(); return true; }
    console.log('\n  ' + ab('⟳ searching...'));
    const result = await webSearch(query, 5);
    console.log('\n' + formatResultsForTerminal(query, result) + '\n');
    ctx.prompt(); return true;
}

// ─── /email ... ────────────────────────────────────────────────────────────────
async function handleEmail(text, ctx) {
    const rest = text.slice('/email'.length).trim();
    const [sub, ...restArgs] = rest.split(/\s+/);

    // /email setup
    if (sub === 'setup') {
        console.log('\n  ' + vt(C.bold + '📧 Email setup') + ab(' — Gmail App Password required (not your normal password)'));
        console.log('  ' + ab('Create one at: myaccount.google.com/apppasswords') + '\n');
        const user = (await ctx.ask('  ' + cr('❯ Gmail address: '))).trim();
        const pass = (await ctx.ask('  ' + cr('❯ App password (16 chars, spaces ok): '))).trim().replace(/\s+/g, '');
        if (!user || !pass) { console.log('\n  ' + dg('✘ Both fields required.')); ctx.prompt(); return true; }
        saveEmailConfig(user, pass);
        console.log('\n  ' + kp('✔ Email configured for: ') + sd(user));
        ctx.prompt(); return true;
    }

    // /email inbox [n]
    if (sub === 'inbox') {
        const n = parseInt(restArgs[0], 10) || 10;
        console.log('\n  ' + ab('⟳ fetching inbox...'));
        try {
            const items = await withAutoInstall(listInbox, { limit: n });
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
            const m = await withAutoInstall(readEmailBody, uid);
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
            await withAutoInstall(sendEmail, { to, subject, body });
            console.log('\n  ' + kp('✔ Email sent to ') + sd(to));
        } catch (e) { console.log('\n  ' + dg('✘ ' + e.message)); }
        ctx.prompt(); return true;
    }

    console.log('\n  ' + vt(C.bold + '/email commands'));
    console.log('  ' + ab('  /email setup            ') + sd('connect a Gmail account (App Password)'));
    console.log('  ' + ab('  /email inbox [n]        ') + sd('show last n messages (default 10)'));
    console.log('  ' + ab('  /email read <uid>       ') + sd('read full body of one message'));
    console.log('  ' + ab('  /email send to|subj|body') + sd('send an email (asks to confirm)'));
    ctx.prompt(); return true;
}

module.exports = { handleSearchEngine, handleSearch, handleEmail };
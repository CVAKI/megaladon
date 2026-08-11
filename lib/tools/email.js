'use strict';

// ─── lib/tools/email.js ───────────────────────────────────────────────────────
// Reads and sends mail as ONE configured account ("Megaladon's mailbox").
// Auth: App Password (Gmail) or app password / regular password (Outlook) —
// set with /email setup. Stored in ~/.meg/config.json under:
//   cfg.email = { provider, user, appPassword }
//
// Requires (npm install in project root):
//   nodemailer imap-simple mailparser

const { loadConfig, saveConfig } = require('../config');

// ─── Provider table ───────────────────────────────────────────────────────────
// Adding a new IMAP/SMTP provider is a one-entry addition here — nothing else
// in this file needs to know provider-specific hosts.
const IMAP_HOSTS = {
    gmail:   { host: 'imap.gmail.com',          port: 993 },
    outlook: { host: 'outlook.office365.com',   port: 993 },
};

// FIX: was `{ service: 'gmail' }` — nodemailer's "service" shortcut resolves
// smtp.gmail.com via normal DNS, which on some networks (seen here: Windows +
// an ISP/router with broken IPv6 routing) returns an IPv6 address that LOOKS
// reachable but silently refuses the connection (ECONNREFUSED on a
// 2404:6800:... literal). `family: 4` is forwarded straight through to
// Node's underlying net.connect()/tls.connect() and pins the connection to
// IPv4 only, which is what actually works on networks like this. Switched
// off the 'service' shortcut to explicit host/port so `family` is honored —
// some nodemailer versions don't apply extra options when 'service' is set.
const SMTP_CONFIG = {
    gmail:   { host: 'smtp.gmail.com',       port: 465, secure: true,  family: 4 },
    outlook: { host: 'smtp.office365.com',   port: 587, secure: false, requireTLS: true, family: 4 },
};

function getEmailConfig() {
    const cfg = loadConfig();
    return cfg.email || null; // { provider, user, appPassword }
}

function saveEmailConfig(user, appPassword, provider = 'gmail') {
    const cfg = loadConfig();
    cfg.email = { provider: IMAP_HOSTS[provider] ? provider : 'gmail', user, appPassword };
    saveConfig(cfg);
}

// ─── resetEmailConfig ─────────────────────────────────────────────────────────
// Clears the saved email account so /email setup can be run again from a
// clean slate (e.g. switching Gmail accounts, rotating an app password, or
// fixing a botched setup) without leaving stale fields behind.
function resetEmailConfig() {
    const cfg = loadConfig();
    const hadConfig = !!cfg.email;
    delete cfg.email;
    saveConfig(cfg);
    return { wasConfigured: hadConfig };
}

// ─── getEmailStatus ───────────────────────────────────────────────────────────
// Read-only status check — reports WHETHER email is configured and which
// account/provider, without ever exposing the app password. Useful so the
// person can confirm setup persisted across a restart without needing to
// run /email setup again "just to check".
function getEmailStatus() {
    const e = getEmailConfig();
    if (!e || !e.user || !e.appPassword) {
        return { configured: false };
    }
    return {
        configured: true,
        provider: e.provider || 'gmail',
        user: e.user,
    };
}

function requireConfigured() {
    const e = getEmailConfig();
    if (!e || !e.user || !e.appPassword) {
        throw new Error('Email not configured yet. Run /email setup first.');
    }
    if (!e.provider) e.provider = 'gmail'; // back-compat with configs saved before multi-provider support
    return e;
}

// ── Resolve the "from" display name for outgoing mail ──────────────────────
// Uses the user's own name from persistent memory when available (so mail
// goes out as "Siva via @Megaladon <siva@gmail.com>" instead of just the raw
// address), falling back to a generic tag when no name fact is on file yet.
// ctx is optional — callers that don't have ctx handy just get the fallback.
function resolveFromDisplayName(ctx) {
    try {
        const facts = ctx?.mem?.facts;
        const nameFact = Array.isArray(facts)
            ? facts.find(f => f.key === 'user_mail_signature' || f.key === 'user_name')
            : null;
        const name = nameFact?.value;
        return (name ? name + ' ' : '') + 'via @Megaladon';
    } catch (_) {
        return 'via @Megaladon';
    }
}

// ── Send ───────────────────────────────────────────────────────────────────
async function sendEmail({ to, subject, body }, ctx) {
    const nodemailer = require('nodemailer');
    const { user, appPassword, provider } = requireConfigured();

    const smtpBase = SMTP_CONFIG[provider] || SMTP_CONFIG.gmail;
    const transporter = nodemailer.createTransport({
        ...smtpBase,
        auth: { user, pass: appPassword },
    });

    const fromName = resolveFromDisplayName(ctx);

    try {
        const info = await transporter.sendMail({
            from: `"${fromName}" <${user}>`,
            to,
            subject: subject || '(no subject)',
            text: body || '',
        });
        return { ok: true, messageId: info.messageId };
    } catch (err) {
        // ── IPv6 fallback retry ─────────────────────────────────────────────
        // Belt-and-braces: even with family:4 set above, some environments
        // (VPNs, certain proxy setups) can still surface an IPv6-literal
        // ECONNREFUSED. If that happens, retry once against the same host
        // with family forced again via a fresh transporter, so a transient
        // resolver hiccup doesn't fail the whole send outright.
        const looksLikeIPv6Refusal = err.code === 'ECONNREFUSED' && /:.*:.*:/.test(err.address || '');
        if (!looksLikeIPv6Refusal) throw err;

        const retryTransporter = nodemailer.createTransport({
            ...smtpBase,
            family: 4,
            auth: { user, pass: appPassword },
        });
        const info = await retryTransporter.sendMail({
            from: `"${fromName}" <${user}>`,
            to,
            subject: subject || '(no subject)',
            text: body || '',
        });
        return { ok: true, messageId: info.messageId };
    }
}

// ── Read: list recent inbox messages (headers only, fast) ───────────────────
// opts:
//   limit        - max messages to return (default 10)
//   unreadOnly   - only UNSEEN messages
//   subjectFilter- substring match against Subject (case-insensitive)
//   fromFilter   - substring match against From (case-insensitive)
//   since        - Date or 'YYYY-MM-DD' string — only messages on/after this date
async function listInbox({ limit = 10, unreadOnly = false, subjectFilter = '', fromFilter = '', since = null } = {}) {
    const imaps = require('imap-simple');
    const { user, appPassword, provider } = requireConfigured();
    const { host, port } = IMAP_HOSTS[provider] || IMAP_HOSTS.gmail;

    const config = {
        imap: {
            user, password: appPassword,
            host, port, tls: true,
            authTimeout: 10000,
            tlsOptions: { rejectUnauthorized: false },
            // Same IPv6-routing issue can affect IMAP on the same broken
            // networks as SMTP — pin to IPv4 here too for consistency.
            family: 4,
        },
    };

    const connection = await imaps.connect(config);
    try {
        await connection.openBox('INBOX');

        // Build server-side search criteria where possible — cheaper than
        // fetching everything and filtering client-side.
        const criteria = [];
        criteria.push(unreadOnly ? 'UNSEEN' : 'ALL');
        if (since) {
            const d = since instanceof Date ? since : new Date(since);
            if (!isNaN(d.getTime())) {
                // IMAP SINCE wants "DD-Mon-YYYY"
                const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
                const imapDate = String(d.getDate()).padStart(2, '0') + '-' + months[d.getMonth()] + '-' + d.getFullYear();
                criteria.push(['SINCE', imapDate]);
            }
        }
        if (subjectFilter) criteria.push(['SUBJECT', subjectFilter]);
        if (fromFilter)    criteria.push(['FROM', fromFilter]);

        const fetchOptions = { bodies: ['HEADER.FIELDS (FROM SUBJECT DATE)'], struct: true, markSeen: false };
        const messages = await connection.search(criteria, fetchOptions);

        const items = messages
            .slice(-Math.max(limit, 1) * 3) // grab a bit extra before client-side trim, in case server search was loose
            .reverse()
            .map(msg => {
                const header = msg.parts.find(p => p.which.startsWith('HEADER'))?.body || {};
                return {
                    uid:     msg.attributes.uid,
                    from:    (header.from    || [''])[0],
                    subject: (header.subject || ['(no subject)'])[0],
                    date:    (header.date    || [''])[0],
                    seen:    !!msg.attributes.flags?.includes('\\Seen'),
                };
            })
            .slice(0, limit);
        return items;
    } finally {
        connection.end();
    }
}

// ── Read: full body of one message by uid ────────────────────────────────────
async function readEmailBody(uid) {
    const imaps       = require('imap-simple');
    const { simpleParser } = require('mailparser');
    const { user, appPassword, provider } = requireConfigured();
    const { host, port } = IMAP_HOSTS[provider] || IMAP_HOSTS.gmail;

    const config = {
        imap: {
            user, password: appPassword,
            host, port, tls: true,
            authTimeout: 10000,
            tlsOptions: { rejectUnauthorized: false },
            family: 4,
        },
    };

    const connection = await imaps.connect(config);
    try {
        await connection.openBox('INBOX');
        const messages = await connection.search([['UID', String(uid)]], { bodies: [''], struct: true, markSeen: false });
        if (!messages.length) throw new Error('No message found with uid ' + uid);
        const raw = messages[0].parts.find(p => p.which === '')?.body || '';
        const parsed = await simpleParser(raw);
        return {
            from:    parsed.from?.text || '',
            subject: parsed.subject || '(no subject)',
            date:    parsed.date ? parsed.date.toISOString() : '',
            text:    (parsed.text || '').slice(0, 4000),
        };
    } finally {
        connection.end();
    }
}

function formatInboxForModel(items) {
    if (!items.length) return 'Inbox is empty (or no messages matched).';
    return items
        .map(m => `[uid ${m.uid}]${m.seen ? '' : ' (unread)'} From: ${m.from} — Subject: ${m.subject} — ${m.date}`)
        .join('\n');
}

module.exports = {
    IMAP_HOSTS,
    getEmailConfig, saveEmailConfig, requireConfigured,
    resetEmailConfig, getEmailStatus,
    sendEmail, listInbox, readEmailBody, formatInboxForModel,
    resolveFromDisplayName,
};
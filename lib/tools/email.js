'use strict';

// ─── lib/tools/email.js ───────────────────────────────────────────────────────
// Reads and sends mail as ONE configured Gmail account ("Megaladon's mailbox").
// Auth: Gmail App Password (not your normal password) — set with /email setup.
// Stored in ~/.meg/config.json under cfg.email = { user, appPassword }.
//
// Requires (npm install in project root):
//   nodemailer imap-simple mailparser

const { loadConfig, saveConfig } = require('../config');

function getEmailConfig() {
    const cfg = loadConfig();
    return cfg.email || null; // { user, appPassword }
}

function saveEmailConfig(user, appPassword) {
    const cfg = loadConfig();
    cfg.email = { user, appPassword };
    saveConfig(cfg);
}

function requireConfigured() {
    const e = getEmailConfig();
    if (!e || !e.user || !e.appPassword) {
        throw new Error('Email not configured yet. Run /email setup first.');
    }
    return e;
}

// ── Send ───────────────────────────────────────────────────────────────────
async function sendEmail({ to, subject, body }) {
    const nodemailer = require('nodemailer');
    const { user, appPassword } = requireConfigured();

    const transporter = nodemailer.createTransport({
        service: 'gmail',
        auth: { user, pass: appPassword },
    });

    const info = await transporter.sendMail({
        from: user,
        to,
        subject: subject || '(no subject)',
        text: body || '',
    });

    return { ok: true, messageId: info.messageId };
}

// ── Read: list recent inbox messages (headers only, fast) ───────────────────
async function listInbox({ limit = 10, unreadOnly = false } = {}) {
    const imaps = require('imap-simple');
    const { user, appPassword } = requireConfigured();

    const config = {
        imap: {
            user, password: appPassword,
            host: 'imap.gmail.com', port: 993, tls: true,
            authTimeout: 10000,
            tlsOptions: { rejectUnauthorized: false },
        },
    };

    const connection = await imaps.connect(config);
    try {
        await connection.openBox('INBOX');
        const searchCriteria = unreadOnly ? ['UNSEEN'] : ['ALL'];
        const fetchOptions = { bodies: ['HEADER.FIELDS (FROM SUBJECT DATE)'], struct: true, markSeen: false };
        const messages = await connection.search(searchCriteria, fetchOptions);

        const items = messages
            .slice(-limit)
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
            });
        return items;
    } finally {
        connection.end();
    }
}

// ── Read: full body of one message by uid ────────────────────────────────────
async function readEmailBody(uid) {
    const imaps       = require('imap-simple');
    const { simpleParser } = require('mailparser');
    const { user, appPassword } = requireConfigured();

    const config = {
        imap: {
            user, password: appPassword,
            host: 'imap.gmail.com', port: 993, tls: true,
            authTimeout: 10000,
            tlsOptions: { rejectUnauthorized: false },
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
    getEmailConfig, saveEmailConfig, requireConfigured,
    sendEmail, listInbox, readEmailBody, formatInboxForModel,
};
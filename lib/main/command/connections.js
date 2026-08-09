'use strict';

const fs   = require('fs');
const path = require('path');

const { wh, cr, kp, ab, sd, dg, tl, rf } = require('../../colors');

// ─── /connection ──────────────────────────────────────────────────────────────
async function handleConnection(text, ctx) {
  const { CONNECTION_REGISTRY, getConnectionStatus,
          disconnectConnection, setupConnection } = require('../../connections');
  const args = text.slice(11).trim().split(/\s+/);
  const sub  = args[0]?.toLowerCase();

  if (!sub || sub === 'list') {
    console.log('\n  ' + tl('\u26A1 Connections'));
    console.log('  ' + ab('─'.repeat(52)));
    Object.values(CONNECTION_REGISTRY).forEach((conn, i) => {
      const status = getConnectionStatus(conn.id);
      const badge  = conn.comingSoon ? ab('  (coming soon)')
                   : status?.connected ? kp(' ● connected')
                   : rf(' ○ not connected');
      console.log('  ' + ab('[' + (i + 1) + ']') + '  ' + conn.icon + '  ' + wh(conn.name.padEnd(14)) + ab(conn.description) + badge);
    });
    console.log('\n  ' + ab('─'.repeat(52)));
    console.log('  ' + ab('Type ') + sd('/connection <n>') + ab(' to set up.'));
    console.log('  ' + ab('e.g. ') + sd('/connection whatsapp'));
    console.log('  ' + ab('Or pick a number: '));
    const ids  = Object.keys(CONNECTION_REGISTRY);
    const ch   = await ctx.ask(cr('\n  ❯ ') + ab('Select [1-' + ids.length + '] or Enter to cancel: '));
    const idx  = parseInt(ch.trim()) - 1;
    if (!isNaN(idx) && ids[idx]) {
      await setupConnection(ids[idx], ctx);
    }
    ctx.prompt(); return true;
  }

  if (sub === 'disconnect') {
    const target = args[1]?.toLowerCase();
    if (!target || !CONNECTION_REGISTRY[target]) {
      console.log('\n  ' + dg('Usage: /connection disconnect <n>'));
      ctx.prompt(); return true;
    }
    disconnectConnection(target);
    console.log('\n  ' + kp('✔ Disconnected: ') + sd(CONNECTION_REGISTRY[target].name));
    ctx.prompt(); return true;
  }

  if (CONNECTION_REGISTRY[sub]) {
    await setupConnection(sub, ctx);
    ctx.prompt(); return true;
  }

  console.log('\n  ' + dg('Unknown connection: ') + sd(sub));
  console.log('  ' + ab('Available: ') + Object.keys(CONNECTION_REGISTRY).join(', '));
  ctx.prompt(); return true;
}

// ─── /wa ──────────────────────────────────────────────────────────────────────
async function handleWa(text, ctx) {
  const G  = '\x1b[38;5;35m';
  const GD = '\x1b[38;5;30m';
  const GL = '\x1b[38;5;157m';
  const GR = '\x1b[38;5;245m';
  const Y  = '\x1b[38;5;226m';
  const B  = '\x1b[1m';
  const R  = '\x1b[0m';
  const DIV = G + '─'.repeat(50) + R;

  const args = text.slice(3).trim();

  // ── /wa (no args) / /wa help ─────────────────────────────────────────────
  if (!args || args === 'help') {
    console.log('\n  ' + G + B + '💬 WhatsApp — /wa commands' + R);
    console.log('  ' + DIV);
    console.log('  ' + GL + '/wa <number> <message>' + R + GR + '  — send a message' + R);
    console.log('  ' + GL + '/wa status             ' + R + GR + '  — show connection status' + R);
    console.log('  ' + GL + '/wa history            ' + R + GR + '  — show recent messages (this session)' + R);
    console.log('  ' + GL + '/wa owner <number>     ' + R + GR + '  — change the owner number whyWhale responds to' + R);
    console.log('  ' + GL + '/wa --reset            ' + R + GR + '  — wipe session & credentials, forces fresh QR' + R);
    console.log('  ' + GL + '/wp                    ' + R + GR + '  — open WhatsApp setup / re-link' + R);
    console.log('  ' + DIV);
    console.log('  ' + GR + 'Example: ' + R + G + '/wa 919876543210 Hey, this is whyWhale!' + R);
    console.log('  ' + GR + 'Number format: country code + number, no spaces or + sign.' + R);
    console.log('');
    ctx.prompt(); return true;
  }

  // ── /wa --reset ──────────────────────────────────────────────────────────
  if (args === '--reset') {
    const WA_INDEX = path.resolve(__dirname, '../../connections/whatsapp/index.js');
    const conf = await ctx.ask('\n  ' + Y + '⚠ This will wipe your WhatsApp session and credentials.' + R + '\n  ' + GR + 'You will need to scan a QR code again to reconnect.' + R + '\n  ' + GR + 'Continue? [y/N]: ' + R);
    if (conf.trim().toLowerCase() !== 'y' && conf.trim().toLowerCase() !== 'yes') {
      console.log('  ' + ab('Cancelled.'));
      ctx.prompt(); return true;
    }
    try {
      const waModule = require(WA_INDEX);
      if (typeof waModule.resetSession === 'function') waModule.resetSession();
    } catch (_) {
      const sessionPath = path.join(require('os').homedir(), '.whyWhale', 'credentials', 'whatsapp', 'session');
      try { if (fs.existsSync(sessionPath)) fs.rmSync(sessionPath, { recursive: true, force: true }); } catch (_2) {}
      const connPath = path.join(require('os').homedir(), '.whyWhale', 'connections.json');
      try {
        if (fs.existsSync(connPath)) {
          const data = JSON.parse(fs.readFileSync(connPath, 'utf8'));
          if (data.whatsapp) { data.whatsapp.connected = false; fs.writeFileSync(connPath, JSON.stringify(data, null, 2), 'utf8'); }
        }
      } catch (_2) {}
    }
    ctx.waClient        = null;
    ctx._waSendFarewell = null;
    console.log('\n  ' + G + '✔ WhatsApp session wiped.' + R);
    console.log('  ' + GR + 'Run ' + R + G + '/wp' + R + GR + ' to reconnect and scan a fresh QR.' + R);
    console.log('');
    ctx.prompt(); return true;
  }

  // ── /wa owner <number> ───────────────────────────────────────────────────
  if (args.startsWith('owner')) {
    const rest = args.slice(5).trim().replace(/\D/g, '');
    if (!rest) {
      const connPath = path.join(require('os').homedir(), '.whyWhale', 'connections.json');
      let current    = 'not set';
      try {
        const data = JSON.parse(fs.readFileSync(connPath, 'utf8'));
        if (data.whatsapp?.ownerNumber) current = '+' + data.whatsapp.ownerNumber;
      } catch (_) {}
      console.log('\n  ' + G + B + '📱 WhatsApp owner number: ' + R + GL + current + R);
      console.log('  ' + GR + 'Usage: ' + R + G + '/wa owner 919876543210' + R + GR + ' (country code + number, no +)' + R);
      console.log('');
      ctx.prompt(); return true;
    }
    const connPath = path.join(require('os').homedir(), '.whyWhale', 'connections.json');
    try {
      let data = {};
      if (fs.existsSync(connPath)) data = JSON.parse(fs.readFileSync(connPath, 'utf8'));
      if (!data.whatsapp) data.whatsapp = { connected: false };
      data.whatsapp.ownerNumber = rest;
      fs.writeFileSync(connPath, JSON.stringify(data, null, 2), 'utf8');
      console.log('\n  ' + G + B + '✔ Owner number updated: ' + R + GL + '+' + rest + R);
      console.log('  ' + GR + 'Restart whyWhale (or run /wp) for the change to take effect.' + R);
    } catch (err) {
      console.log('\n  ' + '\x1b[38;5;203m' + '✘ Could not update owner number: ' + R + err.message);
    }
    console.log('');
    ctx.prompt(); return true;
  }

  // ── /wa status ────────────────────────────────────────────────────────────
  if (args === 'status') {
    const { getConnectionStatus } = require('../../connections');
    const status = getConnectionStatus('whatsapp');
    console.log('');
    if (ctx.waClient || ctx._waSendFarewell) {
      const owner = status?.ownerNumber ? GR + '  (owner: +' + status.ownerNumber + ')' + R : '';
      console.log('  ' + G + B + '● WhatsApp: connected' + R + GL + '  (active this session)' + R + owner);
    } else if (status?.connected) {
      console.log('  ' + GD + '● WhatsApp: saved' + R + GR + '  (credentials on disk — restart to auto-connect)' + R);
    } else {
      console.log('  ' + '\x1b[38;5;203m' + '○ WhatsApp: not connected' + R);
      console.log('  ' + GR + 'Run ' + R + G + '/wp' + R + GR + ' to set up, or ' + R + G + '/wa --reset' + R + GR + ' to start fresh.' + R);
    }
    console.log('');
    ctx.prompt(); return true;
  }

  // ── /wa history ───────────────────────────────────────────────────────────
  if (args === 'history') {
    const hist = ctx._waHistory || [];
    console.log('');
    if (!hist.length) {
      console.log('  ' + GR + 'No messages sent this session.' + R);
    } else {
      console.log('  ' + G + B + '💬 WhatsApp message history (this session)' + R);
      console.log('  ' + DIV);
      hist.forEach(h => {
        const dir = h.dir === 'out' ? G + '→' + R : GD + '←' + R;
        console.log('  ' + GR + h.time + R + ' ' + dir + ' ' + GR + h.to + R + '  ' + GL + h.text + R);
      });
      console.log('  ' + DIV);
    }
    console.log('');
    ctx.prompt(); return true;
  }

  // ── Guard: client not active ──────────────────────────────────────────────
  if (!ctx.waClient) {
    const { getConnectionStatus } = require('../../connections');
    const status = getConnectionStatus('whatsapp');
    console.log('');
    if (status?.connected) {
      console.log('  ' + Y + '⚠ WhatsApp client is not active this session.' + R);
      console.log('  ' + GR + 'Restart whyWhale to auto-reconnect, or run ' + R + G + '/wp' + R + GR + ' to re-link.' + R);
    } else {
      console.log('  ' + '\x1b[38;5;203m' + '✘ WhatsApp is not connected.' + R);
      console.log('  ' + GR + 'Run ' + R + G + '/wp' + R + GR + ' to set up, or ' + R + G + '/wa --reset' + R + GR + ' to start fresh.' + R);
    }
    console.log('');
    ctx.prompt(); return true;
  }

  // ── Interactive wizard (no number provided) ───────────────────────────────
  if (!args.match(/^\d/)) {
    console.log('\n  ' + G + B + '💬 Send a WhatsApp message' + R);
    console.log('  ' + DIV);
    const ccRaw  = await ctx.ask('  ' + G + '❯ Country code ' + GR + '(digits only, e.g. 91 for India, 1 for USA): ' + R);
    const cc     = ccRaw.trim().replace(/\D/g, '');
    if (!cc) { console.log('  ' + '\x1b[38;5;203m' + '✘ Cancelled.' + R + '\n'); ctx.prompt(); return true; }
    const numRaw = await ctx.ask('  ' + G + '❯ Phone number ' + GR + '(without country code or spaces): ' + R);
    const num    = numRaw.trim().replace(/\D/g, '');
    if (!num) { console.log('  ' + '\x1b[38;5;203m' + '✘ Cancelled.' + R + '\n'); ctx.prompt(); return true; }
    const msgRaw = await ctx.ask('  ' + G + '❯ Message: ' + R);
    const msg    = msgRaw.trim();
    if (!msg) { console.log('  ' + '\x1b[38;5;203m' + '✘ Cancelled.' + R + '\n'); ctx.prompt(); return true; }
    const fullNumber = cc + num;
    const jidW       = fullNumber + '@c.us';
    console.log('\n  ' + G + '⟳ Sending to +' + cc + ' ' + num + '...' + R);
    try {
      await ctx.waClient.sendMessage(jidW, { text: msg });
      if (!ctx._waHistory) ctx._waHistory = [];
      ctx._waHistory.push({ dir: 'out', to: fullNumber, text: msg, time: new Date().toTimeString().slice(0, 8) });
      console.log('  ' + G + B + '✔ Sent!' + R + GL + '  → +' + cc + ' ' + num + R);
    } catch (err) {
      console.log('  ' + '\x1b[38;5;203m' + '✘ Failed to send: ' + R + err.message);
    }
    console.log('');
    ctx.prompt(); return true;
  }

  // ── /wa <number> <message> shorthand ─────────────────────────────────────
  const spaceIdx = args.indexOf(' ');
  if (spaceIdx === -1) {
    console.log('\n  ' + '\x1b[38;5;203m' + '✘ No message provided.' + R);
    console.log('  ' + GR + 'Usage: ' + R + G + '/wa <number> <message>' + R + '\n');
    ctx.prompt(); return true;
  }

  const number  = args.slice(0, spaceIdx).trim().replace(/\D/g, '');
  const message = args.slice(spaceIdx + 1).trim();

  if (!number || !message) {
    console.log('\n  ' + '\x1b[38;5;203m' + '✘ Invalid format.' + R + GR + '  Usage: /wa <number> <message>' + R + '\n');
    ctx.prompt(); return true;
  }

  const jid = number + '@c.us';
  console.log('');
  console.log('  ' + G + '⟳ Sending...' + R);

  try {
    await ctx.waClient.sendMessage(jid, { text: message });
    if (!ctx._waHistory) ctx._waHistory = [];
    ctx._waHistory.push({ dir: 'out', to: number, text: message, time: new Date().toTimeString().slice(0, 8) });
    console.log('  ' + G + B + '✔ Sent!' + R + GL + '  → ' + number + R);
    console.log('  ' + GR + '"' + (message.length > 60 ? message.slice(0, 60) + '…' : message) + '"' + R);
  } catch (err) {
    console.log('  ' + '\x1b[38;5;203m' + '✘ Failed to send: ' + R + err.message);
    console.log('  ' + GR + 'Check the number format — no +, no spaces, with country code.' + R);
  }

  console.log('');
  ctx.prompt(); return true;
}

module.exports = { handleConnection, handleWa };
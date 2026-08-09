'use strict';

/**
 * dmPolicy.js
 *
 * Controls which senders the WhatsApp bot will respond to.
 *
 * Policies:
 *   'open'      — Anyone can message.
 *   'allowlist' — Only numbers in allowFrom may interact.
 *   'pairing'   — New contacts send any message, receive a code,
 *                 and must re-send it to be approved.
 *
 * The pairing table is in-memory; it resets on restart.
 * For persistence, swap the Map for a JSON file write.
 */

const { log, colors } = require('./logger');
const crypto  = require('crypto');

// ─── Pairing state ────────────────────────────────────────────────────────────
// sender → { code, approved, expiresAt }
const pairingTable = new Map();
const CODE_TTL_MS  = 10 * 60 * 1000; // 10 minutes

// ─── Main guard ───────────────────────────────────────────────────────────────
/**
 * Returns true if the sender is allowed to interact, false otherwise.
 * When false, appropriate messages are already sent back to the sender.
 */
async function dmGuard({ sender, text, policy, allowFrom, sock }) {
  // Group messages — always pass through (configure groupPolicy separately if needed)
  if (sender.endsWith('@g.us')) return true;

  switch (policy) {
    case 'open':
      return true;

    case 'allowlist':
      return isAllowed(sender, allowFrom);

    case 'pairing':
      return handlePairing({ sender, text, allowFrom, sock });

    default:
      log.warn(`Unknown dmPolicy "${policy}", defaulting to open.`);
      return true;
  }
}

// ─── Allowlist check ──────────────────────────────────────────────────────────
function isAllowed(sender, allowFrom) {
  if (allowFrom.includes('*')) return true;
  // sender is like "15551234567@s.whatsapp.net" — normalise
  const num = sender.replace('@s.whatsapp.net', '').replace(/\D/g, '');
  return allowFrom.some(a => a.replace(/\D/g, '') === num);
}

// ─── Pairing flow ─────────────────────────────────────────────────────────────
async function handlePairing({ sender, text, allowFrom, sock }) {
  // If in allowlist, skip pairing
  if (isAllowed(sender, allowFrom)) return true;

  const entry = pairingTable.get(sender);

  // ── Already approved ──────────────────────────────────────────────────────
  if (entry?.approved) return true;

  // ── Has a pending code — check if they sent it ────────────────────────────
  if (entry && !entry.approved) {
    const expired = Date.now() > entry.expiresAt;
    if (expired) {
      pairingTable.delete(sender);
      await sock.sendMessage(sender, {
        text: '🟢 Your pairing code expired. Send any message to request a new one.',
      });
      return false;
    }

    if (text.trim() === entry.code) {
      entry.approved = true;
      log.success(`Sender approved via pairing: ${sender}`);
      await sock.sendMessage(sender, {
        text: '✅ *Pairing successful!*\n\n🟢 You\'re now connected to Megaladon.\nStart chatting anytime.',
      });
      return true;
    }

    // Wrong code
    await sock.sendMessage(sender, {
      text: `❌ Incorrect code.\n\n🔑 Your code is: *${entry.code}*\n⏱ Expires in ${remaining(entry.expiresAt)}.`,
    });
    return false;
  }

  // ── New sender — issue a pairing code ─────────────────────────────────────
  const code = generateCode();
  pairingTable.set(sender, {
    code,
    approved:  false,
    expiresAt: Date.now() + CODE_TTL_MS,
  });

  log.info(`Pairing code issued for ${sender}: ${code}`);

  await sock.sendMessage(sender, {
    text: [
      '🦈 *Megaladon* — AI Terminal Assistant',
      '━━━━━━━━━━━━━━━━━━━━━━━━━━━',
      '👋 Hello! This bot requires a pairing code.',
      '',
      `🔑 Your code: *${code}*`,
      '',
      'Reply with this code to get started.',
      '⏱ Valid for 10 minutes.',
    ].join('\n'),
  });

  return false;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function generateCode() {
  return crypto.randomInt(100000, 999999).toString();
}

function remaining(expiresAt) {
  const ms  = expiresAt - Date.now();
  const min = Math.floor(ms / 60000);
  const sec = Math.floor((ms % 60000) / 1000);
  return `${min}m ${sec}s`;
}

module.exports = { dmGuard, pairingTable };
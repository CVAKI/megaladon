'use strict';

/**
 * connections/teams/teamsPolicy.js
 *
 * Who is allowed to message the bot in Teams.
 * Mirrors connections/whatsapp/dmPolicy.js, but keys off the Teams user's
 * AAD object ID (activity.from.aadObjectId) or UPN/email instead of a phone
 * number — Teams has no concept of a raw "number".
 *
 * Policies:
 *   open      — anyone who can reach the bot gets a reply
 *   allowlist — only AAD object IDs / emails in allowFrom (or '*') pass
 *   owner     — only the configured owner AAD ID passes (used as the default)
 *   pairing   — new users get a 6-digit code, must reply with it to unlock
 */

const pairingTable = new Map(); // key: userId -> { code, approved, expiresAt }

function normaliseId(id) {
  return (id || '').trim().toLowerCase();
}

function genCode() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

/**
 * teamsGuard({ userId, userEmail, text, policy, allowFrom, sendReply })
 *   userId    — activity.from.aadObjectId (stable, preferred)
 *   userEmail — activity.from.email or userPrincipalName (fallback match)
 *   text      — the message text (used for pairing-code replies)
 *   policy    — 'open' | 'allowlist' | 'owner' | 'pairing' | anything else -> open
 *   allowFrom — array of AAD object IDs / emails, or ['*']
 *   sendReply — async (text) => void, used by pairing to message the user back
 *
 * Returns true (allowed) or false (blocked).
 */
async function teamsGuard({ userId, userEmail, text, policy, allowFrom = [], sendReply }) {
  const uid   = normaliseId(userId);
  const email = normaliseId(userEmail);

  if (policy === 'allowlist') {
    if (allowFrom.includes('*')) return true;
    const normalisedAllow = allowFrom.map(normaliseId);
    return normalisedAllow.includes(uid) || (email && normalisedAllow.includes(email));
  }

  if (policy === 'owner') {
    if (!allowFrom.length) return true; // no owner configured yet — allow through
    const normalisedAllow = allowFrom.map(normaliseId);
    return normalisedAllow.includes(uid) || (email && normalisedAllow.includes(email));
  }

  if (policy === 'pairing') {
    const existing = pairingTable.get(uid);

    // Already approved — always pass
    if (existing?.approved) return true;

    // Expired pending code — clear it and issue a new one below
    if (existing && !existing.approved && existing.expiresAt < Date.now()) {
      pairingTable.delete(uid);
      if (typeof sendReply === 'function') {
        try { await sendReply('⚠️ Your pairing code expired. A new one has been issued below.'); } catch (_) {}
      }
    }

    const pending = pairingTable.get(uid);

    // No pending code yet — issue one and block
    if (!pending) {
      const code = genCode();
      pairingTable.set(uid, { code, approved: false, expiresAt: Date.now() + 10 * 60 * 1000 });
      if (typeof sendReply === 'function') {
        try {
          await sendReply(
            '🔑 **Pairing required**\n\nReply with this 6-digit code within 10 minutes to link your account:\n\n**' + code + '**'
          );
        } catch (_) {}
      }
      return false;
    }

    // Pending — check if this message IS the code
    const attempt = (text || '').trim();
    if (attempt === pending.code) {
      pairingTable.set(uid, { ...pending, approved: true });
      if (typeof sendReply === 'function') {
        try { await sendReply('✅ Paired! You can now chat with Megaladon from Teams.'); } catch (_) {}
      }
      return true;
    }

    // Wrong code
    if (typeof sendReply === 'function') {
      try { await sendReply('❌ Incorrect code. Reply with the 6-digit code you were sent.'); } catch (_) {}
    }
    return false;
  }

  // 'open' or unknown policy — default to open
  return true;
}

module.exports = { teamsGuard, pairingTable };

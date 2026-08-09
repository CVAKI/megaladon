'use strict';

const fs   = require('fs');
const path = require('path');
const os   = require('os');

const CONNECTIONS_PATH = path.join(os.homedir(), '.meg', 'connections.json');

const CONNECTION_REGISTRY = {
  whatsapp: {
    id:          'whatsapp',
    name:        'WhatsApp',
    icon:        '💬',
    color:       'kp',
    description: 'Send & receive WhatsApp messages from the terminal',
    packages:    ['@whiskeysockets/baileys', 'qrcode-terminal'],
  },
  telegram: {
    id:          'telegram',
    name:        'Telegram',
    icon:        '✈️',
    color:       'ab',
    description: 'Send & receive Telegram messages (coming soon)',
    packages:    [],
    comingSoon:  true,
  },
  discord: {
    id:          'discord',
    name:        'Discord',
    icon:        '🎮',
    color:       'vt',
    description: 'Monitor Discord channels (coming soon)',
    packages:    [],
    comingSoon:  true,
  },
};

function loadConnections() {
  try {
    if (fs.existsSync(CONNECTIONS_PATH))
      return JSON.parse(fs.readFileSync(CONNECTIONS_PATH, 'utf8'));
  } catch (_) {}
  return {};
}

function saveConnections(data) {
  try { fs.writeFileSync(CONNECTIONS_PATH, JSON.stringify(data, null, 2), 'utf8'); } catch (_) {}
}

function getConnectionStatus(id) {
  return loadConnections()[id] || null;
}

function disconnectConnection(id) {
  const data = loadConnections();
  delete data[id];
  saveConnections(data);
}

// ─── WhatsApp setup ───────────────────────────────────────────────────────────
async function setupWhatsApp(ctx) {
  const path2   = require('path');
  const { dg }  = require('./colors');

  const G  = '\x1b[38;5;35m';
  const GD = '\x1b[38;5;30m';
  const GL = '\x1b[38;5;157m';
  const GM = '\x1b[38;5;42m';
  const GR = '\x1b[38;5;245m';
  const WH = '\x1b[38;5;255m';
  const B  = '\x1b[1m';
  const R  = '\x1b[0m';
  const DIV = G + '─'.repeat(50) + R;

  console.log('');
  console.log('  ' + G + B + '┌─────────────────────────────────────────────────┐' + R);
  console.log('  ' + G + B + '│' + R + '  ' + WH + B + '💬  WhatsApp Connection Setup' + R + '                  ' + G + B + '│' + R);
  console.log('  ' + G + B + '└─────────────────────────────────────────────────┘' + R);
  console.log('  ' + DIV);
  console.log('  ' + GL + 'Links your WhatsApp account — no API key needed.' + R);
  console.log('  ' + GR + 'Powered by Baileys  ·  QR scan from your phone' + R);
  console.log('  ' + DIV);
  console.log('');

  const WA_INDEX = path2.resolve(__dirname, '../connections/whatsapp/index.js');
  const WA_DIR   = path2.dirname(WA_INDEX);

  let startWhatsApp;
  const tryLoad = (bustCache = false) => {
    if (bustCache) delete require.cache[require.resolve(WA_INDEX)];
    ({ startWhatsApp } = require(WA_INDEX));
  };

  try {
    tryLoad(false);
  } catch (_) {
    console.log('  ' + '\x1b[38;5;226m' + '⚠ Baileys deps missing — installing automatically...' + R);
    console.log('  ' + GR + '  cd connections/whatsapp && npm install' + R + '\n');

    const installed = await new Promise((resolve) => {
      const { spawn } = require('child_process');
      const isWin = process.platform === 'win32';
      const cmd   = isWin ? 'npm.cmd' : 'npm';
      const child = spawn(cmd, ['install'], {
        cwd: WA_DIR, stdio: 'inherit', shell: isWin,
      });
      child.on('close', code => resolve(code === 0));
      child.on('error', ()   => resolve(false));
    });

    if (!installed) {
      console.log('  ' + dg('✘ npm install failed.') + ' Try manually:');
      console.log('  ' + G + 'cd connections/whatsapp && npm install' + R);
      return false;
    }
    console.log('\n  ' + G + B + '✔ Deps installed!' + R + '\n');

    try { tryLoad(true); } catch (e) {
      console.log('  ' + dg('✘ Could not load Baileys after install: ') + e.message);
      return false;
    }
  }

  console.log('  ' + GM + '⟳ Starting WhatsApp client...' + R);
  console.log('  ' + GR + '  QR code will appear below — scan it with your phone.' + R + '\n');
  console.log('  ' + DIV);

  return new Promise((resolve) => {
    startWhatsApp({
      onConnected: async () => {
        console.log('');
        console.log('  ' + G + B + '┌─────────────────────────────────────────────────┐' + R);
        console.log('  ' + G + B + '│' + R + '  ' + G + B + '✅  WhatsApp Connected!' + R + '                        ' + G + B + '│' + R);
        console.log('  ' + G + B + '└─────────────────────────────────────────────────┘' + R);
        console.log('  ' + DIV);
        console.log('  ' + GL + '  Send a message: ' + R + G + '/wa <number> <message>' + R);
        console.log('  ' + GL + '  Example:        ' + R + G + '/wa 919876543210 Hello!' + R);
        console.log('  ' + GL + '  Disconnect:     ' + R + G + '/connection disconnect whatsapp' + R);
        console.log('  ' + DIV);
        console.log('');

        let ownerNumber = '';
        if (ctx && ctx.ask) {
          console.log('  ' + G + B + '📱  Your WhatsApp number' + R);
          console.log('  ' + GR + '  Megaladon will message YOU when it starts or stops.' + R);
          console.log('  ' + GR + '  It will ONLY reply to messages from this number.' + R);
          console.log('');

          const ccRaw = await ctx.ask('  ' + G + '❯ Country code ' + GR + '(digits only, e.g. 91 for India, 1 for USA): ' + R);
          const cc    = ccRaw.trim().replace(/\D/g, '');

          if (cc) {
            const numRaw = await ctx.ask('  ' + G + '❯ Phone number ' + GR + '(without country code or spaces): ' + R);
            const num    = numRaw.trim().replace(/\D/g, '');
            if (num) ownerNumber = cc + num;
          }
        }

        if (ownerNumber) {
          console.log('  ' + G + B + '✔ Owner set: ' + R + GL + ownerNumber + R + '\n');
        } else {
          console.log('  ' + GR + '  (skipped — update later in ~/.meg/connections.json)' + R + '\n');
        }

        const data = loadConnections();
        data.whatsapp = {
          connected:   true,
          connectedAt: new Date().toISOString(),
          ownerNumber: ownerNumber || '',
        };
        saveConnections(data);

        if (ctx) ctx.waClient = null;

        try {
          const waResolved = require.resolve(WA_INDEX);
          if (require.cache[waResolved]) delete require.cache[waResolved];
        } catch (_) {}

        resolve(true);
      },

      onDisconnected: (reason) => {
        if (reason === 'loggedOut' || reason === 'maxRetries') {
          resolve(false);
        }
      },
    }).catch((err) => {
      console.log('  ' + dg('✘ Failed to start WhatsApp: ') + err.message);
      resolve(false);
    });
  });
}

// ─── setupConnection ──────────────────────────────────────────────────────────
async function setupConnection(id, ctx) {
  const reg = CONNECTION_REGISTRY[id];
  if (!reg) return false;
  if (reg.comingSoon) {
    const { ab, dg } = require('./colors');
    console.log('\n  ' + dg(reg.icon + ' ' + reg.name + ' is coming soon!') + ab(' Stay tuned.'));
    return false;
  }
  if (id === 'whatsapp') return setupWhatsApp(ctx);
  return false;
}

module.exports = {
  CONNECTION_REGISTRY,
  loadConnections,
  saveConnections,
  getConnectionStatus,
  disconnectConnection,
  setupConnection,
};
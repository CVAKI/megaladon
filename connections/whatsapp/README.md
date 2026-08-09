# 🐋 whyWhale — WhatsApp Connection

Connects whyWhale to WhatsApp via the **Baileys** library  
(reverse-engineered WA Web multi-device protocol — no Business API needed).

---

## Folder structure

```
connections/
└── whatsapp/
    ├── index.js        ← entry point & WA socket lifecycle
    ├── aiHandler.js    ← bridges WA messages → whyWhale AI pipeline
    ├── dmPolicy.js     ← who can message the bot (open / allowlist / pairing)
    ├── logger.js       ← styled terminal output
    ├── package.json    ← Baileys + pino deps
    └── README.md
```

---

## Quick start

### 1. Install dependencies

```bash
cd connections/whatsapp
npm install
```

### 2. Run standalone

```bash
node index.js
```

A QR code will appear in your terminal.  
Open WhatsApp → **Settings → Linked Devices → Link a Device** and scan it.

Credentials are saved to `~/.whywhale/credentials/whatsapp/session/` — you only scan once.

### 3. Headless server (no display)

The QR code is always printed as ASCII art in the terminal (`printQRInTerminal: true`),  
so it works on headless servers out of the box.

---

## Environment variables

| Variable        | Default                        | Description                          |
|-----------------|--------------------------------|--------------------------------------|
| `WA_DM_POLICY`  | `open`                         | `open` / `allowlist` / `pairing`     |
| `WA_ALLOW_FROM` | `*`                            | Comma-separated allowed phone numbers|
| `WA_PROVIDER`   | value from `~/.whywhale.json`  | `anthropic` / `openrouter` / `groq` / `ollama` |
| `WA_MODEL`      | value from `~/.whywhale.json`  | Model ID string                      |
| `WA_API_KEY`    | value from `~/.whywhale.json`  | Your provider API key                |
| `OLLAMA_HOST`   | `http://localhost:11434`       | Ollama base URL (if using Ollama)    |

---

## DM Policies

### `open` (default)
Anyone who messages the bot gets a reply.

### `allowlist`
Only phone numbers in `WA_ALLOW_FROM` (or `allowFrom` in code) can interact.  
Everyone else is silently ignored.

### `pairing`
New contacts receive a 6-digit pairing code.  
They must reply with the code within 10 minutes to be approved.  
Approved senders are remembered for the lifetime of the process.

---

## Integrate with the full whyWhale pipeline

If you're running whyWhale normally, pass the `ctx` object to `aiHandler`  
so WhatsApp messages go through the same 7-phase pipeline (memory, skills, self-test, etc.):

```js
const { startWhatsApp }    = require('./connections/whatsapp');
const { setContext }       = require('./connections/whatsapp/aiHandler');

// After whyWhale ctx is initialised:
setContext(ctx);
startWhatsApp({ dmPolicy: 'pairing' });
```

Without `setContext()`, the module falls back to a direct API call using  
the config from `~/.whywhale.json`.

---

## ⚠️ Things to know

| Topic | Detail |
|---|---|
| **Phone must stay online** | Your phone must remain on. WhatsApp unlinks after ~14 days offline. |
| **Session expiry** | Sessions last ~30 days then require a new QR scan. |
| **WhatsApp Web conflict** | You can't use WhatsApp Web simultaneously with this bot, but the mobile app works fine. |
| **Risk** | Baileys reverse-engineers the WA protocol — it could break if WhatsApp updates. Use a dedicated number. |
| **Multi-device** | Up to 4 linked devices per number; this gateway counts as one. |

---

## Architecture

```
WhatsApp message arrives
        ↓
  index.js  (Baileys socket)
        ↓
  dmPolicy.js  (open / allowlist / pairing gate)
        ↓
  aiHandler.js  (whyWhale 7-phase pipeline OR direct provider call)
        ↓
  Provider API  (Claude / Groq / OpenRouter / Ollama)
        ↓
  sock.sendMessage()  →  back to WhatsApp
```

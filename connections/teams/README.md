# 🦈 Megaladon — Microsoft Teams Connection

Connects Megaladon to Microsoft Teams via the **Bot Framework SDK**
(the official, supported way to get real-time push messages from Teams —
the closest equivalent to the WhatsApp connector's socket-based model).

---

## Folder structure

```
connections/
└── teams/
    ├── index.js         ← entry point, Bot Framework adapter & HTTP server
    ├── aiHandler.js      ← bridges Teams messages → Megaladon AI pipeline
    ├── teamsPolicy.js    ← who can message the bot (open / allowlist / owner / pairing)
    ├── logger.js         ← styled terminal output
    ├── package.json      ← botbuilder + restify deps
    └── README.md
```

---

## 1. Register an Azure Bot

Unlike WhatsApp (which just needs a QR scan), Teams requires a real Azure
Bot registration:

1. Go to **portal.azure.com** → create an **Azure Bot** resource.
2. Choose **Multi Tenant** (simplest) or **Single Tenant** if you want it
   restricted to your own Microsoft 365 org.
3. Note the **Microsoft App ID** generated for you.
4. Under **Certificates & secrets**, create a **client secret** — this is
   your **Microsoft App Password**.
5. Under **Channels**, add the **Microsoft Teams** channel.
6. Under **Configuration**, set the **messaging endpoint** to:
   ```
   https://<your-public-host>/api/messages
   ```
   During local development, use a tunnel (e.g. `ngrok http 3978`) and put
   the ngrok HTTPS URL here — Azure requires HTTPS.

---

## 2. Configure Megaladon

Inside Megaladon:

```
/connection teams
```

You'll be asked for the App ID and App Password. These are saved to
`~/.meg/connections.json` under the `teams` key.

Or set environment variables instead:

```bash
export TEAMS_APP_ID=xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
export TEAMS_APP_PASSWORD=your-client-secret
export TEAMS_APP_TYPE=MultiTenant     # or SingleTenant
export TEAMS_PORT=3978                # default
```

---

## 3. Install dependencies

```bash
cd connections/teams
npm install
```

## 4. Run standalone

```bash
node index.js
```

Then expose port 3978 publicly (ngrok, reverse proxy, etc.) and make sure
the Azure Bot's messaging endpoint points at `/api/messages` on that URL.

## 5. Sideload the bot into Teams

You need a Teams **app package** (a zip with `manifest.json` + two icons)
to install the bot as a personal app or add it to a team/channel. Use the
[Teams Developer Portal](https://dev.teams.microsoft.com/) to generate one
from your App ID — Microsoft's tooling handles manifest correctness for you.

---

## DM Policies (`~/.meg/connections.json` → `teams.dmPolicy`)

| Policy | Behavior |
|---|---|
| `owner` (default) | Only the first user who messages the bot (or a configured `ownerId`) gets replies |
| `open` | Anyone who can reach the bot gets a reply |
| `allowlist` | Only AAD object IDs / emails in `teams.allowFrom` (or `["*"]`) |
| `pairing` | New users get a 6-digit code, must reply with it within 10 minutes |

Identity in Teams is matched on `activity.from.aadObjectId` (stable Azure AD
object ID) with a fallback to `userPrincipalName`/email — Teams has no
phone-number concept, so this replaces the WhatsApp allowlist's number list.

---

## Integrate with the full Megaladon pipeline

If you're running Megaladon normally, pass the `ctx` object to `aiHandler`
so Teams messages go through the same pipeline as the terminal (memory,
skills, self-test, etc.):

```js
const { startTeams } = require('./connections/teams');
const { setContext } = require('./connections/teams/aiHandler');

// After Megaladon ctx is initialised:
setContext(ctx);
startTeams({ onConnected: () => console.log('Teams bot live') });
```

Without `setContext()`, the module falls back to a direct provider call
using the config from `~/.meg/config.json` — same fallback behaviour as
the WhatsApp connector.

---

## Sending files

Text-ish files (`.js .ts .json .md .txt .html .css .py .yml .yaml`) are
inlined as a Teams code-block message. Binary files (zip, images, PDFs)
are currently described with their path on the host rather than uploaded
as a real attachment — Teams attachments need either a publicly reachable
content URL or a base64 `application/vnd.microsoft.teams.card.file.consent`
flow, which isn't wired up yet. If you need real file uploads, that's the
next piece to build here.

---

## Architecture

```
Teams message arrives (POST /api/messages)
        ↓
  index.js  (Bot Framework CloudAdapter + TeamsActivityHandler)
        ↓
  teamsPolicy.js  (open / allowlist / owner / pairing gate)
        ↓
  aiHandler.js  (Megaladon pipeline OR direct provider call via lib/providers.js)
        ↓
  Provider API  (Anthropic / OpenRouter / Groq / Ollama / future NVIDIA NIM)
        ↓
  context.sendActivity()  →  back to Teams
```

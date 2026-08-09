# 🐋 whyWhale Plugin System — How It Works

> Version 1.0 · CVAKI

---

## Overview

The whyWhale plugin system lets you extend the assistant with custom slash commands
packaged as `.zip` files. Drop a zip into `skills/plugs/`, run one command, and your
plugin becomes a first-class citizen — the AI model learns what it does, its commands
appear in `/skill list`, and it persists across sessions.

---

## Folder Layout

```
whyWhale/
├── plugins/               ← plugin engine (do not edit)
│   ├── index.js
│   ├── installer.js
│   ├── loader.js
│   ├── registry.js
│   └── dispatcher.js
│
└── skills/
    ├── socket.txt         ← plugin registry (auto-managed)
    ├── plugs/             ← DROP YOUR .zip FILES HERE
    │   └── pdfcry.zip
    └── .cache/            ← extracted plugins (auto-managed)
        └── pdfcry/
```

---

## Plugin ZIP Structure

Every plugin is a single `.zip` file. Inside it:

```
myplugin.zip
├── plug-connect.json      ← required: metadata & command definitions
├── gate.js                ← required: entry point / bridge
└── myplugin/              ← required: core folder (same name as zip)
    ├── main.js            ← your actual logic
    └── ...
```

> **Rule:** The core folder name **must match** the ZIP filename (without `.zip`).

---

## plug-connect.json

```json
{
  "name": "myplugin",
  "version": "1.0.0",
  "description": "One clear sentence about what this plugin does.",
  "id": null,
  "author": "YourName",
  "lang": ["js"],
  "commands": [
    {
      "trigger": "/myplugin",
      "brief": "Short one-line description of this command",
      "usage": "/myplugin <arg1> [arg2]",
      "description": "Full description shown in /skill show myplugin"
    },
    {
      "trigger": "/myplugin-sub",
      "brief": "Another command from the same plugin",
      "usage": "/myplugin-sub <filepath>",
      "description": "Does something different."
    }
  ]
}
```

**Fields:**

| Field         | Required | Notes |
|---------------|----------|-------|
| `name`        | ✔        | Human-readable name |
| `version`     | ✔        | SemVer string |
| `description` | ✔        | Used in AI context and socket.txt |
| `id`          | —        | Leave `null` — whyWhale assigns it on install |
| `author`      | —        | Your name |
| `lang`        | —        | `["js"]`, `["py"]`, `["cpp"]`, `["ts"]`, etc. |
| `commands`    | ✔        | Array of command objects |

---

## gate.js — The Bridge

`gate.js` is the **only** file whyWhale calls directly. It must export a single
async `handle()` function:

```js
'use strict';
const path = require('path');

module.exports = {
  async handle({ command, args, ctx, pluginDir }) {
    // command   — the slash command string, e.g. "/myplugin"
    // args      — array of space-split arguments after the command
    // ctx       — whyWhale context object (ctx.messages, ctx.providerKey, etc.)
    // pluginDir — absolute path to the extracted plugin folder

    const core = require(path.join(pluginDir, 'myplugin', 'main.js'));

    if (command === '/myplugin') {
      const result = await core.run(args[0]);
      return { output: result };         // string or object
    }

    return { error: `Unknown command: ${command}` };
  },
};
```

### Return values

| Return                     | Effect |
|----------------------------|--------|
| `{ output: "string" }`     | Printed as markdown |
| `{ output: { text, pages, info } }` | Printed with metadata header |
| `{ error: "message" }`     | Shown as red error |
| `{ aiPrompt: "string" }`   | *(future)* forwarded to AI model |

---

## Installing a Plugin

```
1. Place  myplugin.zip  inside  skills/plugs/

2. In whyWhale:
   /skill install myplugin

3. Done — commands are live immediately.
```

Output:
```
  ⟳ Installing plugin: myplugin ...
  ✔ Plugin installed: My Plugin v1.0.0 (myplugin-a3f2b9)
  ID: myplugin-a3f2b9
  Commands registered:
    /myplugin         Short one-line description
    /myplugin-sub     Another command from the same plugin
  Use /myplugin to run it.
```

---

## socket.txt Format

After installation, the plugin's entry is appended to `skills/socket.txt`:

```
["One clear sentence about what this plugin does.":(myplugin-a3f2b9)].@{
    [myplugin{"Short one-line description of this command"}]==(/myplugin),
    [myplugin{"Another command from the same plugin"}]==(/myplugin-sub)
};//myplugin pack
```

This file is used by whyWhale to build the AI's awareness of what plugins are
available and when to suggest them.

---

## Writing Plugins in Other Languages

`gate.js` is always JavaScript (Node.js). However, your **core folder** can call
any language using `child_process`.

### Python core

```js
// gate.js
const { spawnSync } = require('child_process');
const path = require('path');

module.exports = {
  async handle({ command, args, pluginDir }) {
    const script = path.join(pluginDir, 'myplugin', 'main.py');
    const r = spawnSync('python3', [script, ...args], {
      cwd: pluginDir,
      encoding: 'utf8',
    });
    if (r.status !== 0) return { error: r.stderr || 'Python error' };
    return { output: r.stdout };
  },
};
```

### C++ core

```js
// gate.js — calls a compiled C++ binary
const { spawnSync } = require('child_process');
const path = require('path');

module.exports = {
  async handle({ command, args, pluginDir }) {
    const bin = path.join(pluginDir, 'myplugin', process.platform === 'win32' ? 'main.exe' : 'main');
    const r = spawnSync(bin, args, { cwd: pluginDir, encoding: 'utf8' });
    if (r.status !== 0) return { error: r.stderr || 'Binary error' };
    return { output: r.stdout };
  },
};
```

### TypeScript core

Compile your TS to JS before packaging, or use `ts-node` from gate.js:

```js
// gate.js
const { spawnSync } = require('child_process');
module.exports = {
  async handle({ command, args, pluginDir }) {
    const entry = require('path').join(pluginDir, 'myplugin', 'index.ts');
    const r = spawnSync('npx', ['ts-node', entry, command, ...args], {
      cwd: pluginDir, encoding: 'utf8', shell: true,
    });
    return r.status === 0 ? { output: r.stdout } : { error: r.stderr };
  },
};
```

---

## Useful Commands

```
/skill list              — list all built-in skills and installed plugins
/skill install <name>    — install a built-in skill or a ZIP plugin
/skill remove  <name>    — uninstall a skill or plugin
/skill show    <name>    — show details / prompts for a skill or plugin
/skill plugins           — plugin system status, paths, and installed list
```

---

## Example: pdfcry

The included `pdfcry.zip` demonstrates a complete plugin:

```
/pdfcry report.pdf           — extract all text from a PDF
/pdfcry-info contract.pdf    — show PDF metadata (title, author, pages)
/pdfcry-ask thesis.pdf summarise chapter 2
                             — extract + ask AI about the content
```

Install it:
```
/skill install pdfcry
```

For best extraction quality, install `pdf-parse` in your project:
```
npm install pdf-parse
```
(The plugin works without it using a built-in fallback, but quality is lower.)

---

## Plugin Development Checklist

- [ ] ZIP name matches the inner core folder name
- [ ] `plug-connect.json` has `name`, `version`, `description`, `commands`
- [ ] Every command in `commands` has `trigger` and `brief`
- [ ] `gate.js` exports `{ handle({ command, args, ctx, pluginDir }) }`
- [ ] `gate.js` does NOT crash if core deps are missing — return `{ error }` instead
- [ ] `id` field in `plug-connect.json` is `null` (whyWhale assigns it)
- [ ] Tested with `/skill install` in whyWhale before distributing

---

*Plugin system designed and built by CVAKI for whyWhale v4.0+*

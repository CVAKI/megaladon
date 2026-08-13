# 🦈 Megaladon Abilities — Screen / Mouse / Keyboard

Gives Megaladon real desktop control: it can see the screen (via a local
Ollama vision model), move/click/scroll/drag the mouse, and type on the
keyboard — the same way a person operates the computer.

```
skills/abilities/
├── index.js              ← dispatcher + @@ABILITY directive parser
├── package.json
├── monitorscreen/         screen capture + Ollama vision (describe / watch)
├── mousecontrol/          move, click, double-click, scroll, drag
└── keyboardcontrol/       type text, press keys, key combos
```

## 1. Nothing to install manually — it self-heals

Everything below happens automatically, the first time each piece is
actually needed, no manual commands required:

| Missing piece | What happens automatically |
|---|---|
| `@nut-tree-fork/nut-js` / `screenshot-desktop` not installed | `index.js` runs `npm install` in this folder on first `require()` (same pattern as the WhatsApp/Teams connectors' auto-install). |
| Ollama not installed at all | `ollamaSetup.js` downloads and runs the official installer (`curl \| sh` on macOS/Linux, the official `.exe` on Windows) before the first `screen.describe`/`screen.watch`. |
| Ollama installed but not running | `ollama serve` is started in the background and we wait (up to 20s) for it to come up. |
| Vision model not pulled (`llava` by default) | `ollama pull <model>` runs automatically, with a progress bar, before the first screen ability call. |
| `runAbilities()` still throws after all that (e.g. offline) | Routed through `toolRunner.js`'s `runToolWithAutoInstall` for one retry, then the error is fed back to the AI as an ability result — it doesn't crash the pipeline. |

If you'd rather not wait on the first real request, you can still pre-warm
manually:

```bash
cd skills/abilities && npm install
ollama pull llava              # or: bakllava / llama3.2-vision / moondream (smaller & faster)
```

Set which vision model Megaladon uses (defaults to `llava`):

```bash
export MEG_VISION_MODEL=llava
```

## 2. OS permissions

| OS | What you need to do |
|---|---|
| Windows | Works out of the box. |
| macOS | Grant the terminal (or Megaladon's app bundle) **Accessibility** and **Screen Recording** permission: System Settings → Privacy & Security. |
| Linux | Requires X11. Wayland blocks synthetic mouse/keyboard input by design — run under XWayland or an X11 session. |

## 3. Manual test (works right now, no wiring needed)

```js
const { mouseControl, keyboardControl, monitorScreen } = require('./skills/abilities');

(async () => {
  console.log(await monitorScreen.describeScreen());
  await mouseControl.clickAt(500, 300);
  await keyboardControl.type('hello from megaladon');
  await keyboardControl.pressKey('enter');
})();
```

## 4. Scenario — dashboard monitoring

```js
const { startWatch } = require('./skills/abilities');

const watcher = startWatch(
  'alert if any metric or graph on this dashboard turns red or shows an error state',
  { intervalMs: 30000 },
  (event) => {
    if (event.triggered) {
      console.log('⚠️ Triggered:', event.reason);
      // hook this into sendToOwner() (WhatsApp/Teams) or the agent loop — see wiring below
    }
  }
);
// watcher.stop()
```

---

## 5. Wiring into the AI pipeline

This module works completely standalone (steps 4–5 above run today, no other
changes needed). To make the AI emit `@@ABILITY:` directives **automatically**
— the same way it already emits `@@FILE:` / `@@RUN:` / `@@MEMORY:` — three
files need small, targeted edits. I don't have their current contents yet
(they were cropped out of the project dump), so send me:

- `lib/main/aiHandler/directives.js`
- `lib/main/aiHandler/systemPrompt.js`
- `lib/main/aiHandler/toolRunner.js`
- `lib/main/command/tools.js` (for the unfinished `/email setup` handler context — only if you want me to also finish that in the same pass)

Once I have them, here's exactly what changes in each (shown against the
patterns visible elsewhere in your codebase, e.g. `connections/whatsapp/aiHandler.js`):

### `directives.js`
Alongside wherever `@@FILE:` / `@@RUN:` regexes are parsed:
```js
const { parseAbilityDirectives } = require('../../../skills/abilities');
// ...inside whatever parseDirectives(text) currently returns:
result.abilities = parseAbilityDirectives(text);
```

### `systemPrompt.js`
Append the ability instructions only when the skill is installed/enabled:
```js
const { ABILITIES_PROMPT } = require('../../../skills/abilities');
// ...wherever the final system prompt string is assembled:
if (skills.some(s => s.name === 'Abilities' || s.id === 'abilities')) {
  systemPrompt += '\n\n' + ABILITIES_PROMPT;
}
```

### `toolRunner.js`
Wherever directive results get executed and fed back into the loop (same
place `@@RUN:` output or self-test results go back to the model):
```js
const { runAllAbilities, formatAbilityResults } = require('../../../skills/abilities');
// ...alongside the file-write / shell-run execution step:
if (directives.abilities && directives.abilities.length) {
  const abilityResults = await runAllAbilities(directives.abilities);
  const resultText = formatAbilityResults(abilityResults);
  // feed resultText back into the conversation the same way self-test
  // output is appended, so the model sees "click landed" / a fresh screen
  // description and can decide its next @@ABILITY: step.
}
```

I intentionally didn't guess-write these three files myself — wiring
directly into your directive/prompt/execution pipeline without seeing the
real code risks silently breaking `@@FILE`/`@@RUN`/`@@MEMORY`. Send them over
and I'll do the actual integration in one pass.
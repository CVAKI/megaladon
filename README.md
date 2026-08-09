<p align="center">
  <img src="./banner.svg" alt="Megaladon — AI Terminal Assistant" width="840"/>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/version-alpha_1-FF6B2B?style=for-the-badge&labelColor=030a12" alt="version"/>
  <img src="https://img.shields.io/badge/Node.js-18+-3CDCC8?style=for-the-badge&logo=node.js&logoColor=white&labelColor=030a12" alt="node"/>
  <img src="https://img.shields.io/badge/license-MIT-B96EFF?style=for-the-badge&labelColor=030a12" alt="license"/>
  <img src="https://img.shields.io/badge/platform-Windows%20%7C%20macOS%20%7C%20Linux-FFC83C?style=for-the-badge&labelColor=030a12" alt="platform"/>
  <img src="https://img.shields.io/badge/AI-Claude%20%7C%20Groq%20%7C%20Ollama-1EB4FF?style=for-the-badge&labelColor=030a12" alt="ai"/>
</p>

<p align="center">
  <img src="https://capsule-render.vercel.app/api?type=rect&color=0:030a12,100:041525&height=2&section=header" width="100%"/>
</p>

<br/>

> 🦈 **Megaladon** is an AI assistant that lives in your terminal. Type naturally, run shell commands, manage files, and let the AI write and fix code — all without leaving your terminal.

<br/>

## 📦 Installation

**Step 1 — Clone and install**
```bash
git clone https://github.com/CVAKI/Megaladon.git
cd Megaladon
npm install -g .
```

**Step 2 — Launch**
```bash
megaladon
# or the short alias:
m
```

**First launch** will walk you through a quick setup — pick your AI provider, paste your API key, and you're in.

> 💡 To run without installing globally: `node bin/meg.js`

<br/>

## ⚙️ First-Time Setup

When you launch Megaladon for the first time, it will ask you:

1. **Choose a provider** — Anthropic, OpenRouter, Groq, or Ollama (local/free)
2. **Pick a model** — a numbered list is shown for your chosen provider
3. **Paste your API key** — stored locally at `~/.meg/config.json`

To redo setup at any time:
```bash
megaladon --setup
```

To reset everything and start fresh:
```bash
megaladon --reset
# or from inside the app:
/reset
```

<br/>

## 🌊 Choosing a Provider

| Provider | Best For | API Key |
|---|---|---|
| **Anthropic** | Best quality, Claude models | [console.anthropic.com](https://console.anthropic.com) |
| **OpenRouter** | Access many models with one key | [openrouter.ai](https://openrouter.ai) |
| **Groq** | Very fast responses, free tier | [console.groq.com](https://console.groq.com) |
| **Ollama** | 100% local, no API key needed | [ollama.com](https://ollama.com) |

To switch provider later, type `/provider` inside the app.

<br/>

## 💬 Chatting with the AI

Just type anything and press Enter — the AI will respond.

```
┌[11:19:07]────[Megaladon]────[💻 code]────[#3]
└[~/my-project]──► explain what a closure is in JavaScript
```

The prompt shows your current **time**, **mode**, **message count**, and **working directory**.

### Switching AI Modes

Modes change how the AI thinks and responds. Switch with `/mode <name>`:

| Command | Mode | Good For |
|---|---|---|
| `/mode code` | 💻 Code | Writing and editing code |
| `/mode architect` | ⬡ Architect | Designing systems and structure |
| `/mode debug` | ⚡ Debug | Finding and fixing bugs |
| `/mode explain` | ❋ Explain | Learning something new |
| `/mode review` | ⊕ Review | Getting feedback on your code |
| `/mode plan` | 📋 Plan | Breaking down a project |
| `/mode agent` | ◈ Agent | Let AI create and fix files on its own |

> 💡 Megaladon will also **auto-switch modes** based on what you type — e.g. if you say "fix this bug", it switches to debug mode automatically.

<br/>

## 🖥️ Running Shell Commands

Prefix any terminal command with `!` to run it without leaving Megaladon:

```bash
!ls -la
!git status
!git commit -m "initial commit"
!npm install express
!python app.py
!node server.js
```

The output is shown right in the chat. If a node script fails with a missing module error, Megaladon will **automatically install it and retry**.

<br/>

## 📂 Working with Files

### Browse your project

```
/ls              # list files in current folder
/ls src/         # list a specific folder
/tree            # show folder tree (3 levels deep)
/tree 5          # tree with custom depth
```

### Read a file

```
/read index.js
/read src/app.py
```

Shows the file with **syntax highlighting** right in the terminal.

### Create, delete, rename

```
/create server.js
/delete old_file.js
/rename old.js new.js
```

### Let AI write a file

```
/write server.js
```

Megaladon will ask what you want in the file, then the AI generates and saves it automatically.

### Deep AI analysis

```
/analyse server.js
```

The AI reads the file and gives you: its purpose, quality score, issues found, and suggestions.

### Scan your project into AI context

```
/scan
```

Reads all project files so the AI knows your full codebase when answering questions.

<br/>

## 🔬 Auto-Fix Mode

```
/debug -fix
/debug -fix server.js
```

This is Megaladon's most powerful feature. It will:

1. Scan your project
2. Run the target file
3. If it fails → read the error → ask the AI to fix it
4. Repeat up to 4 times until it runs successfully

> 💡 Missing npm packages are installed automatically before each attempt — no manual `npm install` needed.

<br/>

## 💾 Memory System

Megaladon remembers facts between sessions. The AI saves things automatically, and you can manage them yourself:

```
/memory                        # see everything stored
/memory set project myapp      # save a fact manually
/memory clear                  # wipe all memory
```

You can also tell the AI to remember something mid-conversation:
```
remember that the backend runs on port 4000
```
The AI will save it with `@@MEMORY:` and it will be there next time you launch.

<br/>

## 🎯 Skills

Skills are prompt packs that make the AI better at specific topics. Install one and it applies to every response.

```
/skill list                    # see all available skills
/skill install react           # install the React skill
/skill install docker          # install the Docker skill
/skill show react              # preview what the skill does
/skill remove react            # uninstall a skill
```

**Available skills:** `react` · `python` · `security` · `testing` · `api-design` · `docker` · `database` · `git` · `performance` · `typescript`

<br/>

## 💬 WhatsApp Integration

Connect your WhatsApp number so the AI can receive and reply to messages.

```
/wp                            # start WhatsApp setup (scan QR)
/wa status                     # check connection status
/wa 919876543210 Hello!        # send a message manually
/wa history                    # messages sent this session
/wa owner 919876543210         # set which number the bot responds to
/wa --reset                    # wipe session and scan a fresh QR
```

> ⚠️ Use a dedicated/spare number. Your phone must stay online, and WhatsApp Web can't be used at the same time.

<br/>

## 💾 Sessions

Save and restore full conversations:

```
/save                          # save with auto-generated name
/save my-project-chat          # save with a custom name
/load                          # pick a saved session to restore
/export                        # export chat as a styled HTML file
```

<br/>

## 📊 Dashboard

Open a live web dashboard in your browser:

```
/dashboard
/dashboard 8080                # use a custom port (default is 7070)
```

Then open `http://localhost:7070` to see your session stats, memory, and chat history in a UI.

<br/>

## 🔧 Other Useful Commands

```
/stats                         # session overview (tokens, uptime, etc.)
/tokens                        # quick token count
/token                         # see token limit presets
/token -set-usage 8192         # set max tokens for AI responses
/model                         # see available models
/model 2                       # switch to model #2 from the list
/provider                      # switch AI provider
/clear                         # clear the conversation (keep settings)
/copy                          # copy last AI reply to clipboard
/history                       # show past session summaries
/run <command>                 # run a shell command (same as !)
/exit                          # quit Megaladon
```

<br/>

## 📁 Where Megaladon Stores Data

All data is stored in your home folder:

| Path | What's in it |
|---|---|
| `~/.meg/config.json` | Your provider, model, and API key |
| `~/.meg/memory.json` | Saved facts and session summaries |
| `~/.meg/sessions/` | Saved conversations |
| `~/.meg/skills/` | Installed skill packs |
| `~/.meg/credentials/` | WhatsApp session (if connected) |

<br/>

## ⌨️ Quick Tips

- **Multi-line input** — end a line with `\\` to continue on the next line
- **Auto mode switch** — Megaladon detects intent and changes modes automatically
- **Agent mode** — in `/mode agent`, the AI will create and edit files without asking confirmation each time
- **`@@MEMORY:`** — if you see this in an AI response, it means the AI saved a fact for later
- **Ctrl+C** — safely exits Megaladon

<br/>

<p align="center">
  <img src="https://capsule-render.vercel.app/api?type=waving&color=0:030a12,50:1eb4ff,100:b96eff&height=100&section=footer" width="100%"/>
</p>

<p align="center">
  <sub>alpha 1 — MIT License — developed by <strong>CVKI ♞</strong></sub>
</p>
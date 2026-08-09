'use strict';

// ─── lib/main.js ──────────────────────────────────────────────────────────────
// Entry point. All logic lives in lib/main/* submodules:
//
//   lib/main/
//   ├── constants.js   VERSION, TOP_CODING_IDS, OLLAMA_DOWNLOADABLE
//   ├── utils.js       stripFileBlocks, buildSystemPrompt
//   ├── setup.js       provider / API key / model selection, folder scan, welcome
//   ├── commands.js    all /slash command and !shell handlers
//   ├── autoDetect.js  auto mode-switching and skill auto-install
//   ├── aiHandler.js   AI message send, @@FILE, @@RUN, self-test
//   └── index.js       main() orchestrator + input queue
//
const { main, VERSION } = require('./main/index');

module.exports = { main, VERSION };
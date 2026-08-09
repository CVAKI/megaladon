'use strict';

// ─── command/index.js ─────────────────────────────────────────────────────────
// Barrel file — re-exports every handler from the sub-modules so that
// commands.js (the router) can do a single require('./command').
//
//   lib/main/
//   ├── command/
//   │   ├── index.js        ← this file
//   │   ├── shell.js        !shell passthrough + Windows shims
//   │   ├── session.js      /exit /help /clear /stats /save /load /export /copy /reset /autotest /autoscan
//   │   ├── files.js        /scan /ls /tree /read /create /delete /rename /run
//   │   ├── settings.js     /mode /model /provider /token
//   │   ├── memory.js       /memory
//   │   ├── skills.js       /skill
//   │   ├── ai.js           /analyse /write /debug-fix /dashboard
//   │   └── connections.js  /connection /wa
//   └── commands.js         dispatchCommand router (thin)

module.exports = {
  ...require('./shell'),
  ...require('./session'),
  ...require('./files'),
  ...require('./settings'),
  ...require('./memory'),
  ...require('./skills'),
  ...require('./ai'),
  ...require('./connections'),
};

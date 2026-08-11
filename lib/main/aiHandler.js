'use strict';

// aiHandler.js — entry point.
//
// All the actual logic now lives in ./aiHandler/*.js, split by
// responsibility (tool running, directives, email, provider calls, system
// prompt, etc). This file just re-exports the public API so nothing that
// requires('../main/aiHandler') (or wherever this file is required from)
// needs to change.
module.exports = require('./aiHandler/index.js');

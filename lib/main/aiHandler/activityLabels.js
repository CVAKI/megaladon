'use strict';

// ─── Activity labels per mode — what the model is likely doing at each second ─
const ACTIVITY = {
  agent: [
    [0,  'reading your request'],
    [3,  'understanding the task'],
    [8,  'planning file structure'],
    [15, 'writing code'],
    [30, 'building full implementation'],
    [60, 'generating output'],
    [90, 'finalizing files'],
  ],
  code: [
    [0,  'reading your question'],
    [4,  'thinking through solution'],
    [12, 'writing the code'],
    [30, 'reviewing the logic'],
    [60, 'finalizing response'],
  ],
  debug: [
    [0,  'reading the error'],
    [3,  'tracing the issue'],
    [8,  'identifying root cause'],
    [18, 'building the fix'],
    [40, 'verifying solution'],
  ],
  architect: [
    [0,  'reading the requirements'],
    [4,  'designing the system'],
    [12, 'planning architecture'],
    [25, 'detailing components'],
    [50, 'writing diagrams'],
  ],
  review: [
    [0,  'reading the code'],
    [4,  'analysing quality'],
    [10, 'checking edge cases'],
    [20, 'writing feedback'],
  ],
  explain: [
    [0,  'reading the topic'],
    [4,  'building explanation'],
    [12, 'adding examples'],
    [25, 'simplifying language'],
  ],
  plan: [
    [0,  'reading the goal'],
    [4,  'breaking down tasks'],
    [12, 'ordering priorities'],
    [25, 'writing the plan'],
  ],
};

function getActivityLabel(mode, elapsedSec) {
  const steps = ACTIVITY[mode] || ACTIVITY.code;
  let label = steps[0][1];
  for (const [sec, lbl] of steps) {
    if (elapsedSec >= sec) label = lbl; else break;
  }
  return label;
}

module.exports = { ACTIVITY, getActivityLabel };

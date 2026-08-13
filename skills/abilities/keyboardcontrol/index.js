'use strict';

/**
 * skills/abilities/keyboardcontrol/index.js
 *
 * Real keyboard control — type free text, press a single named key,
 * or press a key combo (e.g. ctrl+c). Powered by @nut-tree-fork/nut-js.
 */

const { keyboard, Key } = require('@nut-tree-fork/nut-js');

keyboard.config.autoDelayMs = 25; // small delay between keystrokes so apps register them

const KEY_MAP = {
  enter: Key.Enter, return: Key.Enter, tab: Key.Tab,
  esc: Key.Escape, escape: Key.Escape,
  backspace: Key.Backspace, delete: Key.Delete, del: Key.Delete,
  space: Key.Space, spacebar: Key.Space,
  up: Key.Up, down: Key.Down, left: Key.Left, right: Key.Right,
  ctrl: Key.LeftControl, control: Key.LeftControl,
  alt: Key.LeftAlt,
  shift: Key.LeftShift,
  cmd: Key.LeftSuper, win: Key.LeftSuper, windows: Key.LeftSuper, meta: Key.LeftSuper, super: Key.LeftSuper,
  home: Key.Home, end: Key.End,
  pageup: Key.PageUp, pagedown: Key.PageDown,
  capslock: Key.CapsLock,
};
for (let i = 1; i <= 12; i++) KEY_MAP['f' + i] = Key['F' + i];
for (const c of 'abcdefghijklmnopqrstuvwxyz') KEY_MAP[c] = Key[c.toUpperCase()];
for (const n of '0123456789') KEY_MAP[n] = Key['Num' + n];

function resolveKey(name) {
  const k = KEY_MAP[String(name).toLowerCase().trim()];
  if (!k) throw new Error('Unknown key name: "' + name + '"');
  return k;
}

async function type(text) {
  if (typeof text !== 'string' || !text.length) throw new Error('keyboard.type requires non-empty text');
  await keyboard.type(text);
  return { typed: text };
}

async function pressKey(name) {
  const k = resolveKey(name);
  await keyboard.pressKey(k);
  await keyboard.releaseKey(k);
  return { pressed: name };
}

async function combo(keys) {
  if (!Array.isArray(keys) || !keys.length) throw new Error('keyboard.combo requires a non-empty array of key names');
  const resolved = keys.map(resolveKey);
  await keyboard.pressKey(...resolved);
  await keyboard.releaseKey(...resolved);
  return { combo: keys };
}

module.exports = { type, pressKey, combo };
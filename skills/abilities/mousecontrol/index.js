'use strict';

/**
 * skills/abilities/mousecontrol/index.js
 *
 * Real mouse control — move, click (left/right/middle), double-click,
 * scroll, drag. Powered by @nut-tree-fork/nut-js (actively maintained
 * fork of robotjs-style desktop automation, no python/node-gyp needed).
 */

const { mouse, Point, Button, straightTo } = require('@nut-tree-fork/nut-js');

mouse.config.mouseSpeed = 1200; // px/sec — fast but still visible/human-ish

function resolveButton(name) {
  const n = String(name || 'left').toLowerCase();
  if (n === 'right')  return Button.RIGHT;
  if (n === 'middle') return Button.MIDDLE;
  return Button.LEFT;
}

async function moveTo(x, y) {
  if (typeof x !== 'number' || typeof y !== 'number') {
    throw new Error('mouse.moveTo requires numeric x,y');
  }
  await mouse.setPosition(new Point(x, y));
  return { x, y };
}

async function clickAt(x, y, button) {
  if (typeof x === 'number' && typeof y === 'number') await moveTo(x, y);
  await mouse.click(resolveButton(button));
  const pos = await mouse.getPosition();
  return { clicked: true, button: button || 'left', at: pos };
}

async function doubleClickAt(x, y) {
  if (typeof x === 'number' && typeof y === 'number') await moveTo(x, y);
  await mouse.doubleClick(Button.LEFT);
  const pos = await mouse.getPosition();
  return { doubleClicked: true, at: pos };
}

async function scroll(direction, amount) {
  const amt = Number(amount) || 5;
  const dir = String(direction || 'down').toLowerCase();
  if (dir === 'up')          await mouse.scrollUp(amt);
  else if (dir === 'down')   await mouse.scrollDown(amt);
  else if (dir === 'left')   await mouse.scrollLeft(amt);
  else if (dir === 'right')  await mouse.scrollRight(amt);
  else throw new Error('scroll direction must be up|down|left|right');
  return { scrolled: dir, amount: amt };
}

async function dragTo(fromX, fromY, toX, toY) {
  [fromX, fromY, toX, toY].forEach(v => {
    if (typeof v !== 'number') throw new Error('mouse.drag requires numeric fromX,fromY,toX,toY');
  });
  await moveTo(fromX, fromY);
  await mouse.pressButton(Button.LEFT);
  await mouse.move(straightTo(new Point(toX, toY)));
  await mouse.releaseButton(Button.LEFT);
  return { dragged: true, from: { x: fromX, y: fromY }, to: { x: toX, y: toY } };
}

async function getPosition() {
  return mouse.getPosition();
}

module.exports = { moveTo, clickAt, doubleClickAt, scroll, dragTo, getPosition };
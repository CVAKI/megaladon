'use strict';

/**
 * skills/abilities/mousecontrol/index.js
 *
 * Real mouse control — move, click (left/right/middle), double-click,
 * scroll, drag. Powered by @nut-tree-fork/nut-js (actively maintained
 * fork of robotjs-style desktop automation, no python/node-gyp needed).
 */

const { mouse, Point, Button, straightTo, screen } = require('@nut-tree-fork/nut-js');

mouse.config.mouseSpeed = 1200; // px/sec — fast but still visible/human-ish

// ─── Coordinate-space scaling ──────────────────────────────────────────────
// The AI always gives (x,y) in the SCREENSHOT's pixel space (that's what it
// was shown and told the dimensions of). nut-js moves the mouse in the OS's
// own coordinate space, which is a DIFFERENT number whenever display scaling
// isn't 100% — 125%/150% scaling is extremely common on Windows laptops.
// Without this conversion, "click the button at (500,300) in the
// screenshot" silently lands somewhere else on the real screen — this was
// the actual cause of clicks/typing appearing to do nothing.
let _monitorScreen = null;
function getMonitorScreen() {
  if (_monitorScreen) return _monitorScreen;
  try { _monitorScreen = require('../monitorscreen'); } catch (_) { _monitorScreen = null; }
  return _monitorScreen;
}

async function resolveCoords(x, y) {
  try {
    const ms = getMonitorScreen();
    const shot = ms && ms.getLastScreenshotInfo ? ms.getLastScreenshotInfo() : null;
    if (!shot || !shot.width || !shot.height) return { x, y }; // no screenshot taken yet — nothing to scale against

    const nutW = await screen.width();
    const nutH = await screen.height();
    if (!nutW || !nutH) return { x, y };

    // Same space already (most non-scaled displays) — skip the math.
    if (Math.abs(nutW - shot.width) < 2 && Math.abs(nutH - shot.height) < 2) return { x, y };

    const scaleX = nutW / shot.width;
    const scaleY = nutH / shot.height;
    return { x: Math.round(x * scaleX), y: Math.round(y * scaleY) };
  } catch (_) {
    return { x, y }; // any failure here — fall back to raw coords rather than throwing
  }
}

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
  const resolved = await resolveCoords(x, y);
  // Was mouse.setPosition() — that snaps the cursor instantly with no
  // visible path, which looked like "teleporting" rather than movement.
  // mouse.move(straightTo(...)) animates along a path at mouse.config.mouseSpeed
  // (1200px/sec, set above) so the cursor visibly glides like a real move.
  await mouse.move(straightTo(new Point(resolved.x, resolved.y)));
  // Report both: the screenshot-space coords the AI asked for, and the
  // actual OS coords the mouse physically went to, so a mismatch is visible
  // in the ability result instead of silently hidden.
  return { x, y, movedTo: resolved };
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
  const resolvedTo = await resolveCoords(toX, toY);
  await mouse.pressButton(Button.LEFT);
  await mouse.move(straightTo(new Point(resolvedTo.x, resolvedTo.y)));
  await mouse.releaseButton(Button.LEFT);
  return { dragged: true, from: { x: fromX, y: fromY }, to: { x: toX, y: toY, movedTo: resolvedTo } };
}

async function getPosition() {
  return mouse.getPosition();
}

module.exports = { moveTo, clickAt, doubleClickAt, scroll, dragTo, getPosition };
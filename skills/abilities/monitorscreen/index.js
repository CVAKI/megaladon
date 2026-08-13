'use strict';

/**
 * skills/abilities/monitorscreen/index.js
 *
 * Real screen "vision" for Megaladon — takes a screenshot and sends it to
 * a local Ollama multimodal model (llava / bakllava / llama3.2-vision /
 * moondream) to get back a text description. Also supports polling a
 * screen (e.g. a dashboard) against a natural-language instruction and
 * firing a callback when something noteworthy happens.
 */

const http = require('http');
const https = require('https');
const screenshot = require('screenshot-desktop');
const ollamaSetup = require('../ollamaSetup');

const OLLAMA_HOST  = process.env.OLLAMA_HOST || 'http://localhost:11434';
const VISION_MODEL = process.env.MEG_VISION_MODEL || 'llava';

async function captureScreen() {
  // Returns a PNG Buffer of the primary display.
  const buf = await screenshot({ format: 'png' });
  return buf;
}

// Read width/height straight out of the PNG IHDR chunk (bytes 16-23) — no
// extra dependency needed just to know the screenshot's resolution.
function readPngDimensions(buf) {
  try {
    return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
  } catch (_) {
    return { width: null, height: null };
  }
}

function callOllamaVision(prompt, base64Image, model) {
  return new Promise((resolve, reject) => {
    let url;
    try { url = new URL('/api/generate', OLLAMA_HOST); }
    catch (e) { return reject(new Error('Invalid OLLAMA_HOST: ' + OLLAMA_HOST)); }

    const body = JSON.stringify({
      model: model || VISION_MODEL,
      prompt,
      images: [base64Image],
      stream: false,
    });

    const lib = url.protocol === 'https:' ? https : http;
    const req = lib.request(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
      timeout: 60000,
    }, res => {
      let raw = '';
      res.on('data', d => { raw += d; });
      res.on('end', () => {
        try {
          const json = JSON.parse(raw);
          if (json.error) return reject(new Error(json.error));
          resolve(json.response || '');
        } catch (e) {
          reject(new Error('Ollama returned non-JSON (is the vision model pulled? try: ollama pull ' + (model || VISION_MODEL) + ') — ' + raw.slice(0, 200)));
        }
      });
    });
    req.on('timeout', () => { req.destroy(); reject(new Error('Ollama vision request timed out after 60s')); });
    req.on('error', err => reject(new Error('Could not reach Ollama at ' + OLLAMA_HOST + ' — is `ollama serve` running? (' + err.message + ')')));
    req.write(body);
    req.end();
  });
}

// Appended to every screen.describe call (default or custom prompt) so the
// model driving mouse.click ALWAYS gets real coordinates to aim at instead
// of guessing a random point like (100,100). Without this, the text model
// has nothing but prose to work with and every click is a blind guess.
function coordinateInstruction(width, height) {
  if (!width || !height) return '';
  return '\n\nThe screenshot is exactly ' + width + 'x' + height + ' pixels, origin (0,0) at the ' +
      'top-left corner. After your description, list every clickable element that is relevant ' +
      '(buttons, links, search bars, icons, menu items, image thumbnails) as one line each in ' +
      'EXACTLY this format:\nELEMENT: <short name> AT (x,y)\n' +
      'Give your best-estimate pixel coordinates for the CENTER of each element based on its ' +
      'position in the image — do not skip this list, and do not invent elements that are not ' +
      'actually visible.';
}

async function describeScreen(prompt) {
  // Auto-heals, in order: Ollama not installed → not running → model not
  // pulled. No-op (instant) once everything's already ready. This is the
  // one call site every screen ability routes through, so fixing it here
  // covers screen.describe and screen.watch.start alike.
  await ollamaSetup.ensureModel(VISION_MODEL);

  const buf = await captureScreen();
  const { width, height } = readPngDimensions(buf);
  const b64 = buf.toString('base64');
  const basePrompt = prompt && prompt.trim()
      ? prompt.trim()
      : 'Describe exactly what is visible on this computer screen right now: open windows/apps, ' +
      'visible text, buttons, and anything notable. Be specific and concise.';
  const askPrompt = basePrompt + coordinateInstruction(width, height);
  const description = await callOllamaVision(askPrompt, b64);
  return description.trim();
}

/**
 * Poll the screen on an interval, ask the vision model whether the given
 * instruction's trigger condition is currently true, and call onEvent()
 * with { triggered, reason, raw, at } each time.
 *
 * Example: startWatch(
 *   'alert if any metric or graph on this dashboard turns red or shows an error state',
 *   { intervalMs: 30000 },
 *   (event) => { if (event.triggered) notifyOwner(event.reason); }
 * );
 */
function startWatch(instruction, opts, onEvent) {
  if (!instruction) throw new Error('startWatch requires an instruction string');
  if (typeof onEvent !== 'function') throw new Error('startWatch requires an onEvent callback');

  const intervalMs = (opts && opts.intervalMs) || 30000;
  let stopped = false;
  let running = false;

  async function tick() {
    if (stopped || running) return;
    running = true;
    try {
      const prompt =
          'You are monitoring a screen/dashboard for a specific condition.\n' +
          'Condition to check: "' + instruction + '"\n\n' +
          'Look at the current screenshot and answer in EXACTLY this format, nothing else:\n' +
          'TRIGGERED: yes|no\n' +
          'REASON: <one short sentence>';
      const answer = await describeScreen(prompt);
      const triggered = /TRIGGERED:\s*yes/i.test(answer);
      const reasonMatch = answer.match(/REASON:\s*(.+)/i);
      onEvent({
        triggered,
        reason: reasonMatch ? reasonMatch[1].trim() : answer,
        raw: answer,
        at: new Date().toISOString(),
      });
    } catch (err) {
      onEvent({ triggered: false, error: err.message, at: new Date().toISOString() });
    } finally {
      running = false;
    }
  }

  const timer = setInterval(tick, intervalMs);

  return {
    stop() { stopped = true; clearInterval(timer); },
    get stopped() { return stopped; },
  };
}

module.exports = { captureScreen, describeScreen, callOllamaVision, startWatch };
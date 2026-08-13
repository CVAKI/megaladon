'use strict';

/**
 * skills/abilities/ollamaSetup.js
 *
 * Fully automatic Ollama readiness check for the vision-powered abilities
 * (screen.describe / screen.watch). Handles, in order, whatever step is
 * actually missing:
 *
 *   1. Ollama not installed        → downloads + runs the official installer
 *   2. Ollama installed but not running → starts `ollama serve` in background
 *   3. Vision model not pulled     → `ollama pull <model>` with a live progress bar
 *
 * ensureModel() is idempotent and cheap after the first successful call
 * (cached in-memory per model name), so it's safe to call before every
 * screen ability without adding real overhead once warmed up.
 *
 * Pull resilience: Ollama's server already keeps partially-downloaded blobs
 * on disk between pull attempts — calling /api/pull again after a dropped
 * connection resumes from the bytes it already has, it does not restart
 * that layer from 0. pullModel() here just needs to (a) not throw away and
 * silently die on a mid-download network error, and (b) automatically call
 * pull again instead of forcing the person to manually retype the command.
 * That's what the retry loop below does — each retry re-opens the SAME
 * /api/pull request, and the very next progress event Ollama reports back
 * already reflects the resumed position (e.g. "60%" instead of restarting
 * at "0%"), so the progress bar naturally continues rather than resetting.
 */

const http = require('http');
const https = require('https');
const { spawn } = require('child_process');

const OLLAMA_HOST = process.env.OLLAMA_HOST || 'http://localhost:11434';

// ─── Minimal standalone ANSI helpers (no dependency on lib/colors — this ────
// skill stays fully self-contained, per the rest of this module's design) ───
const RESET  = '\x1b[0m';
const DIM    = '\x1b[2m';
const GREEN  = '\x1b[38;5;35m';
const CYAN   = '\x1b[38;5;51m';
const GRAY   = '\x1b[38;5;245m';
const YELLOW = '\x1b[38;5;220m';
const RED    = '\x1b[38;5;203m';

function formatBytes(n) {
    if (n === null || n === undefined || isNaN(n)) return '?';
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    let i = 0;
    let v = n;
    while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
    return (i === 0 ? v.toFixed(0) : v.toFixed(1)) + units[i];
}

function clearLine() {
    const w = process.stdout.columns || 80;
    process.stdout.write('\r' + ' '.repeat(w - 1) + '\r');
}

// width in characters of the bar itself (not counting brackets/labels)
function drawBar(pct, width = 28) {
    const p = Math.max(0, Math.min(100, pct));
    const filled = Math.round((p / 100) * width);
    return GREEN + '█'.repeat(filled) + GRAY + '░'.repeat(width - filled) + RESET;
}

function getJSON(pathName) {
    return new Promise((resolve, reject) => {
        let url;
        try { url = new URL(pathName, OLLAMA_HOST); } catch (e) { return reject(e); }
        const lib = url.protocol === 'https:' ? https : http;
        const req = lib.get(url, { timeout: 4000 }, res => {
            let raw = '';
            res.on('data', d => { raw += d; });
            res.on('end', () => { try { resolve(JSON.parse(raw)); } catch (e) { reject(e); } });
        });
        req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
        req.on('error', reject);
    });
}

async function isAvailable() {
    try { await getJSON('/api/tags'); return true; } catch (_) { return false; }
}

async function listModels() {
    try {
        const data = await getJSON('/api/tags');
        return (data.models || []).map(m => m.name);
    } catch (_) { return []; }
}

async function hasModel(modelName) {
    const models = await listModels();
    // Ollama tags carry a version suffix, e.g. "llava:latest" — match base name too
    return models.some(m => m === modelName || m.split(':')[0] === modelName.split(':')[0]);
}

// ─── Single pull attempt — resolves when the stream ends normally, rejects ───
// on any network/stream error so the retry wrapper below can catch it and
// re-open the request (which resumes rather than restarting, see header note).
function pullOnce(modelName, { attempt, maxRetries, speedState }) {
    return new Promise((resolve, reject) => {
        let url;
        try { url = new URL('/api/pull', OLLAMA_HOST); } catch (e) { return reject(e); }
        const body = JSON.stringify({ name: modelName, stream: true });
        const lib = url.protocol === 'https:' ? https : http;

        let settled = false;
        let lastStatus = '';
        let sawAnyProgress = false;

        const req = lib.request(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
        }, res => {
            res.on('data', chunk => {
                String(chunk).split('\n').filter(Boolean).forEach(line => {
                    try {
                        const obj = JSON.parse(line);
                        if (obj.error) {
                            if (!settled) { settled = true; clearLine(); reject(new Error(obj.error)); }
                            return;
                        }

                        const status = obj.status || '';

                        if (obj.total && obj.completed !== undefined) {
                            sawAnyProgress = true;
                            const now = Date.now();
                            // Instantaneous speed from the last progress tick, not an
                            // average from process start — so a resumed pull that jumps
                            // straight to e.g. 60% doesn't report a bogus huge speed.
                            const dBytes = obj.completed - (speedState.lastCompleted ?? obj.completed);
                            const dTime  = (now - (speedState.lastTime ?? now)) / 1000;
                            const instSpeed = dTime > 0.15 ? Math.max(0, dBytes / dTime) : speedState.lastSpeed || 0;
                            speedState.lastCompleted = obj.completed;
                            speedState.lastTime = now;
                            speedState.lastSpeed = instSpeed;

                            const pct = Math.min(100, (obj.completed / obj.total) * 100);
                            const bar = drawBar(pct);
                            const sizeStr  = formatBytes(obj.completed) + ' / ' + formatBytes(obj.total);
                            const speedStr = instSpeed > 0 ? formatBytes(instSpeed) + '/s' : '…';
                            const etaSec   = instSpeed > 0 ? Math.max(0, (obj.total - obj.completed) / instSpeed) : null;
                            const etaStr   = etaSec !== null ? ' · ETA ' + (etaSec < 60 ? Math.ceil(etaSec) + 's' : Math.ceil(etaSec / 60) + 'm') : '';
                            const digest   = obj.digest ? DIM + ' (' + obj.digest.replace('sha256:', '').slice(0, 8) + ')' + RESET : '';
                            const retryTag = attempt > 1 ? YELLOW + ' [resumed, attempt ' + attempt + '/' + maxRetries + ']' + RESET : '';

                            clearLine();
                            process.stdout.write(
                                '  ' + CYAN + '⬇' + RESET + ' ' + modelName + digest + '  ' +
                                bar + '  ' + Math.round(pct) + '%  ' +
                                DIM + sizeStr + ' · ' + speedStr + etaStr + RESET + retryTag
                            );
                        } else if (status && status !== lastStatus) {
                            clearLine();
                            process.stdout.write('  ' + CYAN + '⬇' + RESET + ' ' + modelName + '  ' + DIM + status + '...' + RESET);
                            lastStatus = status;
                        }
                    } catch (_) { /* ignore malformed line, keep streaming */ }
                });
            });

            res.on('end', () => {
                if (settled) return;
                settled = true;
                clearLine();
                if (sawAnyProgress || lastStatus === 'success') {
                    console.log('  ' + GREEN + '✔' + RESET + ' ' + modelName + '  ' + drawBar(100) + '  100%  ' + DIM + 'done' + RESET);
                }
                resolve(true);
            });

            res.on('error', err => {
                if (settled) return;
                settled = true;
                reject(err); // mid-stream network drop — retry wrapper will resume
            });
        });

        req.on('error', err => {
            if (settled) return;
            settled = true;
            reject(new Error('Cannot reach Ollama to pull model: ' + err.message));
        });

        req.write(body);
        req.end();
    });
}

// ─── Retry wrapper — resumes automatically on a dropped connection instead ───
// of leaving the person stuck (or worse, restarting the download from zero).
async function pullModel(modelName, opts = {}) {
    const maxRetries = opts.maxRetries ?? 5;
    const speedState = {}; // shared across retries so the bar doesn't reset visually

    let attempt = 0;
    while (true) {
        attempt++;
        try {
            const result = await pullOnce(modelName, { attempt, maxRetries, speedState });
            return result;
        } catch (err) {
            if (attempt > maxRetries) {
                clearLine();
                console.log('  ' + RED + '✘ pull failed after ' + maxRetries + ' attempts: ' + err.message + RESET);
                throw err;
            }
            const waitMs = Math.min(1500 * attempt, 12000);
            clearLine();
            console.log(
                '  ' + YELLOW + '⚠ connection interrupted' + RESET + DIM +
                ' — retrying in ' + Math.round(waitMs / 1000) + 's (attempt ' + (attempt + 1) + '/' + (maxRetries + 1) +
                ') — resuming from where it left off, not restarting...' + RESET
            );
            await new Promise(r => setTimeout(r, waitMs));
        }
    }
}

async function startServer() {
    try {
        const isWin = process.platform === 'win32';
        const child = spawn('ollama', ['serve'],
            isWin ? { detached: true, stdio: 'ignore', shell: true } : { detached: true, stdio: 'ignore' });
        child.unref();
    } catch (_) {
        return false; // `ollama` binary not on PATH — caller falls through to installOllama()
    }
    for (let i = 0; i < 20; i++) {
        await new Promise(r => setTimeout(r, 1000));
        if (await isAvailable()) return true;
    }
    return false;
}

function installOllama() {
    const platform = process.platform;
    console.log('  [abilities] Ollama not found — installing it automatically...');
    return new Promise((resolve, reject) => {
        let proc;
        if (platform === 'win32') {
            const ps = [
                '$p="$env:TEMP\\OllamaSetup.exe";',
                'Invoke-WebRequest -Uri "https://ollama.com/download/OllamaSetup.exe" -OutFile $p;',
                'Start-Process -FilePath $p -ArgumentList "/S" -Wait;',
            ].join(' ');
            proc = spawn('powershell', ['-NoProfile', '-NonInteractive', '-Command', ps], { stdio: 'inherit' });
        } else {
            proc = spawn('sh', ['-c', 'curl -fsSL https://ollama.com/install.sh | sh'], { stdio: 'inherit' });
        }
        proc.on('close', code => code === 0 ? resolve(true) : reject(new Error('Ollama installer exited with code ' + code)));
        proc.on('error', err => reject(new Error('Could not run Ollama installer: ' + err.message)));
    });
}

// Cache per model name so this only does real work once per process lifetime.
const _ensured = {};

async function ensureModel(modelName) {
    if (_ensured[modelName]) return true;

    let up = await isAvailable();

    if (!up) {
        console.log('  [abilities] Ollama server not reachable — starting it...');
        up = await startServer();
    }

    if (!up) {
        try {
            await installOllama();
            up = await startServer();
        } catch (e) {
            throw new Error(
                'Ollama is not installed and auto-install failed: ' + e.message +
                '\n  Install it manually from https://ollama.com/download and try again.'
            );
        }
    }

    if (!up) {
        throw new Error('Could not start Ollama automatically. Run `ollama serve` manually and try again.');
    }

    const has = await hasModel(modelName);
    if (!has) {
        console.log('  [abilities] vision model "' + modelName + '" not found — pulling it now (first time only, may take a few minutes)...');
        await pullModel(modelName);
    }

    _ensured[modelName] = true;
    return true;
}

module.exports = { isAvailable, listModels, hasModel, pullModel, startServer, installOllama, ensureModel };
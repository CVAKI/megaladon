'use strict';

const fs   = require('fs');
const path = require('path');

const { wh, cr, kp, ab, sd, dg, vt, tl } = require('../../colors');
const { saveConfig, parseMemoryBlocks }   = require('../../config');
const { formatMD, spinner }               = require('../../render');
const { CWD, readFileSafe, formatSize,
        parseFileBlocks, applyFileBlocks,
        printFileResults, scanFolder,
        buildFolderContext }              = require('../../filesystem');
const { selfTestLoop, saveMemory }        = require('../../selftest');
const { saveMemory: _saveMemory, updateMemory } = require('../../config');
const { callAI }                          = require('../../providers');
const { startDashboard }                  = require('../../dashboard');
const { MODES }                           = require('../../modes');
const { stripFileBlocks, buildSystemPrompt } = require('../utils');

// ─── /analyse ─────────────────────────────────────────────────────────────────
async function handleAnalyse(text, ctx) {
  if (ctx.mode !== 'review') {
    ctx.mode = 'review';
    saveConfig({ provider: ctx.providerKey, apiKey: ctx.apiKey, model: ctx.modelId, mode: ctx.mode, autoTest: ctx.autoTest, autoScan: ctx.autoScan });
    ctx.statusRef.mode = ctx.mode;
    console.log('\n  ' + MODES['review'].colorFn('⟳ Auto-switched to ' + MODES['review'].icon + ' ' + MODES['review'].name) + ab(' (code review intent detected)'));
  }

  const fp         = text.replace(/^\/analy[sz]e\s+/, '').trim().replace(/^["']|["']$/g, '');
  const candidates = [fp, path.join('src', fp), path.join('lib', fp)];
  let resolvedFp   = fp, fileFound = false;
  for (const candidate of candidates) {
    try { readFileSafe(candidate); resolvedFp = candidate; fileFound = true; break; } catch (_) {}
  }
  if (!fileFound) {
    console.log('\n  ' + dg('✘ File not found: ') + sd(fp));
    console.log('  ' + ab('  Hint: use the full path, e.g. ') + sd('src/' + fp) + ab(' or /ls to browse'));
    ctx.prompt(); return true;
  }

  try {
    const file   = readFileSafe(resolvedFp);
    const kb     = (file.size / 1024).toFixed(1);
    console.log('\n  ' + kp('Analysing: ') + sd(file.name) + ab(' (' + kb + 'KB)'));
    const userMsg = `Analyse this file in detail:\n\nFile: ${resolvedFp} | Extension: .${file.ext} | Size: ${kb}KB | Lines: ${file.content.split('\n').length}\n\n\`\`\`${file.ext}\n${file.content}\n\`\`\`\n\nProvide: purpose, architecture, quality assessment (1-10), issues found, and improvement suggestions.`;
    ctx.messages.push({ role: 'user', content: userMsg }); ctx.msgN++;
    console.log('');
    const sp   = spinner('Analysing ' + file.name + '...');
    const t1   = Date.now();
    const allMs = [{ role: 'system', content: buildSystemPrompt(ctx) }, ...ctx.messages];
    const data  = await callAI(ctx.providerKey, ctx.apiKey, ctx.modelId, allMs);
    sp.stop();
    const reply = data.choices?.[0]?.message?.content || data?.content?.[0]?.text || '';
    ctx.messages.push({ role: 'assistant', content: reply }); ctx.lastReply = reply;
    if (data.usage) ctx.totalTok += data.usage.total_tokens || 0;
    const blocks = parseFileBlocks(reply);
    if (blocks.length) {
      console.log('\n  ' + vt('AI wants to modify ' + blocks.length + ' file(s):'));
      blocks.forEach(bk => console.log('  ' + ab('  → ') + sd(bk.relPath)));
      const conf = await ctx.ask(cr('\n  ❯ ') + ab('Apply files? [Y/n]: '));
      const ans2 = conf.trim().toLowerCase();
      if (ans2 === '' || ans2 === 'y' || ans2 === 'yes') printFileResults(applyFileBlocks(blocks));
      else console.log('  ' + ab('Skipped.'));
    }
    const memBlocks = parseMemoryBlocks(reply);
    if (memBlocks.length) { updateMemory(ctx.mem, memBlocks); _saveMemory(ctx.mem); }
    console.log('\n  ' + wh('🦈 Megaladon') + '  ' + ab(((Date.now() - t1) / 1000).toFixed(1) + 's · ' + ctx.totalTok.toLocaleString() + ' tokens'));
    console.log('');
    console.log(formatMD(stripFileBlocks(reply)));
  } catch (err) { console.log('\n  ' + dg('✘ ' + err.message)); }
  ctx.prompt(); return true;
}

// ─── /write ───────────────────────────────────────────────────────────────────
async function handleWrite(text, ctx) {
  const fp   = text.slice(7).trim().replace(/^["']|["']$/g, '');
  const what = await ctx.ask(cr('  ❯ ') + ab('Describe what to write into ' + fp + ': '));
  const isHtmlWrite = /\.(html?|css)$/i.test(fp);
  const writeSpec = isHtmlWrite
    ? '\n\n[WRITE SPEC \u2014 MANDATORY]\nThis is a web file. Write a COMPLETE, production-grade implementation.\nMinimum 700 lines. Include: CSS variables, animations (keyframes + transitions), responsive design,\nhover effects on all interactive elements, JS interactivity, modern color palette with gradients.\nDo NOT truncate. Do NOT use placeholders. Write every single line.'
    : '\n\n[WRITE SPEC \u2014 MANDATORY]\nWrite the COMPLETE file. No placeholders, no TODOs, no truncation.\nFull error handling, proper structure, comprehensive implementation.';
  ctx.messages.push({ role: 'user', content: 'Write complete content for `' + fp + '`.\n' + what + writeSpec + '\nOutput using @@FILE/@@END format.' }); ctx.msgN++;
  console.log('');
  const sp    = spinner('Generating ' + fp + '...');
  const t1    = Date.now();
  try {
    const allMs = [{ role: 'system', content: buildSystemPrompt(ctx) }, ...ctx.messages];
    const data  = await callAI(ctx.providerKey, ctx.apiKey, ctx.modelId, allMs);
    sp.stop();
    const reply  = data.choices?.[0]?.message?.content || data?.content?.[0]?.text || '';
    ctx.messages.push({ role: 'assistant', content: reply }); ctx.lastReply = reply;
    if (data.usage) ctx.totalTok += data.usage.total_tokens || 0;
    const blocks  = parseFileBlocks(reply);
    let applied   = [];
    if (blocks.length) {
      applied = applyFileBlocks(blocks);
      printFileResults(applied);
      if (ctx.autoTest) {
        const tr = await selfTestLoop(ctx.providerKey, ctx.apiKey, ctx.modelId, ctx.messages, applied, 3);
        if (tr.tested) console.log('\n  ' + (tr.passed ? kp('✔ Self-Test PASSED') : dg('✘ Self-Test FAILED after ' + tr.iterations + ' attempts')));
      }
    }
    console.log('\n  ' + wh('🦈 Megaladon') + '  ' + ab(((Date.now() - t1) / 1000).toFixed(1) + 's · ' + ctx.totalTok.toLocaleString() + ' tokens'));
    console.log(''); console.log(formatMD(stripFileBlocks(reply)));
  } catch (err) { sp.stop(); console.log('\n  ' + dg('✘ ' + err.message)); }
  ctx.prompt(); return true;
}

// ─── /debug -fix ──────────────────────────────────────────────────────────────
async function handleDebugFix(text, ctx) {
  const { callAI: _callAI }                             = require('../../providers');
  const { exec: _exec }                                 = require('child_process');

  const parts    = text.trim().split(/\s+/);
  const fileHint = parts[2] || null;

  console.log('\n  ' + cr('🔬 /debug -fix') + ab('  — scan → analyse → install → fix → run'));
  console.log('');

  console.log('  ' + wh('⟳') + ' ' + ab('Scanning project...'));
  const scanned = await scanFolder(CWD());
  ctx.folderCtx = buildFolderContext(scanned);
  console.log('  ' + kp('✔') + ' ' + ab('Scanned: ') + sd(String(scanned.length)) + ab(' file(s)'));

  let targetFile = fileHint;
  if (!targetFile) {
    const ALL_EXTS = new Set([
      '.js', '.mjs', '.cjs', '.ts', '.tsx', '.jsx',
      '.py', '.rb', '.go', '.php', '.rs', '.java',
      '.c', '.cpp', '.cc', '.cs', '.swift', '.kt',
      '.sh', '.bash', '.zsh', '.ps1', '.bat', '.cmd',
      '.json', '.yaml', '.yml', '.toml', '.env', '.ini', '.cfg', '.xml', '.csv',
      '.md', '.txt', '.pdf', '.docx', '.doc', '.xlsx', '.xls', '.pptx',
      '.html', '.htm', '.css', '.scss', '.sass', '.vue', '.svelte',
      '.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.ico', '.bmp', '.tiff',
      '.mp4', '.mkv', '.mov', '.avi', '.mp3', '.wav', '.flac', '.ogg',
      '.zip', '.tar', '.gz', '.rar', '.7z',
      '.sqlite', '.db', '.log', '.lock',
    ]);
    const allFiles = scanned
      .filter(f => f.path && ALL_EXTS.has(path.extname(f.path).toLowerCase()))
      .map(f => {
        const full2 = path.resolve(CWD(), f.path);
        try { return { rel: f.path, ext: path.extname(f.path).toLowerCase(), mtime: fs.statSync(full2).mtimeMs }; }
        catch(_) { return { rel: f.path, ext: path.extname(f.path).toLowerCase(), mtime: 0 }; }
      })
      .sort((a, b) => b.mtime - a.mtime);
    targetFile = allFiles[0] ? allFiles[0].rel : null;
  }

  if (!targetFile) {
    console.log('  ' + dg('✘ No code file found. Usage: /debug -fix <file>  (supports .js .ts .py .rb .go .php .sh ...)'));
    ctx.prompt(); return true;
  }

  console.log('  ' + ab('Target: ') + sd(targetFile));
  const fullPath = path.resolve(CWD(), targetFile);

  if (!fs.existsSync(fullPath)) {
    console.log('  ' + dg('✘ File not found: ') + sd(targetFile));
    ctx.prompt(); return true;
  }

  const MAX_ROUNDS = 4;
  let round = 0;
  const builtinsSet = new Set(['fs','path','http','https','os','child_process','util','events',
    'stream','buffer','crypto','url','querystring','readline','assert','net','tls',
    'zlib','dns','cluster','worker_threads','vm','module','process','timers']);

  const fileExt = path.extname(targetFile).toLowerCase();
  const CODE_EXTS = new Set([
    '.js','.mjs','.cjs','.jsx','.ts','.tsx',
    '.py','.rb','.go','.php','.rs','.java',
    '.c','.cpp','.cc','.cs','.swift','.kt',
    '.sh','.bash','.zsh','.ps1','.bat','.cmd',
  ]);
  const RUNNERS = {
    '.js': 'node', '.mjs': 'node', '.cjs': 'node', '.jsx': 'node',
    '.ts': 'ts-node', '.tsx': 'ts-node',
    '.py': 'python',
    '.rb': 'ruby',
    '.go': 'go run',
    '.php': 'php',
    '.rs': null, '.java': null, '.cs': null, '.swift': null, '.kt': null,
    '.sh': 'bash', '.bash': 'bash', '.zsh': 'bash',
    '.ps1': 'powershell -File',
    '.bat': null, '.cmd': null,
  };
  const isCodeFile = CODE_EXTS.has(fileExt);
  const runner = isCodeFile ? (RUNNERS[fileExt] !== undefined ? RUNNERS[fileExt] : 'node') : null;

  if (!isCodeFile) {
    console.log('  ' + ab('ℹ Non-executable file type ') + sd(fileExt) + ab(' — switching to AI analysis mode'));
  }

  const tryRun = () => new Promise(res => {
    if (!runner) {
      const reason = !isCodeFile
        ? 'Non-executable file (' + fileExt + ') — AI will analyse and suggest fixes.'
        : 'Compiled language (' + fileExt + ') — needs build step. AI will check for errors.';
      return res({ code: 1, stdout: '', stderr: reason });
    }
    _exec(runner + ' ' + JSON.stringify(fullPath), { timeout: 15000, cwd: CWD(), shell: true },
      (err, stdout, stderr) => res({ code: err ? (err.code || 1) : 0, stdout: stdout || '', stderr: stderr || '' }));
  });

  while (round < MAX_ROUNDS) {
    round++;
    console.log('\n  ' + wh('▶') + ' ' + ab('Run attempt #' + round + '...'));
    const result = await tryRun();

    if (result.code === 0) {
      const preview = result.stdout.trim().split('\n').slice(0, 3).join(' │ ').slice(0, 140);
      console.log('  ' + kp('✔ Running!') + (preview ? ab('  ' + preview) : ''));
      console.log('');
      ctx.prompt(); return true;
    }

    const errText = (result.stderr + '\n' + result.stdout).trim();
    console.log('  ' + dg('✘ Error (round ' + round + ')'));
    errText.split('\n').slice(0, 6).forEach(l => console.log('  ' + ab('  │ ') + dg(l)));

    const modRe2 = /Cannot find module '([^']+)'/g;
    const toInstall2 = new Set();
    let m3;
    while ((m3 = modRe2.exec(errText)) !== null) {
      const name = m3[1];
      if (name.startsWith('.') || name.startsWith('/')) continue;
      const pkg = name.startsWith('@') ? name.split('/').slice(0,2).join('/') : name.split('/')[0];
      if (!builtinsSet.has(pkg)) toInstall2.add(pkg);
    }
    if (toInstall2.size) {
      const pkgs2 = [...toInstall2];
      console.log('  ' + wh('⬇') + ' ' + ab('Installing: ') + sd(pkgs2.join(', ')) + ab('...'));
      const ok = await new Promise(res2 => {
        _exec('npm install ' + pkgs2.join(' ') + ' --save', { timeout: 90000, cwd: CWD(), shell: true },
          err2 => {
            if (err2) { console.log('  ' + dg('✘ npm install failed')); res2(false); }
            else       { console.log('  ' + kp('✔ Installed: ') + sd(pkgs2.join(', '))); res2(true); }
          });
      });
      if (ok) { round--; continue; }
    }

    if (round >= MAX_ROUNDS) break;

    console.log('  ' + wh('🤖') + ' ' + ab('Asking AI to fix (round ' + round + '/' + MAX_ROUNDS + ')...'));
    const fileContent = fs.readFileSync(fullPath, 'utf8');
    const fixPrompt = [
      'The file `' + targetFile + '` fails with this error:\n\n```\n' + errText.slice(0, 2000) + '\n```',
      '\nCurrent file:\n```js\n' + fileContent.slice(0, 6000) + '\n```',
      '\nFix the error. Return the corrected file using EXACTLY this format:',
      '@@FILE: ' + targetFile,
      '```js',
      '...corrected full file content...',
      '```',
      '@@END',
      '\nRules: keep npm packages that are in use (they will be auto-installed). Fix only what is broken. Return the complete file.',
    ].join('\n');

    let fixReply = '';
    try {
      const stream = await _callAI(ctx.providerKey, ctx.apiKey, ctx.modelId,
        [{ role: 'user', content: buildSystemPrompt(ctx) + '\n\n' + fixPrompt }],
        { maxTokens: ctx.maxTokens || 8192 });
      if (stream && typeof stream[Symbol.asyncIterator] === 'function') {
        process.stdout.write('  ');
        for await (const chunk of stream) { fixReply += chunk; process.stdout.write('.'); }
        process.stdout.write('\n');
      } else { fixReply = typeof stream === 'string' ? stream : JSON.stringify(stream); }
    } catch (aiErr) {
      console.log('  ' + dg('✘ AI call failed: ' + (aiErr.message || aiErr))); break;
    }

    const blocks = parseFileBlocks(fixReply);
    if (blocks.length) {
      const written = applyFileBlocks(blocks, CWD());
      printFileResults(written);
    } else {
      const rawMatch = fixReply.match(/```(?:js|javascript)?\n([\s\S]+?)```/);
      if (rawMatch) {
        fs.writeFileSync(fullPath, rawMatch[1].trim(), 'utf8');
        console.log('  ' + kp('✔ Applied fix to ') + sd(targetFile));
      } else {
        console.log('  ' + dg('✘ AI returned no file block. Fix manually.')); break;
      }
    }
  }

  if (round >= MAX_ROUNDS) {
    console.log('\n  ' + dg('✘ Max rounds (' + MAX_ROUNDS + ') reached. Check error above.'));
  }

  console.log('');
  ctx.prompt(); return true;
}

// ─── /dashboard ───────────────────────────────────────────────────────────────
async function handleDashboard(text, ctx) {
  const portArg = parseInt(text.split(/\s+/)[1]) || 7070;
  ctx.statusRef.mode = ctx.mode; ctx.statusRef.model = ctx.modelId || ''; ctx.statusRef.msgCount = ctx.msgN;
  startDashboard(portArg, null, ctx.mem, ctx.messages, ctx.statusRef, require('../constants').VERSION);
  ctx.prompt(); return true;
}

module.exports = { handleAnalyse, handleWrite, handleDebugFix, handleDashboard };
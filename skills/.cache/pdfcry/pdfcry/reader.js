'use strict';

/**
 * pdfcry/reader.js — Core PDF extraction engine
 * ───────────────────────────────────────────────
 * Primary:  pdf-parse (npm)
 * Fallback: raw binary text scraping (no deps)
 *
 * Install pdf-parse for best results:
 *   npm install pdf-parse      (in the plugin dir, or globally)
 */

const fs   = require('fs');
const path = require('path');

// ─── Try to load pdf-parse ────────────────────────────────────────────────────
function tryLoadPdfParse() {
  // Look in plugin dir node_modules first, then global
  const candidates = [
    path.join(__dirname, '..', 'node_modules', 'pdf-parse'),
    'pdf-parse',
  ];
  for (const c of candidates) {
    try { return require(c); } catch (_) {}
  }
  return null;
}

// ─── Pure-JS fallback: scrape printable ASCII / UTF-8 text from raw PDF bytes
// Not perfect — misses compressed streams — but works for simple uncompressed PDFs.
function fallbackExtract(buffer) {
  const raw = buffer.toString('binary');
  // Extract strings between parentheses (PDF string objects)
  const strRe  = /\(([^)]{1,500})\)/g;
  // Extract UTF-16 BOM hex strings
  const hexRe  = /<FEFF([A-Fa-f0-9]{4,})>/g;

  const parts = [];
  let m;

  while ((m = strRe.exec(raw)) !== null) {
    const s = m[1]
      .replace(/\\n/g, '\n')
      .replace(/\\r/g, '\n')
      .replace(/\\t/g, '\t')
      .replace(/\\\\/g, '\\')
      .replace(/[^\x20-\x7E\n\t]/g, '');
    if (s.trim().length > 2) parts.push(s);
  }

  while ((m = hexRe.exec(raw)) !== null) {
    try {
      const hex = m[1];
      let s = '';
      for (let i = 0; i < hex.length; i += 4) {
        const cp = parseInt(hex.slice(i, i + 4), 16);
        if (cp > 31) s += String.fromCodePoint(cp);
      }
      if (s.trim()) parts.push(s);
    } catch (_) {}
  }

  return parts.join(' ').replace(/\s{3,}/g, '\n\n').trim();
}

// ─── Count PDF pages from raw bytes (finds /Type /Page entries) ───────────────
function countPages(buffer) {
  const s = buffer.toString('binary');
  const m = s.match(/\/Count\s+(\d+)/);
  return m ? parseInt(m[1]) : null;
}

// ─── Extract PDF metadata ─────────────────────────────────────────────────────
function extractMeta(buffer) {
  const s = buffer.toString('binary');
  const fields = ['Title', 'Author', 'Subject', 'Creator', 'Producer', 'CreationDate'];
  const info = {};
  for (const f of fields) {
    const re = new RegExp('/' + f + '\\s*\\(([^)]{0,200})\\)');
    const m  = s.match(re);
    if (m) info[f] = m[1].replace(/[^\x20-\x7E]/g, '').trim();
  }
  return info;
}

// ─── readPdf ─────────────────────────────────────────────────────────────────
async function readPdf(filePath) {
  const resolved = path.resolve(process.cwd(), filePath);

  if (!fs.existsSync(resolved))
    return { error: `File not found: ${filePath}` };

  if (!resolved.toLowerCase().endsWith('.pdf') && !isBinaryPdf(resolved))
    return { error: `Not a PDF file: ${filePath}` };

  let buffer;
  try { buffer = fs.readFileSync(resolved); }
  catch (e) { return { error: 'Cannot read file: ' + e.message }; }

  const pdfParse = tryLoadPdfParse();

  if (pdfParse) {
    try {
      const data = await pdfParse(buffer);
      return {
        text:  data.text || '(no text content extracted)',
        pages: data.numpages,
        info:  data.info || {},
      };
    } catch (e) {
      // fall through to fallback
    }
  }

  // Fallback extractor
  const text  = fallbackExtract(buffer);
  const pages = countPages(buffer);
  const info  = extractMeta(buffer);

  const note = pdfParse
    ? '\n\n*(pdf-parse extraction failed — used fallback; install pdf-parse for best results: npm install pdf-parse)*'
    : '\n\n*(pdf-parse not installed — used fallback extractor. Run: npm install pdf-parse for best results)*';

  return {
    text:  (text || '(no readable text found in this PDF)') + note,
    pages: pages || 'unknown',
    info,
  };
}

function isBinaryPdf(filePath) {
  try {
    const buf = Buffer.alloc(5);
    const fd  = require('fs').openSync(filePath, 'r');
    require('fs').readSync(fd, buf, 0, 5, 0);
    require('fs').closeSync(fd);
    return buf.toString('ascii') === '%PDF-';
  } catch (_) { return false; }
}

// ─── pdfInfo ─────────────────────────────────────────────────────────────────
async function pdfInfo(filePath) {
  const resolved = path.resolve(process.cwd(), filePath);
  if (!fs.existsSync(resolved)) return { error: `File not found: ${filePath}` };

  let buffer;
  try { buffer = fs.readFileSync(resolved); }
  catch (e) { return { error: 'Cannot read file: ' + e.message }; }

  const pdfParse = tryLoadPdfParse();
  let pages = countPages(buffer);
  let info  = extractMeta(buffer);

  if (pdfParse) {
    try {
      const data = await pdfParse(buffer, { max: 1 }); // parse 1 page for speed
      pages = data.numpages;
      info  = { ...info, ...(data.info || {}) };
    } catch (_) {}
  }

  const sizeKB = (buffer.length / 1024).toFixed(1);
  const lines  = [
    `**File:** ${filePath}`,
    `**Size:** ${sizeKB} KB`,
    `**Pages:** ${pages || 'unknown'}`,
  ];
  for (const [k, v] of Object.entries(info)) {
    if (v) lines.push(`**${k}:** ${v}`);
  }

  return { output: lines.join('\n') };
}

module.exports = { readPdf, pdfInfo };

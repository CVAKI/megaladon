'use strict';

// ─── extractFilesFromMarkdown ────────────────────────────────────────────────
// Three patterns, tried in order, to catch how different local models
// reference files when they ignore the @@FILE:/@@END format entirely and
// just emit plain markdown code blocks instead. Returns an array of
// { path, content } — empty array if nothing matched.
function extractFilesFromMarkdown(reply) {
  const files = [];

  // Pattern 1: filename in text IMMEDIATELY BEFORE the code block
  // Catches: "Save as `client.js`", "### client.js", "Create client.js then..."
  const beforeBlockRe = /(?:###?\s*|`{1,3}|[Ss]ave (?:it )?as\s+|[Cc]reate\s+|[Ff]ile(?:name)?[:\s]+)([a-zA-Z0-9_.\/\\-]+\.[a-z]{1,6})[`\s]*\n*```(?:[a-z]*)\n([\s\S]*?)```/gi;
  let bm;
  while ((bm = beforeBlockRe.exec(reply)) !== null) {
    const fpath = bm[1].trim().replace(/\\/g, '/');
    if (!fpath.includes(' ') && fpath.length < 120)
      files.push({ path: fpath, content: bm[2] });
  }

  // Pattern 2: filename as first-line comment INSIDE the code block
  // Catches: ```js\n// client.js\n...``` or ```\n# server.py\n...```
  if (files.length === 0) {
    const codeBlockRe = /```(?:[a-z]*)\n([\s\S]*?)```/g;
    let cm;
    while ((cm = codeBlockRe.exec(reply)) !== null) {
      const blockContent = cm[1];
      const firstLine = blockContent.match(/^(?:\/\/|#|<!--)\s*([a-zA-Z0-9_.\/\\-]+\.[a-z]{1,6})\s*(?:-->)?\r?\n/);
      if (firstLine) {
        const fpath = firstLine[1].trim().replace(/\\/g, '/');
        if (!fpath.includes(' ') && fpath.length < 80) {
          const contentWithoutComment = blockContent.slice(firstLine[0].length);
          files.push({ path: fpath, content: contentWithoutComment });
        }
      }
    }
  }

  // Pattern 3: filename anywhere in the ~400 chars before each code block
  // Catches prose like "The following client.js handles..." then code block
  if (files.length === 0) {
    const splitParts = reply.split(/(```[a-z]*\n[\s\S]*?```)/g);
    for (let pi = 1; pi < splitParts.length; pi += 2) {
      const block      = splitParts[pi];
      const beforeText = splitParts[pi - 1] || '';
      const contentM   = block.match(/```[a-z]*\n([\s\S]*?)```/);
      if (!contentM) continue;
      const blockContent = contentM[1];
      const nameM =
          beforeText.slice(-400).match(/`([a-zA-Z0-9_.\/\\-]+\.[a-z]{1,6})`[^`\n]{0,60}$/) ||
          beforeText.slice(-300).match(/\b([a-zA-Z0-9_.\/\\-]+\.(?:js|ts|py|php|rb|go|rs|java|cpp|c|html|css|json|yaml|yml|sh|cmd|bat|ps1|md|txt))\b[^.\n]{0,80}$/i);
      if (nameM) {
        const fpath = nameM[1].replace(/\\/g, '/');
        if (!files.some(f => f.path === fpath))
          files.push({ path: fpath, content: blockContent });
      }
    }
  }

  return files;
}

module.exports = { extractFilesFromMarkdown };

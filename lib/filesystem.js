'use strict';
const fs   = require('fs');
const path = require('path');
const { C, wh, cr, kp, rf, ab, sd, dg, vt, tl, fm, bd, dm } = require('./colors');

const CWD = () => process.cwd();

function safePath(rel) {
  const resolved=path.resolve(CWD(),rel);
  if (!resolved.startsWith(CWD())) throw new Error('Access denied: path escapes working directory');
  return resolved;
}
function ensureDirForFile(fp) { const d=path.dirname(fp); if(!fs.existsSync(d)) fs.mkdirSync(d,{recursive:true}); }
function writeFileSafe(rel,content) { const full=safePath(rel); ensureDirForFile(full); fs.writeFileSync(full,content,'utf8'); return full; }
function readFileSafe(rel) {
  const full=path.resolve(CWD(),rel);
  if (!fs.existsSync(full)) throw new Error('File not found: '+rel);
  const stat=fs.statSync(full);
  if (stat.size>2*1024*1024) throw new Error('File too large (max 2MB)');
  return {content:fs.readFileSync(full,'utf8'),ext:path.extname(full).slice(1),name:path.basename(full),size:stat.size};
}
function treeDir(dir,prefix,depth,max) {
  if (depth>max) return '';
  let out='';
  let entries;
  try { entries=fs.readdirSync(dir,{withFileTypes:true}); } catch(_){ return ''; }
  const skip=['node_modules','.git','__pycache__','.next','dist','build','.venv','venv','coverage','.cache'];
  const filtered=entries.filter(e=>!skip.includes(e.name));
  filtered.forEach((e,i)=>{
    const last=i===filtered.length-1;
    const conn=last?'└── ':'├── ';
    const col=e.isDirectory()?C.whale:(e.name.match(/\.(js|ts|jsx|tsx|mjs)$/)?C.coral:e.name.match(/\.(py|rb|go|rs|java)$/)?C.kelp:e.name.match(/\.(json|yaml|yml|toml)$/)?C.reef:C.sand);
    out+=prefix+ab(conn)+col+e.name+(e.isDirectory()?'/':'')+C.reset+'\n';
    if (e.isDirectory()) out+=treeDir(path.join(dir,e.name),prefix+(last?'    ':ab('│   ')),depth+1,max);
  });
  return out;
}
function lsDir(rel) {
  const full=path.resolve(CWD(),rel||'.');
  if (!fs.existsSync(full)) throw new Error('Path not found: '+rel);
  return fs.readdirSync(full,{withFileTypes:true}).map(e=>({name:e.name,isDir:e.isDirectory(),size:e.isFile()?fs.statSync(path.join(full,e.name)).size:null}));
}
function formatSize(b) {
  if (b<1024) return b+'B';
  if (b<1024*1024) return (b/1024).toFixed(1)+'KB';
  return (b/(1024*1024)).toFixed(1)+'MB';
}
function parseFileBlocks(text) {
  const blocks=[];
  const re=/@@FILE:\s*([^\r\n]+)\r?\n```[^\r\n]*\r?\n([\s\S]*?)```[ \t]*\r?\n?\r?\n?@@END/g;
  let m;
  while ((m=re.exec(text))!==null) {
    blocks.push({file:m[1].trim(), content:m[2].replace(/\r\n/g,'\n')});
  }
  if (blocks.length) return blocks;

  const re2=/@@FILE:\s*([^\r\n]+)\r?\n([\s\S]*?)@@END/g;
  while ((m=re2.exec(text))!==null) {
    let content=m[2].replace(/\r\n/g,'\n');
    content=content.replace(/^```[^\n]*\n/,'').replace(/\n```\s*$/,'\n');
    blocks.push({file:m[1].trim(), content});
  }
  if (blocks.length) return blocks;

  const outerFenceRe=/```[^\n]*\n([\s\S]*?)```/g;
  let outerM;
  while ((outerM=outerFenceRe.exec(text))!==null) {
    const inner=outerM[1];
    if (!inner.includes('@@FILE:')) continue;
    const inner2=/@@FILE:\s*([^\r\n]+)\r?\n([\s\S]*?)@@END/g;
    while ((m=inner2.exec(inner))!==null) {
      let content=m[2].replace(/\r\n/g,'\n');
      content=content.replace(/^```[^\n]*\n/,'').replace(/\n```\s*$/,'\n');
      blocks.push({file:m[1].trim(), content});
    }
  }
  return blocks;
}
function parseRunBlocks(text) {
  const blocks = [];
  const stripped = text.replace(/```[\s\S]*?```/g, '');
  const re = /@@RUN:\s*([^\r\n]+)/g;
  let m;
  while ((m = re.exec(stripped)) !== null) {
    const cmd = m[1].trim();
    if (cmd) blocks.push(cmd);
  }
  return blocks;
}

function applyFileBlocks(blocks) {
  return blocks.map(blk=>{
    try {
      const full=writeFileSafe(blk.file,blk.content);
      return {ok:true,path:path.relative(CWD(),full),full,lines:blk.content.split('\n').length};
    } catch(err) { return {ok:false,path:blk.file,err:err.message}; }
  });
}
function printFileResults(results) {
  console.log('\n  '+tl('Files written:'));
  results.forEach(r=>{
    if (r.ok) console.log('  '+kp('  ✔ ')+sd(r.path)+ab(' ('+r.lines+' lines)'));
    else console.log('  '+dg('  ✘ ')+sd(r.path)+dg(' — '+r.err));
  });
}

function scanFolder(cwd, max) {
  const IMPORTANT=['package.json','requirements.txt','Cargo.toml','go.mod','pom.xml','build.gradle','composer.json','Gemfile','README.md','index.js','main.py','app.js','server.js','index.ts','main.ts','main.go','main.rs','App.tsx','index.html'];
  const EXTS=['.js','.ts','.jsx','.tsx','.py','.go','.rs','.java','.cpp','.c','.json','.yaml','.yml','.toml','.md','.env.example','.gitignore','.html','.css'];
  const allFiles=[];
  function walk(dir,depth) {
    if (depth>2) return;
    try {
      fs.readdirSync(dir,{withFileTypes:true}).filter(e=>!['node_modules','.git','__pycache__','.next','dist','build','.venv','venv','coverage'].includes(e.name)).forEach(e=>{
        if (e.isDirectory()) walk(path.join(dir,e.name),depth+1);
        else if (EXTS.includes(path.extname(e.name).toLowerCase())||IMPORTANT.includes(e.name)) {
          allFiles.push(path.join(dir,e.name));
        }
      });
    } catch(_){}
  }
  walk(cwd,0);
  const sorted=[
    ...IMPORTANT.map(p=>allFiles.find(f=>path.basename(f)===p)).filter(Boolean),
    ...allFiles.filter(f=>!IMPORTANT.includes(path.basename(f))),
  ];
  return [...new Set(sorted)].slice(0,max||10).map(f=>({path:path.relative(cwd,f),size:fs.statSync(f).size,ext:path.extname(f).slice(1)}));
}
function buildFolderContext(files,cwd) {
  if (!files.length) return '';
  const parts=['## Project Files (current directory scan)'];
  files.slice(0,6).forEach(f=>{
    try {
      if (f.size<12000) {
        const content=fs.readFileSync(path.join(cwd,f.path),'utf8');
        parts.push(`\n### ${f.path} (${formatSize(f.size)})`);
        parts.push('```'+f.ext+'\n'+content.slice(0,2000)+(content.length>2000?'\n... (truncated)':'')+'\n```');
      } else {
        parts.push(`\n### ${f.path} — ${formatSize(f.size)} (too large to inline)`);
      }
    } catch(_){}
  });
  return parts.join('\n');
}

module.exports = {
  CWD, safePath, ensureDirForFile, writeFileSafe, readFileSafe,
  treeDir, lsDir, formatSize,
  parseFileBlocks, parseRunBlocks, applyFileBlocks, printFileResults,
  scanFolder, buildFolderContext,
};
'use strict';
const path = require('path');
const os   = require('os');
const { C, wh, cr, kp, rf, ab, sd, dg, vt, tl, fm, bd, dm } = require('./colors');

// ─── Syntax Highlighter ───────────────────────────────────────────────────────
const KW = {
  js:   /\b(const|let|var|function|return|if|else|for|while|do|class|import|export|default|from|async|await|try|catch|finally|new|this|super|typeof|instanceof|null|undefined|true|false|switch|case|break|continue|throw|delete|in|of|yield|get|set|static|extends|implements|require|module)\b/g,
  ts:   /\b(const|let|var|function|return|if|else|for|while|do|class|import|export|default|from|async|await|try|catch|finally|new|this|super|typeof|instanceof|null|undefined|true|false|switch|case|break|continue|throw|type|interface|enum|extends|implements|readonly|public|private|protected|abstract|override|as|any|never|unknown|void|string|number|boolean|object|Record|Partial|Required|Pick|Omit|Array|Promise|keyof|infer|typeof)\b/g,
  py:   /\b(def|class|return|if|elif|else|for|while|import|from|as|with|try|except|finally|raise|pass|break|continue|None|True|False|and|or|not|in|is|lambda|yield|del|async|await|global|nonlocal|print|len|range|str|int|float|list|dict|set|tuple|type|isinstance|hasattr|getattr|setattr|super|property|staticmethod|classmethod|self|cls|__init__|__str__|__repr__)\b/g,
  bash: /\b(echo|cd|ls|mkdir|rm|cp|mv|cat|grep|sed|awk|find|chmod|chown|sudo|apt|pip|pip3|npm|yarn|git|curl|wget|export|source|if|then|fi|else|elif|for|do|done|while|until|function|return|exit|read|test|printf|set|unset|local|declare|case|esac|eval|exec)\b/g,
  go:   /\b(func|var|const|type|struct|interface|map|chan|return|if|else|for|range|switch|case|break|continue|go|defer|select|import|package|new|make|len|cap|append|copy|close|panic|recover|true|false|nil|error|string|int|int8|int16|int32|int64|uint|uint8|byte|rune|bool|float32|float64|complex64)\b/g,
  rs:   /\b(fn|let|mut|const|static|struct|enum|impl|trait|use|mod|pub|crate|super|self|Self|return|if|else|for|while|loop|match|break|continue|move|ref|async|await|where|type|in|as|dyn|Box|Vec|String|Option|Result|Some|None|Ok|Err|true|false|println|eprintln|format|todo|unimplemented)\b/g,
  java: /\b(class|interface|extends|implements|public|private|protected|static|final|abstract|void|new|return|if|else|for|while|do|switch|case|break|continue|try|catch|finally|throw|throws|import|package|this|super|null|true|false|int|long|double|float|boolean|char|byte|short|String|List|Map|Set|ArrayList|HashMap|Optional|Stream|var)\b/g,
  cpp:  /\b(int|long|double|float|char|bool|void|const|constexpr|static|class|struct|enum|namespace|template|typename|auto|if|else|for|while|do|switch|case|break|continue|return|new|delete|nullptr|true|false|public|private|protected|virtual|override|include|define|ifdef|endif|using|std|cout|cin|endl|size_t|uint32_t)\b/g,
  sql:  /\b(SELECT|FROM|WHERE|AND|OR|NOT|IN|JOIN|LEFT|RIGHT|INNER|OUTER|CROSS|ON|AS|ORDER|BY|GROUP|HAVING|LIMIT|OFFSET|INSERT|INTO|VALUES|UPDATE|SET|DELETE|CREATE|TABLE|INDEX|VIEW|DROP|ALTER|ADD|COLUMN|PRIMARY|KEY|FOREIGN|REFERENCES|UNIQUE|NULL|IS|LIKE|BETWEEN|EXISTS|DISTINCT|COUNT|SUM|AVG|MAX|MIN|CASE|WHEN|THEN|ELSE|END|WITH|CTE|UNION|INTERSECT|EXCEPT)\b/gi,
  php:  /\b(echo|print|function|return|if|elseif|for|foreach|while|do|class|interface|extends|implements|public|private|protected|static|new|null|true|false|array|string|int|float|bool|void|namespace|use|require|include|throw|try|catch|finally|match|fn|readonly|abstract)\b/g,
  rb:   /\b(def|class|module|return|if|elsif|else|unless|for|while|until|do|end|begin|rescue|ensure|raise|yield|lambda|proc|nil|true|false|self|super|require|include|extend|attr_reader|attr_writer|attr_accessor|puts|print|p)\b/g,
};
const LANG_ALIASES={javascript:'js',typescript:'ts',python:'py',sh:'bash',shell:'bash',golang:'go',rust:'rs',c:'cpp','c++':'cpp',php:'php',ruby:'rb',rb:'rb'};

function stripAnsi(str) {
  return str
      .replace(/\x1b\[[0-9;]*m/g, '')
      .replace(/\x1b\[[0-9;]*[A-Za-z]/g, '')
      .replace(/\b\d+;2;\d+;\d+;\d+m/g, '')
      .replace(/\b\d+;\d+m/g, '')
      .replace(/\b\d+m\b/g, '');
}

// ─── Word-wrap for plain paragraph text ────────────────────────────────────────
// Splits on spaces and rebuilds lines that stay under `width` VISIBLE columns
// (ANSI color codes injected by the markdown formatter below don't count
// toward width — stripAnsi() is used only for measuring, never for output).
// Long unbroken tokens (URLs, etc.) are left intact rather than force-split.
function wrapText(str, width) {
  if (!str) return [''];
  const words = str.split(' ');
  const lines = [];
  let cur = '';
  for (const w of words) {
    const candidate = cur ? cur + ' ' + w : w;
    if (stripAnsi(candidate).length > width && cur) {
      lines.push(cur);
      cur = w;
    } else {
      cur = candidate;
    }
  }
  if (cur) lines.push(cur);
  return lines.length ? lines : [''];
}

function highlight(code, lang) {
  code = stripAnsi(code);
  const k=LANG_ALIASES[lang]||lang;

  if (lang==='json') {
    return code
        .replace(/"([^"\\]|\\.)*"\s*:/g, m => C.whale+m+C.reset)
        .replace(/:\s*"([^"\\]|\\.)*"/g, m => m.replace(/"[^"]*"$/, s => C.kelp+s+C.reset))
        .replace(/:\s*(true|false|null)\b/g, m => m.replace(/(true|false|null)/, s => C.coral+s+C.reset))
        .replace(/:\s*(-?\d+\.?\d*(?:e[+-]?\d+)?)/g, m => m.replace(/(-?\d[\d.]*)/, s => C.reef+s+C.reset));
  }
  if (lang==='yaml'||lang==='yml') {
    return code
        .replace(/^(\s*)([\w.-]+):/gm, (_,s,k) => s+C.whale+k+C.reset+':')
        .replace(/#.*/g, m => C.abyss+m+C.reset)
        .replace(/:\s*(.+)$/gm, (m,v) => m.replace(v, C.kelp+v+C.reset));
  }
  if (lang==='css'||lang==='scss'||lang==='less') {
    return code
        .replace(/\/\*[\s\S]*?\*\//g, m => C.abyss+m+C.reset)
        .replace(/([.#:[\]>~+*][\w-,[\]().#>~+*\s]*)\s*\{/g, m => C.whale+m+C.reset)
        .replace(/([\w-]+)\s*(?=:)/g, m => C.coral+m+C.reset)
        .replace(/:\s*([^;{}]+);/g, (m,v) => m.replace(v, C.kelp+v+C.reset))
        .replace(/(@[\w-]+)/g, m => C.reef+m+C.reset);
  }
  if (lang==='html'||lang==='xml'||lang==='svg') {
    return code
        .replace(/<!--[\s\S]*?-->/g, m => C.abyss+m+C.reset)
        .replace(/<\/?[\w][\w.-]*/g, m => C.whale+m+C.reset)
        .replace(/\s([\w:-]+)=/g, (_,a) => ' '+C.coral+a+C.reset+'=')
        .replace(/="([^"]*)"/g, (_,v) => '="'+C.kelp+v+C.reset+'"')
        .replace(/(>)([^<\n]+)(?=<)/g, (_,o,t) => o+C.sand+t+C.reset);
  }
  if (lang==='toml'||lang==='ini') {
    return code
        .replace(/^\[.*\]$/gm, m => C.whale+m+C.reset)
        .replace(/^([\w.-]+)\s*=/gm, (_,k) => C.coral+k+C.reset+' =')
        .replace(/#.*/g, m => C.abyss+m+C.reset)
        .replace(/=\s*"([^"]*)"/g, (_,v) => '= "'+C.kelp+v+C.reset+'"')
        .replace(/=\s*(true|false)/g, (_,v) => '= '+C.reef+v+C.reset);
  }

  const kwRe=KW[k];
  if (!kwRe) return C.foam+code+C.reset;

  return code
      .replace(/(\"(?:[^\"\\]|\\.)*\"|'(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`)/gs, m => C.kelp+m+C.reset)
      .replace(/(\/\/[^\n]*|#[^\n]*(?!.*:))/g, m => C.abyss+m+C.reset)
      .replace(/\/\*[\s\S]*?\*\//g, m => C.abyss+m+C.reset)
      .replace(/\b(0x[\da-fA-F]+|0b[01]+|0o[0-7]+|\d+\.?\d*(?:e[+-]?\d+)?)\b/g, m => C.reef+m+C.reset)
      .replace(kwRe, m => C.coral+m+C.reset)
      .replace(/\b([A-Z][A-Za-z0-9]*)\s*(?=[(<])/g, m => C.teal+m+C.reset)
      .replace(/(=>|===|!==|==|!=|<=|>=|&&|\|\||[+\-*/%^&|~?:](?!=))/g, m => C.whale+m+C.reset);
}

// ─── Markdown Formatter ───────────────────────────────────────────────────────
function formatMD(text) {
  if (typeof text !== 'string') return '';
  const TW=Math.min((process.stdout.columns||80)-4,104);
  const lines=text.split('\n');
  const out=[];
  let inCode=false, codeBuf=[], codeLang='';

  for (const line of lines) {
    if (line.startsWith('```')) {
      if (!inCode) { inCode=true; codeLang=line.slice(3).trim().toLowerCase(); codeBuf=[]; }
      else {
        inCode=false;
        const label=codeLang||'text';
        const bar='─'.repeat(Math.max(0,TW-label.length-5));
        out.push('');
        out.push('  '+ab('┌─')+tl(' '+label+' ')+ab(bar));
        codeBuf.forEach(cl=>out.push('  '+ab('│ ')+highlight(cl,codeLang)));
        out.push('  '+ab('└'+'─'.repeat(TW-2)));
        out.push('');
        codeBuf=[]; codeLang='';
      }
      continue;
    }
    if (inCode) { codeBuf.push(line); continue; }

    let l=stripAnsi(line)
        .replace(/`([^`]+)`/g,       (_,t)=>C.coral+t+C.reset)
        .replace(/\*\*\*([^*]+)\*\*\*/g, (_,t)=>C.bold+C.italic+t+C.reset)
        .replace(/\*\*([^*]+)\*\*/g,  (_,t)=>C.bold+C.foam+t+C.reset)
        .replace(/\*([^*]+)\*/g,      (_,t)=>C.italic+t+C.reset)
        .replace(/~~([^~]+)~~/g,      (_,t)=>C.dim+t+C.reset)
        .replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_,txt,url)=>C.teal+txt+C.reset+C.dim+' ('+url+')'+C.reset);

    if      (/^# /.test(l))    { out.push(''); out.push(wh(C.bold+'  ▋ '+l.replace(/^# /,''))+C.reset); out.push('  '+ab('─'.repeat(TW))); }
    else if (/^## /.test(l))   { out.push(''); out.push(cr(C.bold+'  ▸ '+l.replace(/^## /,''))+C.reset); }
    else if (/^### /.test(l))  { out.push(rf('  › '+l.replace(/^### /,''))); }
    else if (/^#### /.test(l)) { out.push(tl('  · '+l.replace(/^#### /,''))); }
    else if (/^\s*\d+\. /.test(l)) {
      const m = l.match(/^(\s*)(\d+)\. (.*)$/);
      if (m) {
        const prefix = '  ' + cr(m[2]+'.') + ' ';
        wrapText(m[3], TW - stripAnsi(prefix).length).forEach((wl, i) =>
            out.push(i === 0 ? prefix + wl : '  '.padEnd(stripAnsi(prefix).length) + wl)
        );
      } else out.push(l);
    }
    else if (/^\s*[-*] /.test(l)) {
      const m = l.match(/^(\s*)[-*] (.*)$/);
      if (m) {
        const prefix = '  ' + wh('▸') + ' ';
        wrapText(m[2], TW - 4).forEach((wl, i) =>
            out.push(i === 0 ? prefix + wl : '    ' + wl)
        );
      } else out.push(l);
    }
    else if (/^> /.test(l))        out.push('  '+ab('║')+' '+C.dim+l.replace(/^> /,'')+C.reset);
    else if (/^---+$/.test(l.trim())) out.push('  '+ab('─'.repeat(Math.min(TW,64))));
    else if (/^\|.*\|$/.test(l)) {
      const cells=l.split('|').filter(c=>c.trim());
      if (cells.every(c=>/^[-: ]+$/.test(c))) {
        out.push('  '+ab('├'+'─'.repeat(TW-2)+'┤'));
      } else {
        out.push('  '+ab('│')+' '+cells.map(c=>sd((c.trim()).padEnd(18))).join(ab(' │ '))+' '+ab('│'));
      }
    }
        // ── Plain paragraph text — word-wrapped to the terminal width instead of
    //    being printed as one raw, unbroken line that runs off the screen. ──
    else if (l.trim() === '') {
      out.push('');
    }
    else {
      wrapText(l, TW - 2).forEach(wl => out.push('  ' + wl));
    }
  }
  return out.join('\n');
}

// ─── PS1 Prompt ──────────────────────────────────────────────────────────────
function getTime() {
  const n=new Date();
  return [String(n.getHours()).padStart(2,'0'),String(n.getMinutes()).padStart(2,'0'),String(n.getSeconds()).padStart(2,'0')].join(':');
}

function renderPS1(msgCount, cwd, mode, modesMap) {
  const home=os.homedir();
  const shortCwd=cwd.startsWith(home)?'~'+cwd.slice(home.length):cwd;
  const dirName=path.basename(shortCwd)||shortCwd;
  const modeIcon=(modesMap&&modesMap[mode]?.icon)||'</>';

  const l1=ab('┌')+ab('[')+rf(getTime())+ab(']')+ab('────')+ab('[')+wh(C.bold+'Megaladon')+C.reset+ab(']')+ab('────')+ab('[')+cr(modeIcon+' '+mode)+ab(']')+ab('────')+ab('[')+kp(String(msgCount))+ab(']');
  const l2=ab('└')+ab('[')+tl(dirName)+ab(']')+ab('──')+cr('►')+' ';

  return '\n'+l1+'\n'+l2;
}

// ─── Phase Tracker (Claude-style live progress) ───────────────────────────────
//
// Usage:
//   const tracker = createPhaseTracker(7);
//   tracker.start(1, 'Tokenizing intent');
//   tracker.badge(1, '⟳ auto-switched ◈ agent');
//   tracker.done(1);
//   tracker.start(2, 'Assembling context');
//   tracker.note(2, 'memory · 5 facts · skills loaded');
//   tracker.done(2);
//   tracker.start(6, 'Self-test loop', 'attempt 1/3');
//   tracker.sub(6, 'file', '📄 wrote client.js · 87 lines');
//   tracker.sub(6, 'run',  '⚡ starting server.js on port 3000');
//   tracker.sub(6, 'wait', '⟳ waiting for port 3000...');
//   tracker.sub(6, 'pass', '✔ integration test PASSED');
//   tracker.fail(6, 'port 3000 never opened');
//   tracker.done(6);
//   tracker.finish({ tokens: 1842, elapsed: '8.3s', attempts: '1/3' });

const TW = () => Math.min((process.stdout.columns || 80) - 4, 100);

const PHASE_NAMES = [
  '', // 0 unused
  'Tokenization',
  'Context assembly',
  'Provider call',
  'Extended thinking',
  'Code generation',
  'Self-test loop',
  'Response assembly',
];

function phaseLabel(n) {
  return rf('Phase ' + n) + ab(' ─ ') + C.sand + (PHASE_NAMES[n] || 'Step ' + n) + C.reset;
}

function createPhaseTracker(totalPhases) {
  const state = {}; // phase -> { status, badge, note, subs }

  function printPhaseLine(n, icon, iconColor, label, badge, note) {
    const ic   = iconColor + icon + C.reset;
    const lbl  = label;
    const bdg  = badge ? '  ' + ab('[') + tl(badge) + ab(']') : '';
    const nt   = note  ? '  ' + ab(note) : '';
    console.log('  ' + ic + '  ' + lbl + bdg + nt);
  }

  return {
    // ── start a phase (shows spinner icon + label) ────────────────────────────
    start(n, customLabel, badge) {
      state[n] = { status: 'active', badge: badge || '', subs: [] };
      const label = customLabel
          ? rf('Phase ' + n) + ab(' ─ ') + wh(customLabel)
          : phaseLabel(n);
      printPhaseLine(n, '⟳', C.whale, label, badge, null);
    },

    // ── attach a badge to current phase (auto-switch notice etc.) ─────────────
    badge(n, text) {
      if (state[n]) state[n].badge = text;
      // reprint inline after current line
      process.stdout.write('  ' + ab('[') + vt(text) + ab(']') + '\n');
    },

    // ── small dimmed note on same phase line ──────────────────────────────────
    note(n, text) {
      console.log('  ' + ab('   ╰ ') + dm(text));
    },

    // ── sub-event inside a phase (file written, command run, test result) ─────
    sub(n, type, text) {
      if (!state[n]) state[n] = { status: 'active', subs: [] };
      state[n].subs.push({ type, text });

      const indent = '    ';
      if (type === 'file') {
        const icon  = wh('📄');
        const parts = text.split('·');
        const fname = tl(parts[0].trim());
        const meta  = parts[1] ? ab(' · ' + parts[1].trim()) : '';
        console.log(indent + ab('┆ ') + icon + '  ' + fname + meta);
      } else if (type === 'run') {
        console.log(indent + ab('┆ ') + tl('⚡') + '  ' + ab(text));
      } else if (type === 'wait') {
        console.log(indent + ab('┆ ') + rf('⟳') + '  ' + ab(text));
      } else if (type === 'pass') {
        console.log(indent + ab('┆ ') + kp('✔') + '  ' + kp(text));
      } else if (type === 'fail') {
        console.log(indent + ab('┆ ') + dg('✘') + '  ' + dg(text));
      } else if (type === 'fix') {
        console.log(indent + ab('┆ ') + rf('⟳') + '  ' + rf(text));
      } else if (type === 'info') {
        console.log(indent + ab('┆ ') + ab('·') + '  ' + sd(text));
      } else {
        console.log(indent + ab('┆ ') + sd(text));
      }
    },

    // ── mark a phase done (green ✔) ───────────────────────────────────────────
    done(n, summary) {
      if (state[n]) state[n].status = 'done';
      const extra = summary ? '  ' + ab(summary) : '';
      process.stdout.write('  ' + kp('✔') + '  ' + phaseLabel(n) + extra + '\n');
    },

    // ── mark a phase failed (red ✘) ───────────────────────────────────────────
    fail(n, reason) {
      if (state[n]) state[n].status = 'fail';
      console.log('  ' + dg('✘') + '  ' + phaseLabel(n) + (reason ? '  ' + dg(reason) : ''));
    },

    // ── final summary line ────────────────────────────────────────────────────
    finish({ tokens, elapsed, attempts, provider, model } = {}) {
      const tw = TW();
      console.log('');
      console.log('  ' + ab('─'.repeat(tw)));

      const parts = [];
      if (provider) parts.push(wh('🦈 ' + provider));
      if (model)    parts.push(ab(model));
      if (tokens)   parts.push(tl(String(tokens).replace(/\B(?=(\d{3})+(?!\d))/g, ',') + ' tok'));
      if (elapsed)  parts.push(rf(elapsed));
      if (attempts) parts.push(kp('attempt ' + attempts));

      if (parts.length) console.log('  ' + parts.join('  ' + ab('·') + '  '));
      console.log('');
    },

    // ── section divider ───────────────────────────────────────────────────────
    divider(label) {
      const tw = TW();
      const lbl = label ? ' ' + ab(label) + ' ' : '';
      const dashLen = Math.max(0, tw - lbl.length - 2);
      const half    = Math.floor(dashLen / 2);
      console.log('  ' + ab('─'.repeat(half)) + lbl + ab('─'.repeat(dashLen - half)));
    },
  };
}

// ─── Spinner — format: [⠦]::[label.{@mode}]──[ Megaladon ]──[52:550]::label... ──
// Returns { stop, update } so callers can change the label mid-spin.
function spinner(initialLabel, mode) {
  const frames = ['⠋','⠙','⠹','⠸','⠼','⠴','⠦','⠧','⠇','⠏'];
  let i       = 0;
  let label   = initialLabel || 'thinking';
  const start = Date.now();

  const iv = setInterval(() => {
    const elapsed    = Date.now() - start;
    const secs       = Math.floor(elapsed / 1000);
    const ms         = String(elapsed % 1000).padStart(3, '0');
    const dotCount   = Math.floor(elapsed / 380) % 4;
    const dots       = '.'.repeat(dotCount + 1);
    const modeSuffix = mode ? '.{@' + mode + '}' : '';
    const frame      = wh('[' + frames[i++ % frames.length] + ']');
    const tag        = ab('::') + tl('[' + label + modeSuffix + ']');
    const brand      = ab('──[ Megaladon ]──');
    const timer      = rf('[' + secs + ':' + ms + ']');
    const trail      = tl('::' + label + dots);
    process.stdout.write('\r  ' + frame + tag + brand + timer + trail + '      ');
  }, 80);

  return {
    update(newLabel) { label = newLabel; },
    stop() {
      clearInterval(iv);
      process.stdout.write('\r' + ' '.repeat((process.stdout.columns || 80) - 1) + '\r');
    },
    succeed(msg) {
      clearInterval(iv);
      process.stdout.write('\r' + ' '.repeat((process.stdout.columns || 80) - 1) + '\r');
      if (msg) console.log('  ' + wh('✔') + ' ' + msg);
    },
    fail(msg) {
      clearInterval(iv);
      process.stdout.write('\r' + ' '.repeat((process.stdout.columns || 80) - 1) + '\r');
      if (msg) console.log('  ' + rf('✘') + ' ' + msg);
    },
  };
}


// ─── Shark Logo ───────────────────────────────────────────────────────────────
// New ASCII mark: white body/head, yellow dorsal fin + tail
function printLogo() {
  const fin = C.reef, body = C.sand, r = C.reset;
  const lines = [
    { t: '                  ⠠⣄⣀⡀', c: fin },
    { t: '                  ⢸⣿⠿⠷⣄⣀', c: fin },
    { t: '                   ⢻⣦⣄⠈⠉⠳⢦⣤⣄', c: fin },
    { t: '                   ⢸⣿⣿⡄  ⠈⠛⢿⣧⡀', c: fin },
    { t: '                   ⢸⣿⣿⡇     ⠙⢿⡆', c: fin },
    { t: '                   ⣸⣿⠿  ⢀⣠⣤⣴⣶⣶⣾⣿⣿⣿⣿⣿⣿⣶⣶⣶⣶⣤⣄⣀', c: body },
    { t: '                 ⢀⣰⣿⡇ ⠰⠿⠟⠛⠛⠁         ⠙⠛⠛⠻⠿⠿⠿⢿⣿⣷⣤⣀⡀', c: body },
    { t: '               ⣀⣰⠿⠏⠉                         ⠈⠉⠉⠹⠿⠿⣶⣄⣀⡀', c: body },
    { t: '            ⢀⣶⠞⠉⠁                           ⠒⠒     ⠈⠉⠙⣿⣶⣤⡀', c: body },
    { t: '           ⣴⡟⠁                           ⢀⣀⣀⣀⣀⣀⣀⣀⣀⣀⣀⣀⣀⣀⣻⣿⣿⣷⡄', c: body },
    { t: '         ⢀⣴⠏                       ⣀⣠⣤⣾⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⠟⠁', c: body },
    { t: '        ⢀⣼⡇                     ⢴⣿⣿⣿⣿⣿⣿⣿⣿⣿⡿⠿⠛⠛⠁ ⠈⠛⠛⠛⠿⢿⣿⡿⠟⠁', c: body },
    { t: '       ⢠⡟⠋      ⢀⣀⡀           ⢀⣀⣠⣽⣿⣿⣿⣿⣿⡿⠛⠉            ⠉', c: body },
    { t: '       ⣸⣇  ⣠⣤⣾⡿⠋⠉⠉         ⢀⣤⣾⣿⣿⣿⣿⣿⣿⣿⣿⡋', c: body },
    { t: '      ⢠⣿⠿⠿⠟⠋⠉⠁          ⢀⣀⣶⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣦⡀', c: body },
    { t: '   ⢀⡴⠞⠉⠁              ⢀⣰⣾⣿⣿⣿⡿⠿⠿⠿⠿⠿⠿⠿⢿⣿⣿⣿⣿⣦⣀', c: body },
    { t: '  ⣠⠞⠁                ⣠⣾⣿⣿⣿⠟⠋         ⠙⠛⠻⣿⣿⣿⣦⣀', c: body },
    { t: '⠠⠾⠁⠠⠤⠖⠲⣶⡖⠂         ⢠⣾⣿⣿⠟⠁               ⠈⠉⠙⠛⠋', c: body },
    { t: '       ⠸⡇          ⣾⣿⠟⠁', c: body },
    { t: '        ⠙⢦        ⢸⣿⠃', c: body },
    { t: '         ⠸⣇       ⢸⡇                      ⢠⣤⣤⣾⠟⠁', c: fin },
    { t: '          ⠹⣆      ⢸⣿⡀                  ⢀⣀⣾⣿⡿⠛⠁', c: fin },
    { t: '           ⠈⢷⣄     ⠻⣇                ⢠⣶⣿⣿⣿⠏⠁', c: fin },
    { t: '             ⠙⢷⣄    ⠈⢻⣷⡆           ⣠⣾⣿⣿⣿⣿⠏', c: fin },
    { t: '                ⠙⢦⡀   ⠙⠛⢦⣄      ⢠⣤⣴⣿⣿⣿⣿⣿⡟', c: fin },
    { t: '                  ⠈⠻⢦⣀⣀  ⠉⠙⠿⠦⠄⣀⣀  ⠈⠙⢿⣿⣿⣿⡇', c: fin },
    { t: '                      ⠙⠿⠤⢄⣀⣀⡀      ⠘⢿⣿⣿⣿⡇', c: fin },
    { t: '                            ⠉⠉⠓⠂    ⠈⠻⣿⣿⣧⡀', c: fin },
    { t: '                                      ⠈⠙⢿⣿⡆', c: fin },
    { t: '                                        ⠈⠉⠳⠆', c: fin },
  ];
  lines.forEach(({ t, c }) => console.log('  ' + c + t + r));
  console.log('');
}

function printBanner(version) {
  printLogo();
  const DW=Math.min((process.stdout.columns||80)-2,72);
  console.log('  '+rf(C.bold+'Mega')+wh(C.bold+'ladon')+C.reset+'  '+ab('v'+version)+'  '+ab('│')+'  '+tl('AI Terminal · Self-Testing Brain · Memory · Skills'));
  console.log('  '+ab('developed by ')+cr('𝗖𝗩𝗔♞𝗞𝗜')+'  '+ab('│')+'  '+ab('7-Phase Neural Pipeline Architecture'));
  console.log('');
  console.log('  '+ab('─'.repeat(DW)));
}

module.exports = {
  KW, LANG_ALIASES, stripAnsi, highlight,
  wrapText,
  formatMD,
  getTime, renderPS1,
  printLogo, printBanner,
  spinner,
  createPhaseTracker,
};
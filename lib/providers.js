'use strict';
const https  = require('https');
const http   = require('http');
const { spawn } = require('child_process');
const { wh, cr, kp, rf, ab, sd, dg } = require('./colors');

function httpRequest(url, method, headers, body) {
  return new Promise((resolve,reject) => {
    const parsed=new URL(url);
    const lib=parsed.protocol==='https:'?https:http;
    const data=body?JSON.stringify(body):null;
    const req=lib.request({
      hostname:parsed.hostname,
      port:parsed.port||(parsed.protocol==='https:'?443:80),
      path:parsed.pathname+parsed.search,
      method:method||'GET',
      headers:{...(data?{'Content-Type':'application/json','Content-Length':Buffer.byteLength(data)}:{}), ...headers},
    }, res => {
      let raw='';
      res.on('data',c=>raw+=c);
      res.on('end',()=>{
        try {
          const json=JSON.parse(raw);
          if (res.statusCode>=400) reject(new Error(json.error?.message||json.error?.error?.message||'HTTP '+res.statusCode+': '+raw.slice(0,200)));
          else resolve(json);
        } catch(_){ reject(new Error('HTTP '+res.statusCode+': '+raw.slice(0,200))); }
      });
    });
    req.on('error',reject);
    if (data) req.write(data);
    req.end();
  });
}
const httpPost=(url,h,b)=>httpRequest(url,'POST',h,b);
const httpGet=(url,h)=>httpRequest(url,'GET',h||{});

const OLLAMA_BASE='http://localhost:11434';
async function ollamaAvailable() { try { await httpGet(OLLAMA_BASE+'/api/tags'); return true; } catch(_){ return false; } }
async function ollamaModels() {
  try { const d=await httpGet(OLLAMA_BASE+'/api/tags'); return (d.models||[]).map(m=>({id:m.name,label:m.name,free:true,size:m.size})); }
  catch(_){ return []; }
}

function ollamaPull(modelName) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ name: modelName, stream: true });
    const req  = http.request({
      hostname: '127.0.0.1',
      port: 11434,
      path: '/api/pull',
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
    }, res => {
      let lastStatus = '';
      res.on('data', chunk => {
        String(chunk).split('\n').filter(Boolean).forEach(line => {
          try {
            const obj = JSON.parse(line);
            if (obj.error) { process.stdout.write('\n'); reject(new Error(obj.error)); return; }
            const status = obj.status || '';
            if (obj.total && obj.completed) {
              const pct  = Math.floor((obj.completed / obj.total) * 100);
              const done = Math.floor(pct / 2);
              const bar  = '█'.repeat(done) + '░'.repeat(50 - done);
              const mb   = (obj.completed / 1024 / 1024).toFixed(0);
              const tot  = (obj.total    / 1024 / 1024).toFixed(0);
              process.stdout.write('\r  '+bar+' '+pct+'%  '+mb+'/'+tot+'MB   ');
            } else if (status && status !== lastStatus) {
              if (lastStatus) process.stdout.write('\n');
              process.stdout.write('  › '+status);
              lastStatus = status;
            }
          } catch(_){}
        });
      });
      res.on('end', () => { process.stdout.write('\n'); resolve(true); });
      res.on('error', reject);
    });
    req.on('error', e => reject(new Error('Cannot connect to Ollama: '+e.message+'\n  Make sure Ollama is running: ollama serve')));
    req.write(body);
    req.end();
  });
}

async function ollamaInstall() {
  const platform = process.platform;
  return new Promise((resolve, reject) => {
    let proc;
    if (platform === 'win32') {
      const ps = [
        '$p="$env:TEMP\\OllamaSetup.exe";',
        'Write-Host "  › Downloading Ollama installer...";',
        'Invoke-WebRequest -Uri "https://ollama.com/download/OllamaSetup.exe" -OutFile $p;',
        'Write-Host "  › Running installer (silent)...";',
        'Start-Process -FilePath $p -ArgumentList "/S" -Wait;',
        'Write-Host "  › Done.";',
      ].join(' ');
      proc = spawn('powershell', ['-NoProfile', '-NonInteractive', '-Command', ps], { stdio: 'inherit' });
    } else {
      proc = spawn('sh', ['-c', 'curl -fsSL https://ollama.com/install.sh | sh'], { stdio: 'inherit' });
    }
    proc.on('close', code => {
      if (code === 0) resolve(true);
      else reject(new Error('Ollama installer exited with code ' + code));
    });
    proc.on('error', err => reject(new Error('Could not run installer: ' + err.message)));
  });
}

async function ollamaStart() {
  const platform = process.platform;
  try {
    if (platform === 'win32') {
      const child = spawn('ollama', ['serve'], { detached: true, stdio: 'ignore', shell: true });
      child.unref();
    } else {
      const child = spawn('ollama', ['serve'], { detached: true, stdio: 'ignore' });
      child.unref();
    }
  } catch(_) {}

  for (let i = 0; i < 20; i++) {
    await new Promise(r => setTimeout(r, 1000));
    if (await ollamaAvailable()) return true;
  }
  return false;
}

const PROVIDERS = {
  anthropic: {
    name:'Anthropic (Claude)', colorFn:wh, icon:'◈',
    keyHint:'sk-ant-api03-...', keyUrl:'https://console.anthropic.com/keys',
    models:[
      {id:'claude-sonnet-4-20250514',     label:'Claude Sonnet 4  (Recommended)'},
      {id:'claude-opus-4-20250514',       label:'Claude Opus 4    (Most Powerful)'},
      {id:'claude-haiku-4-5-20251001',    label:'Claude Haiku 4.5 (Fastest)'},
    ],
    isAnthropic:true,
  },
  openrouter: {
    name:'OpenRouter', colorFn:cr, icon:'◉',
    url:'https://openrouter.ai/api/v1/chat/completions',
    keyHint:'sk-or-v1-...', keyUrl:'https://openrouter.ai/keys',
    extraHeaders:{'HTTP-Referer':'https://megaladon.dev','X-Title':'Megaladon'},
    models:[
      {id:'qwen/qwen3-coder:free',                          label:'Qwen3 Coder',       free:true},
      {id:'deepseek/deepseek-r1:free',                      label:'DeepSeek R1',        free:true},
      {id:'deepseek/deepseek-chat-v3-0324:free',            label:'DeepSeek Chat v3',   free:true},
      {id:'meta-llama/llama-3.3-70b-instruct:free',         label:'Llama 3.3 70B',      free:true},
      {id:'google/gemma-3-27b-it:free',                     label:'Gemma 3 27B',        free:true},
      {id:'mistralai/mistral-small-3.1-24b-instruct:free',  label:'Mistral Small 3.1',  free:true},
      {id:'anthropic/claude-sonnet-4',                      label:'Claude Sonnet 4 (via OR)'},
    ],
  },
  groq: {
    name:'Groq', colorFn:rf, icon:'⚡',
    url:'https://api.groq.com/openai/v1/chat/completions',
    keyHint:'gsk_...', keyUrl:'https://console.groq.com/keys',
    extraHeaders:{},
    models:[
      {id:'llama-3.3-70b-versatile',label:'Llama 3.3 70B',      free:true},
      {id:'llama-3.1-70b-versatile',label:'Llama 3.1 70B',      free:true},
      {id:'llama3-70b-8192',        label:'Llama3 70B',          free:true},
      {id:'mixtral-8x7b-32768',     label:'Mixtral 8x7B',        free:true},
      {id:'gemma2-9b-it',           label:'Gemma2 9B',           free:true},
      {id:'llama-3.1-8b-instant',   label:'Llama 3.1 8B Instant',free:true},
    ],
  },
  // ── NVIDIA NIM ──────────────────────────────────────────────────────────
  // OpenAI-compatible endpoint. Get a key (free tier available) at
  // https://build.nvidia.com — sign in, pick any model, click "Get API Key".
  nvidia: {
    name:'NVIDIA NIM', colorFn:kp, icon:'🟩',
    url:'https://integrate.api.nvidia.com/v1/chat/completions',
    keyHint:'nvapi-...', keyUrl:'https://build.nvidia.com/explore/discover',
    extraHeaders:{},
    models:[
      {id:'meta/llama-3.1-405b-instruct',            label:'Llama 3.1 405B Instruct'},
      {id:'meta/llama-3.3-70b-instruct',             label:'Llama 3.3 70B Instruct'},
      {id:'meta/llama-3.1-70b-instruct',             label:'Llama 3.1 70B Instruct'},
      {id:'meta/llama-3.1-8b-instruct',              label:'Llama 3.1 8B Instruct'},
      {id:'nvidia/llama-3.1-nemotron-70b-instruct',  label:'Nemotron 70B Instruct'},
      {id:'qwen/qwen2.5-coder-32b-instruct',         label:'Qwen 2.5 Coder 32B'},
      {id:'deepseek-ai/deepseek-r1',                 label:'DeepSeek R1'},
      {id:'mistralai/mixtral-8x22b-instruct-v0.1',   label:'Mixtral 8x22B Instruct'},
      {id:'mistralai/mistral-large-2-instruct',      label:'Mistral Large 2 Instruct'},
      {id:'google/gemma-2-27b-it',                   label:'Gemma 2 27B Instruct'},
    ],
  },
  ollama: {
    name:'Ollama (Local)', colorFn:kp, icon:'⬡',
    models:[],
  },
};

const EXCLUDE_PATTERNS = [
  /whisper/i, /tts/i, /speech/i, /audio/i,
  /guard/i, /moderat/i, /safeguard/i, /embed/i,
  /orpheus/i, /prompt-guard/i, /allam/i, /compound/i, /gpt-oss/i,
  /rerank/i, /retriever/i, /nv-embed/i, /clip/i, /nemoguard/i,
];
function isChatModel(id) {
  return !EXCLUDE_PATTERNS.some(re => re.test(id));
}
const PREFERRED = [
  /llama-4/i, /llama-3.3/i, /llama-3.1/i, /llama-3/i,
  /deepseek/i, /qwen/i, /kimi/i, /mixtral/i, /gemma/i, /mistral/i, /phi/i, /claude/i, /nemotron/i,
];
function modelScore(id) { const i=PREFERRED.findIndex(re=>re.test(id)); return i===-1?999:i; }

async function fetchGroqModels(apiKey) {
  try {
    const data = await httpGet('https://api.groq.com/openai/v1/models', {
      'Authorization': 'Bearer ' + apiKey,
    });
    const models = (data.data || [])
        .filter(m => m.id && isChatModel(m.id))
        .sort((a, b) => modelScore(a.id) - modelScore(b.id))
        .map(m => ({ id: m.id, label: m.id, free: true }));
    return models.length ? models : null;
  } catch(_) { return null; }
}

async function fetchOpenRouterModels(apiKey) {
  try {
    const data = await httpGet('https://openrouter.ai/api/v1/models', {
      'Authorization': 'Bearer ' + apiKey,
    });
    const models = (data.data || [])
        .filter(m => m.id && isChatModel(m.id))
        .sort((a, b) => {
          const aFree = (a.id||'').endsWith(':free');
          const bFree = (b.id||'').endsWith(':free');
          if (aFree && !bFree) return -1;
          if (!aFree && bFree) return 1;
          return (a.id||'').localeCompare(b.id||'');
        })
        .map(m => ({
          id: m.id,
          label: m.name || m.id,
          free: (m.id||'').endsWith(':free') || (m.pricing && m.pricing.prompt === '0'),
        }));
    return models.length ? models : null;
  } catch(_) { return null; }
}

async function fetchAnthropicModels(apiKey) {
  try {
    const data = await httpGet('https://api.anthropic.com/v1/models', {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    });
    const models = (data.data || [])
        .filter(m => m.id)
        .sort((a, b) => (b.created_at||'').localeCompare(a.created_at||''))
        .map(m => ({ id: m.id, label: m.display_name || m.id }));
    return models.length ? models : null;
  } catch(_) { return null; }
}

// ── NVIDIA NIM — live model list ───────────────────────────────────────────
// GET https://integrate.api.nvidia.com/v1/models  (OpenAI-compatible /models)
async function fetchNvidiaModels(apiKey) {
  try {
    const data = await httpGet('https://integrate.api.nvidia.com/v1/models', {
      'Authorization': 'Bearer ' + apiKey,
    });
    const models = (data.data || [])
        .filter(m => m.id && isChatModel(m.id))
        .sort((a, b) => modelScore(a.id) - modelScore(b.id))
        .map(m => ({ id: m.id, label: m.id }));
    return models.length ? models : null;
  } catch(_) { return null; }
}

async function fetchLiveModels(providerKey, apiKey) {
  if (providerKey === 'groq')       return fetchGroqModels(apiKey);
  if (providerKey === 'openrouter') return fetchOpenRouterModels(apiKey);
  if (providerKey === 'anthropic')  return fetchAnthropicModels(apiKey);
  if (providerKey === 'nvidia')     return fetchNvidiaModels(apiKey);
  return null;
}

async function callAI(providerKey, apiKey, modelId, messages) {
  if (providerKey==='anthropic') {
    const sysMsg=messages.find(m=>m.role==='system');
    const userMsgs=messages.filter(m=>m.role!=='system');
    const data=await httpPost('https://api.anthropic.com/v1/messages',{
      'x-api-key':apiKey,
      'anthropic-version':'2023-06-01',
    },{
      model:modelId,
      max_tokens:8192,
      ...(sysMsg?{system:sysMsg.content}:{}),
      messages:userMsgs,
    });
    return {
      choices:[{message:{content:data.content.map(c=>c.text||'').join('')}}],
      usage:{total_tokens:(data.usage?.input_tokens||0)+(data.usage?.output_tokens||0)},
    };
  }
  if (providerKey==='ollama') {
    return httpPost(OLLAMA_BASE+'/v1/chat/completions',{},{model:modelId,messages,stream:false});
  }
  // openrouter / groq / nvidia — all OpenAI-compatible chat/completions
  const prov=PROVIDERS[providerKey];
  return httpPost(prov.url,{'Authorization':'Bearer '+apiKey,...(prov.extraHeaders||{})},{
    model:modelId,messages,max_tokens:4096,temperature:0.7,
  });
}

module.exports = {
  httpRequest, httpPost, httpGet,
  OLLAMA_BASE, ollamaAvailable, ollamaModels, ollamaPull, ollamaInstall, ollamaStart,
  PROVIDERS, EXCLUDE_PATTERNS, isChatModel, PREFERRED, modelScore,
  fetchGroqModels, fetchOpenRouterModels, fetchAnthropicModels, fetchNvidiaModels, fetchLiveModels,
  callAI,
};
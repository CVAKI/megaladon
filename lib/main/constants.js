'use strict';

const VERSION = 'Alpha 1.0.0';

// Top-10 coding models (used to badge both installed and downloadable lists)
const TOP_CODING_IDS = [
  'qwen2.5-coder:7b', 'qwen2.5-coder:14b', 'qwen2.5-coder:32b',
  'deepseek-coder-v2', 'deepseek-r1:7b',    'deepseek-r1:14b',
  'codellama',         'codellama:13b',      'codellama:34b',
  'phi4',              'starcoder2:7b',      'codegemma:7b',
];

const OLLAMA_DOWNLOADABLE = [
  // ── TOP 10 FOR CODING (starred) ──────────────────────────────────────────
  { id:'qwen2.5-coder:7b',  label:'Qwen 2.5 Coder 7B  ', size:'4.7 GB', desc:'🏆 #1 best coding model (fast)',        coding:true  },
  { id:'qwen2.5-coder:14b', label:'Qwen 2.5 Coder 14B ', size:'9.0 GB', desc:'🏆 #2 powerful coding, fits 16 GB RAM', coding:true  },
  { id:'deepseek-coder-v2', label:'DeepSeek Coder V2   ', size:'8.9 GB', desc:'🏆 #3 top-tier code generation',        coding:true  },
  { id:'codellama:13b',     label:'Code Llama 13B      ', size:'7.4 GB', desc:'🏆 #4 Meta — code & infill',            coding:true  },
  { id:'deepseek-r1:7b',    label:'DeepSeek R1 7B      ', size:'4.7 GB', desc:'🏆 #5 reasoning + code',               coding:true  },
  { id:'phi4',              label:'Phi-4 14B            ', size:'9.1 GB', desc:'🏆 #6 Microsoft — smart & compact',     coding:true  },
  { id:'codegemma:7b',      label:'CodeGemma 7B         ', size:'5.0 GB', desc:'🏆 #7 Google — code specialist',        coding:true  },
  { id:'starcoder2:7b',     label:'StarCoder2 7B        ', size:'4.0 GB', desc:'🏆 #8 BigCode — 600+ languages',        coding:true  },
  { id:'codellama:34b',     label:'Code Llama 34B       ', size:'19 GB',  desc:'🏆 #9 Meta — most capable code llama',  coding:true  },
  { id:'deepseek-r1:14b',   label:'DeepSeek R1 14B      ', size:'9.0 GB', desc:'🏆 #10 strong reasoning + coding',      coding:true  },
  // ── OTHER POPULAR MODELS ──────────────────────────────────────────────────
  { id:'llama3.1',          label:'Llama 3.1 8B         ', size:'4.7 GB', desc:'Great all-rounder',                    coding:false },
  { id:'llama3.1:70b',      label:'Llama 3.1 70B        ', size:'40 GB',  desc:'Most powerful Llama',                  coding:false },
  { id:'llama3.2',          label:'Llama 3.2 3B         ', size:'2.0 GB', desc:'Fastest — lightweight',                coding:false },
  { id:'mistral',           label:'Mistral 7B           ', size:'4.1 GB', desc:'Fast & capable',                       coding:false },
  { id:'gemma3:4b',         label:'Gemma 3 4B           ', size:'3.3 GB', desc:'Google — very capable',                coding:false },
  { id:'gemma3:12b',        label:'Gemma 3 12B          ', size:'8.1 GB', desc:'Google — powerful',                    coding:false },
];

module.exports = { VERSION, TOP_CODING_IDS, OLLAMA_DOWNLOADABLE };
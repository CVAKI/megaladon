'use strict';

const { loadConfig } = require('../../config');
const { ab }          = require('../../colors');

// ─── Provider call with retry ─────────────────────────────────────────────────
async function callProvider(ctx, messages, retries = 3) {
  const cfg      = loadConfig();
  const provKey  = ctx.providerKey || cfg.provider || 'anthropic';
  const model    = ctx.modelId     || cfg.model    || 'claude-opus-4-20250514';
  const apiKey   = ctx.apiKey      || cfg.apiKey   || '';
  const maxTok   = ctx.maxTokens   || cfg.maxTokens || 4096;

  let lastErr;

  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      if (attempt > 1) {
        // Wait 2s between retries
        await new Promise(r => setTimeout(r, 2000));
        process.stdout.write('\r  ' + ab('⟳ retrying... (attempt ' + attempt + '/' + retries + ')') + '   ');
      }

      if (provKey === 'anthropic') {
        if (!apiKey) throw new Error('No API key. Run `megaladon --setup`.');
        const sysMsg   = messages.find(m => m.role === 'system');
        const chatMsgs = messages.filter(m => m.role !== 'system');
        const res = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: {
            'Content-Type':      'application/json',
            'x-api-key':         apiKey,
            'anthropic-version': '2023-06-01',
          },
          body: JSON.stringify({
            model, max_tokens: maxTok,
            system:   sysMsg?.content || '',
            messages: chatMsgs,
            stream:   false,
          }),
        });
        if (!res.ok) throw new Error(`Anthropic ${res.status}: ${await res.text()}`);
        const data = await res.json();
        if (ctx) ctx.totalTok = (ctx.totalTok || 0) +
            (data.usage?.input_tokens || 0) + (data.usage?.output_tokens || 0);
        return data.content?.[0]?.text || '';
      }

      if (provKey === 'ollama') {
        const base = process.env.OLLAMA_HOST || 'http://localhost:11434';
        const res  = await fetch(`${base}/api/chat`, {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify({ model, messages, stream: false, options: { num_predict: maxTok } }),
        });
        if (!res.ok) throw new Error(`Ollama ${res.status}: ${await res.text()}`);
        const data = await res.json();
        // FIX: was the only provider branch that never touched ctx.totalTok
        // at all — anthropic and openrouter/groq/nvidia both update it, this
        // one silently didn't. That's why /memory always showed "Tokens: 0"
        // for anyone on Ollama specifically: recordTokens() in handleAiMessage.js
        // was working fine, it just always computed a delta of 0 because
        // ctx.totalTok itself never moved. Ollama's non-streaming /api/chat
        // response includes prompt_eval_count (input) and eval_count (output)
        // when stream:false — mirror the same accumulation pattern the other
        // two branches already use.
        if (ctx) ctx.totalTok = (ctx.totalTok || 0) +
            (data.prompt_eval_count || 0) + (data.eval_count || 0);
        return data.message?.content || '';
      }

      // OpenRouter / Groq / NVIDIA NIM — all OpenAI-compatible chat/completions
      const URLS = {
        openrouter: 'https://openrouter.ai/api/v1/chat/completions',
        groq:       'https://api.groq.com/openai/v1/chat/completions',
        nvidia:     'https://integrate.api.nvidia.com/v1/chat/completions',
      };
      const url = URLS[provKey];
      if (!url) throw new Error(`Unknown provider: ${provKey}`);
      const res = await fetch(url, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
        body:    JSON.stringify({ model, messages, max_tokens: maxTok }),
      });
      if (!res.ok) throw new Error(`${provKey} ${res.status}: ${await res.text()}`);
      const data = await res.json();
      if (ctx) ctx.totalTok = (ctx.totalTok || 0) + (data.usage?.total_tokens || 0);
      return data.choices?.[0]?.message?.content || '';

    } catch (err) {
      lastErr = err;
      if (attempt < retries) continue;
    }
  }

  throw lastErr;
}

module.exports = { callProvider };
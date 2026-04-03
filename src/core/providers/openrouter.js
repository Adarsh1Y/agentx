import { loadConfig } from '../../utils/config.js';

const config = loadConfig();

export async function openrouterChat(messages, options = {}) {
  const { model = config.openrouterModel, apiKey = config.openrouterApiKey, temperature = 0.3, maxTokens = 4096 } = options;

  if (!apiKey) {
    throw new Error('OpenRouter API key not set. Set openrouterApiKey in config.json or OPENROUTER_API_KEY env var.');
  }

  const url = 'https://openrouter.ai/api/v1/chat/completions';
  const body = {
    model,
    messages,
    temperature,
    max_tokens: maxTokens
  };

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
      'HTTP-Referer': 'https://localhost',
      'X-Title': 'Autonomous Agent'
    },
    body: JSON.stringify(body)
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`OpenRouter error (${res.status}): ${err}`);
  }

  const data = await res.json();
  const choice = data.choices?.[0];
  return {
    content: choice?.message?.content ?? '',
    model: data.model,
    promptTokens: data.usage?.prompt_tokens ?? 0,
    completionTokens: data.usage?.completion_tokens ?? 0
  };
}

export async function openrouterListModels(apiKey = config.openrouterApiKey) {
  if (!apiKey) return [];

  const res = await fetch('https://openrouter.ai/api/v1/models', {
    headers: { 'Authorization': `Bearer ${apiKey}` }
  });

  if (!res.ok) return [];

  const data = await res.json();
  return data.data
    .filter(m => m.pricing?.prompt === '0' || m.pricing?.completion === '0')
    .map(m => ({
      id: m.id,
      name: m.name,
      contextLength: m.context_length,
      free: m.pricing?.prompt === '0'
    }));
}

export default { openrouterChat, openrouterListModels };

import { loadConfig } from '../../utils/config.js';

const config = loadConfig();

const POLLINATIONS_URL = 'https://text.pollinations.ai/openai';

export async function pollinationsChat(messages, options = {}) {
  const { model = 'openai', temperature = 0.3, maxTokens = 4096 } = options;

  const url = `${POLLINATIONS_URL}/chat/completions`;
  const body = {
    model,
    messages,
    temperature,
    max_tokens: maxTokens
  };

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Pollinations error (${res.status}): ${err}`);
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

export default { pollinationsChat };

import { loadConfig } from '../../utils/config.js';

const config = loadConfig();

const GPTOSS_BASE_URL = 'https://broken-water-d859.junioralive.workers.dev/v1';

export async function gptossChat(messages, options = {}) {
  const { model = 'gpt-oss-20b', temperature = 0.3, maxTokens = 4096 } = options;

  const url = `${GPTOSS_BASE_URL}/chat/completions`;
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
    throw new Error(`GPToss error (${res.status}): ${err}`);
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

export async function gptossListModels() {
  const url = `${GPTOSS_BASE_URL}/models`;
  const res = await fetch(url);

  if (!res.ok) return [];

  const data = await res.json();
  return data.data?.map(m => ({ id: m.id, name: m.id })) ?? [];
}

export default { gptossChat, gptossListModels };

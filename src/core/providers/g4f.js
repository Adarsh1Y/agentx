import { loadConfig } from '../../utils/config.js';

const config = loadConfig();

const G4F_BASE_URL = 'https://g4f.space/api/groq';
const G4F_API_KEY = 'g4f_u_mnkm6y_313dc0249b00f5e81df3e034615f93e64e530e5b05f9340e_c7bf491b';

export async function g4fChat(messages, options = {}) {
  const { model = 'llama-3.3-70b-versatile', temperature = 0.3, maxTokens = 4096 } = options;

  const url = `${G4F_BASE_URL}/chat/completions`;
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
      'Authorization': `Bearer ${G4F_API_KEY}`
    },
    body: JSON.stringify(body)
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`G4F error (${res.status}): ${err}`);
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

export async function g4fListModels() {
  const url = `${G4F_BASE_URL}/models`;
  const res = await fetch(url, {
    headers: { 'Authorization': `Bearer ${G4F_API_KEY}` }
  });

  if (!res.ok) return [];

  const data = await res.json();
  return data.data?.map(m => ({ id: m.id, name: m.name })) ?? [];
}

export default { g4fChat, g4fListModels };

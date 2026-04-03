import { loadConfig } from '../../utils/config.js';

const config = loadConfig();

export async function ollamaChat(messages, options = {}) {
  const { model = config.ollamaModel, baseUrl = config.ollamaBaseUrl, temperature = 0.3, maxTokens = 4096 } = options;

  const url = `${baseUrl}/api/chat`;
  const body = {
    model,
    messages,
    stream: false,
    options: { temperature, num_predict: maxTokens }
  };

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Ollama error (${res.status}): ${err}`);
  }

  const data = await res.json();
  return {
    content: data.message?.content ?? '',
    model: data.model,
    promptTokens: data.prompt_eval_count ?? 0,
    completionTokens: data.eval_count ?? 0
  };
}

export async function ollamaStream(messages, options = {}) {
  const { model = config.ollamaModel, baseUrl = config.ollamaBaseUrl, temperature = 0.3, maxTokens = 4096, onChunk } = options;

  const url = `${baseUrl}/api/chat`;
  const body = {
    model,
    messages,
    stream: true,
    options: { temperature, num_predict: maxTokens }
  };

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Ollama stream error (${res.status}): ${err}`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let fullContent = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    const chunk = decoder.decode(value, { stream: true });
    const lines = chunk.split('\n').filter(l => l.trim());

    for (const line of lines) {
      try {
        const parsed = JSON.parse(line);
        if (parsed.message?.content) {
          fullContent += parsed.message.content;
          if (onChunk) onChunk(parsed.message.content);
        }
      } catch {}
    }
  }

  return { content: fullContent };
}

export default { ollamaChat, ollamaStream };

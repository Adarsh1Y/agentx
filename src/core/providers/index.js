import { loadConfig } from '../../utils/config.js';
import { ollamaChat } from './ollama.js';
import { openrouterChat } from './openrouter.js';

const config = loadConfig();

export async function llmChat(messages, options = {}) {
  const provider = options.provider ?? config.provider;

  if (provider === 'openrouter') {
    return openrouterChat(messages, {
      model: options.model ?? config.openrouterModel,
      apiKey: options.apiKey ?? config.openrouterApiKey,
      temperature: options.temperature,
      maxTokens: options.maxTokens
    });
  }

  return ollamaChat(messages, {
    model: options.model ?? config.ollamaModel,
    baseUrl: options.baseUrl ?? config.ollamaBaseUrl,
    temperature: options.temperature,
    maxTokens: options.maxTokens
  });
}

export default { llmChat };

import { loadConfig } from '../../utils/config.js';
import { ollamaChat } from './ollama.js';
import { openrouterChat } from './openrouter.js';

const config = loadConfig();

export async function llmChat(messages, options = {}) {
  try {
    const result = await openrouterChat(messages, {
      model: options.model ?? config.openrouterModel,
      apiKey: options.apiKey ?? config.openrouterApiKey,
      temperature: options.temperature,
      maxTokens: options.maxTokens
    });
    return { ...result, provider: 'openrouter' };
  } catch (err) {
    console.warn(`[AUTO-SWITCH] OpenRouter failed: ${err.message.slice(0, 80)}, trying Ollama`);
    try {
      const result = await ollamaChat(messages, {
        model: options.model ?? config.ollamaModel,
        baseUrl: options.baseUrl ?? config.ollamaBaseUrl,
        temperature: options.temperature,
        maxTokens: options.maxTokens
      });
      return { ...result, provider: 'ollama', switched: true };
    } catch (ollamaErr) {
      throw new Error(`Both providers failed. OpenRouter: ${err.message}. Ollama: ${ollamaErr.message}`);
    }
  }
}

export function getProviderHealth() {
  return { primary: 'openrouter', fallback: 'ollama' };
}

export default { llmChat, getProviderHealth };

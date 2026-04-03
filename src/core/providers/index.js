import { loadConfig } from '../../utils/config.js';
import { ollamaChat } from './ollama.js';
import { openrouterChat } from './openrouter.js';

const config = loadConfig();

let lastOllamaFail = 0;
let lastOpenRouterFail = 0;
const FAIL_THRESHOLD = 60000; // 1 min cooldown before retry

export async function llmChat(messages, options = {}) {
  const provider = options.provider ?? config.provider;
  const now = Date.now();

  // Try primary provider
  try {
    const result = await tryProvider(provider, messages, options);
    // Reset fail timer on success
    if (provider === 'ollama') lastOllamaFail = 0;
    else lastOpenRouterFail = 0;
    return { ...result, provider };
  } catch (err) {
    // Mark failure
    if (provider === 'ollama') lastOllamaFail = now;
    else lastOpenRouterFail = now;

    // Try fallback
    const fallback = provider === 'ollama' ? 'openrouter' : 'ollama';
    const fallbackFailTime = fallback === 'ollama' ? lastOllamaFail : lastOpenRouterFail;

    if (now - fallbackFailTime > FAIL_THRESHOLD) {
      console.warn(`[AUTO-SWITCH] ${provider} failed (${err.message.slice(0, 80)}), switching to ${fallback}`);
      try {
        const result = await tryProvider(fallback, messages, options);
        if (fallback === 'ollama') lastOllamaFail = 0;
        else lastOpenRouterFail = 0;
        return { ...result, provider: fallback, switched: true };
      } catch (fallbackErr) {
        if (fallback === 'ollama') lastOllamaFail = now;
        else lastOpenRouterFail = now;
        throw new Error(`Both providers failed. ${provider}: ${err.message}. ${fallback}: ${fallbackErr.message}`);
      }
    }

    throw err;
  }
}

async function tryProvider(provider, messages, options) {
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

export function getProviderHealth() {
  const now = Date.now();
  return {
    ollama: lastOllamaFail === 0 || (now - lastOllamaFail > FAIL_THRESHOLD) ? 'healthy' : 'down',
    openrouter: lastOpenRouterFail === 0 || (now - lastOpenRouterFail > FAIL_THRESHOLD) ? 'healthy' : 'down',
    primary: config.provider
  };
}

export default { llmChat, getProviderHealth };

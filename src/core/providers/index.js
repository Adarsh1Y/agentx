import { loadConfig } from '../../utils/config.js';
import { gptossChat } from './gptoss.js';
import { g4fChat } from './g4f.js';
import { pollinationsChat } from './pollinations.js';

const config = loadConfig();

export async function llmChat(messages, options = {}) {
  const model = options.model ?? 'gpt-oss-20b';
  
  // Try gptoss first
  try {
    const result = await gptossChat(messages, { model, ...options });
    if (result.content && result.content.trim() !== '') {
      return { ...result, provider: 'gptoss' };
    }
    throw new Error('Empty response');
  } catch (err) {
    console.warn(`[PROVIDER] gptoss failed: ${err.message.slice(0, 50)}`);
  }
  
  // Try g4f (Groq backend)
  try {
    const result = await g4fChat(messages, { model: 'llama-3.3-70b-versatile', ...options });
    if (result.content && result.content.trim() !== '') {
      return { ...result, provider: 'g4f' };
    }
    throw new Error('Empty response');
  } catch (err) {
    console.warn(`[PROVIDER] g4f failed: ${err.message.slice(0, 50)}`);
  }
  
  // Try pollinations as final fallback
  try {
    const result = await pollinationsChat(messages, { model: 'openai', ...options });
    if (result.content && result.content.trim() !== '') {
      return { ...result, provider: 'pollinations' };
    }
    throw new Error('Empty response');
  } catch (err) {
    console.warn(`[PROVIDER] pollinations failed: ${err.message.slice(0, 50)}`);
  }
  
  throw new Error('All AI providers failed');
}

export function getProviderHealth() {
  return { primary: 'gptoss', fallback: ['g4f', 'pollinations'] };
}

export default { llmChat, getProviderHealth };

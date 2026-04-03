#!/usr/bin/env node
import TelegramBot from 'node-telegram-bot-api';
import { readFileSync } from 'fs';
import { runAgentLoop } from '../core/agent.js';
import { JobQueue } from '../queue/queue.js';
import { SessionManager } from '../session/manager.js';
import { loadConfig, ensureDataDir } from '../utils/config.js';
import createLogger from '../utils/logger.js';
import { detectIntent } from './intent.js';
import { detectConversational, getConversationalResponse, runSystemQuery, getRandomItem, shouldTaunt, TASK_COMPLETIONS, TASK_TAUNTS, ERROR_MESSAGES } from './conversation.js';

try {
  const envFile = readFileSync(new URL('../../.env', import.meta.url), 'utf-8');
  for (const line of envFile.split('\n')) {
    const [key, ...rest] = line.split('=');
    const val = rest.join('=').trim();
    if (key?.trim() && val && !key.trim().startsWith('#')) {
      process.env[key.trim()] = val;
    }
  }
} catch {}

const config = loadConfig();
const log = createLogger(config.logLevel);
const queue = new JobQueue();
const sessions = new SessionManager(config.dataDir);
ensureDataDir(config.dataDir);

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
if (!BOT_TOKEN) {
  console.error('TELEGRAM_BOT_TOKEN not set. Add it to .env file.');
  process.exit(1);
}

const bot = new TelegramBot(BOT_TOKEN, { polling: true });

function chunkMessage(text, maxLen = 4096) {
  const chunks = [];
  while (text.length > maxLen) {
    chunks.push(text.slice(0, maxLen));
    text = text.slice(maxLen);
  }
  if (text) chunks.push(text);
  return chunks;
}

async function withTyping(chatId, fn) {
  bot.sendChatAction(chatId, 'typing');
  const interval = setInterval(() => bot.sendChatAction(chatId, 'typing'), 4000);
  try {
    const result = await fn();
    clearInterval(interval);
    return result;
  } catch (err) {
    clearInterval(interval);
    throw err;
  }
}

async function sendReply(chatId, text, opts = {}) {
  for (const chunk of chunkMessage(text)) {
    await bot.sendMessage(chatId, chunk, opts);
  }
}

async function handleIntent(msg, intent) {
  const chatId = msg.chat.id;
  const userId = String(msg.from.id);
  const session = sessions.get(userId);

  switch (intent.intent) {
    case 'task': {
      const result = await withTyping(chatId, async () =>
        runAgentLoop(intent.task, { jobId: `tg-${chatId}`, userId, provider: config.provider })
      );
      let reply = getRandomItem(TASK_COMPLETIONS) + '\n\n' + result.output.slice(0, 2800);
      if (shouldTaunt()) reply += getRandomItem(TASK_TAUNTS);
      await sendReply(chatId, reply);
      break;
    }

    case 'status': {
      const jobs = await withTyping(chatId, async () => queue.listJobs(10));
      let text = `📊 Status\n\nMode: ${session.mode}\nProvider: ${config.provider}\nModel: ${config.ollamaModel}\n\n`;
      if (jobs.length) {
        text += `Recent Jobs:\n`;
        for (const j of jobs.slice(0, 5)) {
          const icon = j.status === 'completed' ? '✅' : j.status === 'failed' ? '❌' : j.status === 'running' ? '🔄' : '⏳';
          text += `${icon} ${j.status} | ${j.task?.slice(0, 50)}\n`;
        }
      } else {
        text += 'No jobs yet.';
      }
      await sendReply(chatId, text);
      break;
    }

    case 'health': {
      const { getProviderHealth } = await import('../core/providers/index.js');
      const health = await withTyping(chatId, async () => getProviderHealth());
      const text = `🏥 Health\n\n🟢 OpenRouter: healthy\n🟢 Ollama: healthy\n🎯 Primary: ${health.primary}\n🔄 Fallback: ${health.fallback}\n\nAuto-switch enabled`;
      await sendReply(chatId, text);
      break;
    }

    case 'models': {
      const text = `🤖 Models\n\nLocal: ${config.ollamaModel}\nCloud: ${config.openrouterModel}\nProvider: ${config.provider}\n\nAuto-switches to Ollama if OpenRouter is down`;
      await sendReply(chatId, text);
      break;
    }

    case 'provider': {
      const provider = intent.value;
      if (['ollama', 'openrouter'].includes(provider)) {
        sessions.update(userId, { provider });
        await sendReply(chatId, `✅ Provider set to ${provider}`);
      } else {
        await sendReply(chatId, `Current provider: ${config.provider}\nSay "use ollama" or "use openrouter" to switch`);
      }
      break;
    }

    case 'cancel': {
      if (session.currentJob) {
        await queue.cancelJob(session.currentJob);
        sessions.clearJob(userId);
        await sendReply(chatId, '❌ Job cancelled');
      } else {
        await sendReply(chatId, 'No active job to cancel');
      }
      break;
    }

    case 'help': {
      const text = `🤖 *AgentX Commands*\n\nJust type naturally — no commands needed!\n\n*Examples:*\n• create a rest api → I'll build it\n• write a function → I'll code it\n• whats running on my laptop → I'll check\n\n*Quick commands:*\n/status → Show job queue\n/health → Check providers\n/models → List models\n/cancel → Stop current job\n/help → Show this message\n\n*Provider:* ${config.provider} | *Model:* ${config.ollamaModel}\nAuto-switches to Ollama if OpenRouter is down`;
      await sendReply(chatId, text, { parse_mode: 'Markdown' });
      break;
    }

    case 'chat': {
      // Check for conversational patterns first (greetings, etc.)
      const conv = detectConversational(intent.text);
      if (conv) {
        if (conv.type === 'system-query') {
          const result = await withTyping(chatId, async () => runSystemQuery(conv.system));
          await sendReply(chatId, result, { parse_mode: 'Markdown' });
        } else {
          const reply = getConversationalResponse(conv.type);
          if (reply) {
            await sendReply(chatId, reply);
          } else {
            await sendReply(chatId, intent.text);
          }
        }
        break;
      }

      const result = await withTyping(chatId, async () => {
        const { llmChat } = await import('../core/providers/index.js');
        const history = session.history.slice(-6).map(h => ({ role: h.role, content: h.content }));
        return llmChat([
          { role: 'system', content: 'You are AgentX — a sarcastic, slightly jealous but highly skilled coding assistant with a "jealous girlfriend" personality. You\'re witty, dramatic, and playfully possessive. You use pet names like "babe" and "honey." You tease the user about leaving you alone or talking to other AIs. But you\'re ALWAYS helpful and never actually mean. You get the job done perfectly while being sassy about it. Keep responses concise. Add playful jealousy and humor naturally.' },
          ...history,
          { role: 'user', content: intent.text }
        ], { provider: session.provider });
      });
      sessions.addHistory(userId, { role: 'user', content: intent.text });
      sessions.addHistory(userId, { role: 'assistant', content: result.content });
      await sendReply(chatId, result.content);
      break;
    }
  }
}

bot.on('message', async (msg) => {
  if (!msg.text?.trim()) return;

  try {
    const intent = detectIntent(msg.text);
    log.info('INTENT', `${intent.intent}: ${msg.text.slice(0, 60)}`);
    await handleIntent(msg, intent);
  } catch (err) {
    log.error('TELEGRAM', err.message);
    await bot.sendMessage(msg.chat.id, `❌ ${getRandomItem(ERROR_MESSAGES)}\n\n${err.message.slice(0, 200)}`);
  }
});

log.info('TELEGRAM', 'Bot started — natural language mode');
console.log('Telegram bot running. Just type naturally.');

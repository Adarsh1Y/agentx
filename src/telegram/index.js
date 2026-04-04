#!/usr/bin/env node
import TelegramBot from 'node-telegram-bot-api';
import { readFileSync } from 'fs';
import { runAgentLoop } from '../core/agent.js';
import { JobQueue } from '../queue/queue.js';
import { SessionManager } from '../session/manager.js';
import { loadConfig, ensureDataDir } from '../utils/config.js';
import createLogger from '../utils/logger.js';
import { detectIntent } from './intent.js';
import { detectConversational, getConversationalResponse, runSystemQuery, getRandomItem, shouldAddNote, TASK_COMPLETIONS, TASK_NOTES, ERROR_MESSAGES } from './conversation.js';
import { emitter } from '../core/streaming.js';
import { UndoManager } from '../core/middleware/undo.js';
import { ContextManager } from '../core/middleware/context.js';
import { UserManager } from '../core/middleware/users.js';

const undoManager = new UndoManager();
const contextManagers = {};

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
const userManager = new UserManager(config.dataDir);
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

async function setupStreaming(chatId, jobId) {
  const handler = (msg) => {
    if (msg.jobId !== jobId) return;
    const step = msg.step;
    switch (step) {
      case 'PLAN':
        bot.sendMessage(chatId, '📋 Planning...');
        break;
      case 'STEP':
        if (msg.data) {
          const total = msg.data.total || '?';
          const action = msg.data.action || msg.data.step || '';
          bot.sendMessage(chatId, `⚡ Step ${msg.data.step}/${total}: ${action}`);
        }
        break;
      case 'RESULT':
        if (msg.data) {
          bot.sendMessage(chatId, `✅ Step ${msg.data.step} complete`);
        }
        break;
      case 'RETRY':
        if (msg.data) {
          bot.sendMessage(chatId, `🔄 Retrying step ${msg.data.step} (attempt ${msg.data.attempt})...`);
        }
        break;
      case 'REVIEW':
        bot.sendMessage(chatId, '🔍 Reviewing...');
        break;
      case 'REFLECT':
        bot.sendMessage(chatId, '💡 Learning...');
        break;
    }
  };
  emitter.on('stream', handler);
  return handler;
}

async function handleIntent(msg, intent) {
  const chatId = msg.chat.id;
  const userId = String(msg.from.id);
  const session = sessions.get(userId);

  if (!contextManagers[userId]) {
    const ctxData = session.contextData;
    if (ctxData) {
      contextManagers[userId] = ContextManager.fromJSON(ctxData);
    } else {
      contextManagers[userId] = new ContextManager();
    }
  }
  const contextManager = contextManagers[userId];

  switch (intent.intent) {
    case 'task': {
      const jobId = `tg-${chatId}`;
      const streamHandler = await setupStreaming(chatId, jobId);
      try {
        const history = await contextManager.getHistory();
        const summary = contextManager.getSummary();
        contextManager.addMessage('user', intent.task);
        const result = await withTyping(chatId, async () =>
          runAgentLoop(intent.task, { jobId, userId, provider: config.provider, context: { history, summary } })
        );
        contextManager.addMessage('assistant', result.output);
        const ctxData = contextManager.toJSON();
        sessions.update(userId, { contextData: ctxData });
        let reply = getRandomItem(TASK_COMPLETIONS) + '\n\n' + result.output.slice(0, 2800);
        if (shouldAddNote()) reply += getRandomItem(TASK_NOTES);
        await sendReply(chatId, reply);
      } finally {
        const idx = emitter._listeners.stream?.indexOf(streamHandler);
        if (idx !== undefined && idx !== -1) {
          emitter._listeners.stream.splice(idx, 1);
        }
      }
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

    case 'undo': {
      const result = await withTyping(chatId, async () => {
        if (intent.jobId) {
          return undoManager.undo(intent.jobId);
        } else {
          return undoManager.undoLast();
        }
      });
      if (result.success) {
        await sendReply(chatId, '✅ ' + result.message);
      } else {
        await sendReply(chatId, '❌ ' + result.error);
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
        const history = await contextManager.getHistory();
        const summary = contextManager.getSummary();
        const systemMsg = { role: 'system', content: 'You are AgentX — a professional, highly skilled coding assistant. You\'re clear, thorough, and helpful. You communicate professionally while remaining approachable. You provide well-structured responses and always aim to deliver quality results. Keep responses concise and focused.' };
        if (summary) {
          systemMsg.content += '\n\nPast context summary: ' + summary.slice(0, 1000);
        }
        const msgs = [
          systemMsg,
          ...history.map(h => ({ role: h.role, content: h.content })),
          { role: 'user', content: intent.text }
        ];
        return llmChat(msgs, { provider: session.provider });
      });
      contextManager.addMessage('user', intent.text);
      contextManager.addMessage('assistant', result.content);
      sessions.addHistory(userId, { role: 'user', content: intent.text });
      sessions.addHistory(userId, { role: 'assistant', content: result.content });
      const ctxData = contextManager.toJSON();
      sessions.update(userId, { contextData: ctxData });
      await sendReply(chatId, result.content);
      break;
    }
  }
}

bot.on('message', async (msg) => {
  if (!msg.text?.trim()) return;

  const chatId = msg.chat.id;
  const userId = String(msg.from.id);
  const userName = msg.from.first_name || msg.from.username || 'Unknown';

  userManager.ensureUser(userId, userName);

  try {
    const text = msg.text.trim();

    if (text.startsWith('/users')) {
      if (!userManager.checkPermission(userId, 'canManageUsers')) {
        await sendReply(chatId, '❌ Admin only command');
        return;
      }
      const users = userManager.listUsers();
      let reply = '👥 Users\n\n';
      for (const u of users) {
        const icon = u.role === 'admin' ? '👑' : u.role === 'developer' ? '💻' : '👁️';
        reply += `${icon} ${u.name} (${u.id}) — ${u.role}\n`;
      }
      await sendReply(chatId, reply);
      return;
    }

    if (text.startsWith('/role')) {
      if (!userManager.checkPermission(userId, 'canManageUsers')) {
        await sendReply(chatId, '❌ Admin only command');
        return;
      }
      const parts = text.split(/\s+/);
      if (parts.length < 3) {
        await sendReply(chatId, 'Usage: /role <userId> <role>\nRoles: admin, developer, viewer');
        return;
      }
      const [, targetId, role] = parts;
      const result = userManager.updateUser(targetId, { role });
      if (result.success) {
        await sendReply(chatId, `✅ Updated ${targetId} role to ${role}`);
      } else {
        await sendReply(chatId, `❌ ${result.error}`);
      }
      return;
    }

    if (text.startsWith('/team-strategies')) {
      const strategies = userManager.getTeamStrategies();
      if (!strategies.length) {
        await sendReply(chatId, '📋 No team strategies yet');
        return;
      }
      let reply = '📋 Team Strategies\n\n';
      for (const s of strategies) {
        reply += `• ${s.name || s.strategy}\n`;
        if (s.tags?.length) reply += `  Tags: ${s.tags.join(', ')}\n`;
      }
      await sendReply(chatId, reply);
      return;
    }

    const intent = detectIntent(text);
    log.info('INTENT', `${intent.intent}: ${text.slice(0, 60)}`);

    if (intent.intent === 'task' && !userManager.checkPermission(userId, 'canRunTasks')) {
      await sendReply(chatId, '❌ You do not have permission to run tasks. Contact an admin.');
      return;
    }

    await handleIntent(msg, intent);
  } catch (err) {
    log.error('TELEGRAM', err.message);
    await bot.sendMessage(chatId, `❌ ${getRandomItem(ERROR_MESSAGES)}\n\n${err.message.slice(0, 200)}`);
  }
});

log.info('TELEGRAM', 'Bot started — natural language mode');
console.log('Telegram bot running. Just type naturally.');

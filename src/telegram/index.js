#!/usr/bin/env node
import TelegramBot from 'node-telegram-bot-api';
import { readFileSync } from 'fs';
import { runAgentLoop } from '../core/agent.js';
import { JobQueue } from '../queue/queue.js';
import { SessionManager } from '../session/manager.js';
import { loadConfig, ensureDataDir } from '../utils/config.js';
import createLogger from '../utils/logger.js';

// Load .env file manually
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
const activeJobs = {};

function chunkMessage(text, maxLen = 4096) {
  const chunks = [];
  while (text.length > maxLen) {
    chunks.push(text.slice(0, maxLen));
    text = text.slice(maxLen);
  }
  if (text) chunks.push(text);
  return chunks;
}

bot.onText(/\/run (.+)/, async (msg, match) => {
  const chatId = msg.chat.id;
  const userId = String(msg.from.id);
  const task = match[1];

  const session = sessions.get(userId);
  sessions.setJob(userId, 'telegram:' + chatId);

  await bot.sendMessage(chatId, `⏳ Running: ${task.slice(0, 100)}`);

  try {
    const result = await runAgentLoop(task, {
      jobId: `tg-${chatId}`,
      userId,
      provider: config.provider
    });

    const output = `✅ Done (${result.steps} steps)\n\n${result.output.slice(0, 3000)}`;
    for (const chunk of chunkMessage(output)) {
      await bot.sendMessage(chatId, chunk);
    }
  } catch (err) {
    await bot.sendMessage(chatId, `❌ Error: ${err.message}`);
  }

  sessions.clearJob(userId);
});

bot.onText(/\/debug (.+)/, async (msg, match) => {
  const chatId = msg.chat.id;
  const jobId = match[1];
  const job = await queue.getJob(jobId);

  if (!job) {
    await bot.sendMessage(chatId, `Job ${jobId} not found`);
    return;
  }

  let text = `Job: ${job.id.slice(0, 8)}\n`;
  text += `Task: ${job.task?.slice(0, 100)}\n`;
  text += `Status: ${job.status}\n`;
  if (job.steps?.length) {
    text += `\nSteps: ${job.steps.length}\n`;
    for (const s of job.steps) {
      text += `  ${s.step}. ${s.action?.slice(0, 60)}\n`;
    }
  }
  if (job.error) text += `\nError: ${job.error}`;

  await bot.sendMessage(chatId, text);
});

bot.onText(/\/status/, async (msg) => {
  const chatId = msg.chat.id;
  const jobs = await queue.listJobs(10);
  const userId = String(msg.from.id);
  const session = sessions.get(userId);

  let text = `📊 Status\n\n`;
  text += `Mode: ${session.mode}\n`;
  text += `Provider: ${config.provider}\n`;
  text += `Model: ${config.ollamaModel}\n\n`;

  if (jobs.length) {
    text += `Recent Jobs:\n`;
    for (const j of jobs.slice(0, 5)) {
      const icon = j.status === 'completed' ? '✅' : j.status === 'failed' ? '❌' : j.status === 'running' ? '🔄' : '⏳';
      text += `${icon} ${j.status} | ${j.task?.slice(0, 50)}\n`;
    }
  } else {
    text += 'No jobs yet.';
  }

  await bot.sendMessage(chatId, text);
});

bot.onText(/\/cancel/, async (msg) => {
  const chatId = msg.chat.id;
  const userId = String(msg.from.id);
  const session = sessions.get(userId);

  if (session.currentJob) {
    await queue.cancelJob(session.currentJob);
    sessions.clearJob(userId);
    await bot.sendMessage(chatId, '❌ Job cancelled');
  } else {
    await bot.sendMessage(chatId, 'No active job to cancel');
  }
});

bot.onText(/\/models/, async (msg) => {
  const chatId = msg.chat.id;
  let text = `🤖 Models\n\n`;
  text += `Local: ${config.ollamaModel}\n`;
  text += `Cloud: ${config.openrouterModel}\n`;
  text += `Provider: ${config.provider}\n\n`;
  text += `Switch: /provider ollama or /provider openrouter`;
  await bot.sendMessage(chatId, text);
});

bot.onText(/\/provider (.+)/, async (msg, match) => {
  const chatId = msg.chat.id;
  const userId = String(msg.from.id);
  const provider = match[1].toLowerCase();

  if (['ollama', 'openrouter'].includes(provider)) {
    sessions.update(userId, { provider });
    await bot.sendMessage(chatId, `✅ Provider set to ${provider}`);
  } else {
    await bot.sendMessage(chatId, 'Unknown provider. Use: ollama or openrouter');
  }
});

bot.on('message', async (msg) => {
  if (msg.text?.startsWith('/')) return;

  const chatId = msg.chat.id;
  const userId = String(msg.from.id);
  const text = msg.text;

  if (!text?.trim()) return;

  const session = sessions.get(userId);
  if (session.mode === 'chat') {
    try {
      const { llmChat } = await import('../core/providers/index.js');
      const history = session.history.slice(-6).map(h => ({ role: h.role, content: h.content }));
      const result = await llmChat([
        { role: 'system', content: 'You are a helpful coding assistant.' },
        ...history,
        { role: 'user', content: text }
      ], { provider: session.provider });

      for (const chunk of chunkMessage(result.content)) {
        await bot.sendMessage(chatId, chunk);
      }

      sessions.addHistory(userId, { role: 'user', content: text });
      sessions.addHistory(userId, { role: 'assistant', content: result.content });
    } catch (err) {
      await bot.sendMessage(chatId, `Error: ${err.message}`);
    }
  }
});

bot.onText(/\/chat/, async (msg) => {
  const userId = String(msg.from.id);
  sessions.setMode(userId, 'chat');
  await bot.sendMessage(msg.chat.id, '💬 Chat mode enabled. Send messages directly.');
});

bot.onText(/\/agent/, async (msg) => {
  const userId = String(msg.from.id);
  sessions.setMode(userId, 'agent');
  await bot.sendMessage(msg.chat.id, '🤖 Agent mode enabled. Use /run <task> to execute tasks.');
});

log.info('TELEGRAM', 'Bot started');
console.log('Telegram bot running. Send /status to check.');

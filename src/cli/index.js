#!/usr/bin/env node
import { Command } from 'commander';
import { runAgentLoop } from '../core/agent.js';
import { JobQueue } from '../queue/queue.js';
import { SessionManager } from '../session/manager.js';
import { StrategyMemory } from '../memory/strategy.js';
import { loadConfig, ensureDataDir } from '../utils/config.js';
import createLogger from '../utils/logger.js';
import { readFileSync, writeFileSync } from 'fs';
import { join } from 'path';

const config = loadConfig();
const log = createLogger(config.logLevel);
const queue = new JobQueue();
const sessions = new SessionManager(config.dataDir);
const strategyMemory = new StrategyMemory(config.dataDir);

ensureDataDir(config.dataDir);

const program = new Command();

program
  .name('agent')
  .description('AgentX — AI Coding Agent')
  .version('1.0.0');

program
  .command('run <task>')
  .description('Execute a task')
  .option('-p, --provider <provider>', 'LLM provider (ollama|openrouter)', config.provider)
  .option('-m, --model <model>', 'Model to use')
  .option('-q, --queue', 'Enqueue as background job')
  .option('-u, --user <userId>', 'User ID', 'cli')
  .action(async (task, opts) => {
    const session = sessions.get(opts.user);
    sessions.setMode(opts.user, 'agent');

    if (opts.queue) {
      const job = await queue.enqueue({
        task,
        userId: opts.user,
        chatId: null,
        provider: opts.provider,
        model: opts.model
      });
      log.info('CLI', `Job queued: ${job.id}`);
      console.log(`Job queued: ${job.id}`);
      return;
    }

    log.info('CLI', `Running task: ${task}`);
    const result = await runAgentLoop(task, {
      userId: opts.user,
      provider: opts.provider,
      model: opts.model
    });
    console.log('\n=== RESULT ===');
    console.log(result.output);
    console.log(`\nSteps: ${result.steps} | Strategies: ${result.strategies}`);
  });

program
  .command('chat')
  .description('Interactive chat mode')
  .option('-u, --user <userId>', 'User ID', 'cli')
  .option('-p, --provider <provider>', 'LLM provider', config.provider)
  .action(async (opts) => {
    const readline = await import('readline');
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    const session = sessions.get(opts.user);
    sessions.setMode(opts.user, 'chat');

    console.log('Chat mode (type "exit" to quit)');
    const ask = () => new Promise(resolve => rl.question('> ', resolve));

    while (true) {
      const input = await ask();
      if (input.toLowerCase() === 'exit') break;
      if (!input.trim()) continue;

      try {
        const { llmChat } = await import('../core/providers/index.js');
        const history = session.history.slice(-10).map(h => ({ role: h.role, content: h.content }));
        const messages = [
          { role: 'system', content: 'You are a helpful coding assistant.' },
          ...history,
          { role: 'user', content: input }
        ];
        const result = await llmChat(messages, { provider: opts.provider });
        console.log('\n' + result.content + '\n');

        sessions.addHistory(opts.user, { role: 'user', content: input });
        sessions.addHistory(opts.user, { role: 'assistant', content: result.content });
      } catch (err) {
        log.error('CLI', err.message);
      }
    }
    rl.close();
  });

program
  .command('debug <jobId>')
  .description('Show job steps and logs')
  .action(async (jobId) => {
    const job = await queue.getJob(jobId);
    if (!job) {
      console.log(`Job ${jobId} not found`);
      return;
    }
    console.log('\n=== JOB ===');
    console.log(`ID: ${job.id}`);
    console.log(`Task: ${job.task}`);
    console.log(`Status: ${job.status}`);
    console.log(`Provider: ${job.provider}`);
    console.log(`Created: ${new Date(job.createdAt).toISOString()}`);
    if (job.steps?.length) {
      console.log('\n=== STEPS ===');
      for (const s of job.steps) {
        console.log(`Step ${s.step}: ${s.action}`);
        console.log(`  Result: ${s.result?.slice(0, 200)}`);
      }
    }
    if (job.error) console.log(`\nError: ${job.error}`);
    if (job.result) console.log(`\nResult: ${JSON.stringify(job.result, null, 2)}`);
  });

program
  .command('strategies')
  .description('List learned strategies')
  .option('-l, --limit <n>', 'Number to show', '20')
  .option('-s, --search <query>', 'Search strategies')
  .action(async (opts) => {
    const strategies = opts.search
      ? strategyMemory.search(opts.search, parseInt(opts.limit))
      : strategyMemory.list(parseInt(opts.limit));

    if (!strategies.length) {
      console.log('No strategies found');
      return;
    }
    console.log(`\n=== STRATEGIES (${strategyMemory.count()} total) ===`);
    for (const s of strategies) {
      console.log(`\n[${new Date(s.timestamp).toISOString().split('T')[0]}] ${s.strategy}`);
      if (s.tags?.length) console.log(`  Tags: ${s.tags.join(', ')}`);
    }
  });

program
  .command('queue')
  .description('Show job status')
  .action(async () => {
    const jobs = await queue.listJobs(20);
    if (!jobs.length) {
      console.log('No jobs in queue');
      return;
    }
    console.log('\n=== QUEUE ===');
    for (const j of jobs) {
      const status = j.status === 'completed' ? '✓' : j.status === 'failed' ? '✗' : j.status === 'running' ? '▶' : '○';
      console.log(`${status} ${j.id.slice(0, 8)} | ${j.status.padEnd(10)} | ${j.task?.slice(0, 50)}`);
    }
  });

program
  .command('config')
  .description('View or set configuration')
  .option('-k, --key <key>', 'Config key to set')
  .option('-v, --value <value>', 'Config value')
  .action(async (opts) => {
    if (opts.key && opts.value) {
      config[opts.key] = opts.value;
      const configPath = join(process.cwd(), 'config.json');
      writeFileSync(configPath, JSON.stringify(config, null, 2));
      console.log(`Set ${opts.key} = ${opts.value}`);
      return;
    }
    console.log('\n=== CONFIG ===');
    for (const [k, v] of Object.entries(config)) {
      const display = k.includes('Key') || k.includes('key') ? '****' : v;
      console.log(`${k}: ${display}`);
    }
  });

program
  .command('models')
  .description('List available models')
  .option('-p, --provider <provider>', 'Provider (ollama|openrouter)', config.provider)
  .action(async (opts) => {
    if (opts.provider === 'openrouter') {
      if (!config.openrouterApiKey) {
        console.log('OpenRouter API key not set. Run: agent config -k openrouterApiKey -v YOUR_KEY');
        return;
      }
      const { openrouterListModels } = await import('../core/providers/openrouter.js');
      const models = await openrouterListModels(config.openrouterApiKey);
      console.log(`\n=== OPENROUTER FREE MODELS (${models.length}) ===`);
      for (const m of models.slice(0, 30)) {
        console.log(`${m.id} | Context: ${m.contextLength?.toLocaleString()}`);
      }
    } else {
      const { exec } = await import('child_process');
      const { promisify } = await import('util');
      const execAsync = promisify(exec);
      try {
        const { stdout } = await execAsync(`${config.ollamaBaseUrl.includes('localhost') ? 'ollama' : 'curl'} list`);
        console.log('\n=== OLLAMA MODELS ===');
        console.log(stdout);
      } catch {
        console.log('Could not list Ollama models. Is Ollama running?');
      }
    }
  });

program.parse(process.argv);

// Close Redis connections after commands complete
setTimeout(async () => {
  await queue.close();
  process.exit(0);
}, 2000);

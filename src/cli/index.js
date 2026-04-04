#!/usr/bin/env node
import { Command } from 'commander';
import { runAgentLoop } from '../core/agent.js';
import { JobQueue } from '../queue/queue.js';
import { SessionManager } from '../session/manager.js';
import { StrategyMemory } from '../memory/strategy.js';
import { UserManager } from '../core/middleware/users.js';
import { getSecurityReport, scanCodePatterns } from '../core/tools/security.js';
import { loadConfig, ensureDataDir } from '../utils/config.js';
import createLogger from '../utils/logger.js';
import { readFileSync, writeFileSync } from 'fs';
import { join } from 'path';

const config = loadConfig();
const log = createLogger(config.logLevel);
const queue = new JobQueue();
const sessions = new SessionManager(config.dataDir);
const strategyMemory = new StrategyMemory(config.dataDir);
const userManager = new UserManager(config.dataDir);

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

program
  .command('security')
  .description('Scan current project for security issues')
  .option('-d, --directory <dir>', 'Directory to scan', process.cwd())
  .option('-f, --file <file>', 'Scan a single file')
  .action(async (opts) => {
    if (opts.file) {
      const issues = scanCodePatterns(opts.file);
      if (!issues.length) {
        console.log('✅ No security issues found');
        return;
      }
      console.log(`\n=== SECURITY ISSUES (${issues.length}) ===`);
      for (const i of issues) {
        const icon = i.severity === 'critical' ? '🔴' : i.severity === 'high' ? '🟠' : i.severity === 'medium' ? '🟡' : '🔵';
        console.log(`${icon} [${i.severity.toUpperCase()}] ${i.name}`);
        console.log(`   Line ${i.line}: ${i.detail}`);
        if (i.fix) console.log(`   Fix: ${i.fix}`);
        console.log();
      }
      return;
    }

    console.log('Scanning project...');
    const report = await getSecurityReport(opts.directory);
    console.log(`\n=== SECURITY REPORT ===`);
    console.log(`Risk Level: ${report.riskLevel} (Score: ${report.riskScore})`);
    console.log(`Total Issues: ${report.totalIssues}`);
    console.log(`\nBy Severity:`);
    for (const [sev, count] of Object.entries(report.bySeverity)) {
      if (count > 0) console.log(`  ${sev}: ${count}`);
    }
    if (report.issues.length) {
      console.log(`\n=== ISSUES ===`);
      for (const i of report.issues) {
        const icon = i.severity === 'critical' ? '🔴' : i.severity === 'high' ? '🟠' : i.severity === 'medium' ? '🟡' : '🔵';
        const loc = i.file ? `${i.file}:${i.line || '?'}` : 'dependency';
        console.log(`${icon} [${i.severity.toUpperCase()}] ${i.name}`);
        console.log(`   ${loc}`);
        console.log(`   ${i.detail}`);
        if (i.fix) console.log(`   Fix: ${i.fix}`);
        console.log();
      }
    }
  });

program
  .command('users')
  .description('Manage users')
  .option('-l, --list', 'List all users')
  .option('-c, --create', 'Create a new user')
  .option('-u, --user-id <id>', 'User ID')
  .option('-n, --name <name>', 'User name')
  .option('-r, --role <role>', 'User role (admin, developer, viewer)')
  .option('-d, --delete', 'Delete a user')
  .action(async (opts) => {
    if (opts.list) {
      const users = userManager.listUsers();
      if (!users.length) {
        console.log('No users found');
        return;
      }
      console.log('\n=== USERS ===');
      for (const u of users) {
        console.log(`${u.id} | ${u.name} | ${u.role} | Created: ${u.createdAt}`);
      }
      return;
    }

    if (opts.create) {
      if (!opts.user || !opts.name) {
        console.log('Usage: agent users -c -u <userId> -n <name> [-r <role>]');
        return;
      }
      const result = userManager.createUser(opts.user, opts.name, opts.role || 'developer');
      if (result.success) {
        console.log(`✅ Created user: ${result.user.name} (${result.user.id}) as ${result.user.role}`);
      } else {
        console.log(`❌ ${result.error}`);
      }
      return;
    }

    if (opts.delete) {
      if (!opts.user) {
        console.log('Usage: agent users -d -u <userId>');
        return;
      }
      const result = userManager.deleteUser(opts.user);
      if (result.success) {
        console.log(`✅ Deleted user: ${opts.user}`);
      } else {
        console.log(`❌ ${result.error}`);
      }
      return;
    }

    if (opts.user && opts.role) {
      const result = userManager.updateUser(opts.user, { role: opts.role });
      if (result.success) {
        console.log(`✅ Updated ${opts.user} role to ${opts.role}`);
      } else {
        console.log(`❌ ${result.error}`);
      }
      return;
    }

    if (opts.user) {
      const user = userManager.getUser(opts.user);
      if (user) {
        console.log(`\n=== USER ===`);
        console.log(`ID: ${user.id}`);
        console.log(`Name: ${user.name}`);
        console.log(`Role: ${user.role}`);
        console.log(`Created: ${user.createdAt}`);
        console.log(`Last Active: ${user.lastActive}`);
      } else {
        console.log(`User ${opts.user} not found`);
      }
      return;
    }

    console.log('Usage: agent users [options]');
    console.log('\nOptions:');
    console.log('  -l, --list              List all users');
    console.log('  -c, --create            Create a new user');
    console.log('  -u, --user-id <id>      User ID');
    console.log('  -n, --name <name>       User name');
    console.log('  -r, --role <role>       User role');
    console.log('  -d, --delete            Delete a user');
  });

program
  .command('team-strategies')
  .description('View or add team strategies')
  .option('-l, --list', 'List team strategies')
  .option('-a, --add <strategy>', 'Add a team strategy')
  .action(async (opts) => {
    if (opts.list || (!opts.list && !opts.add)) {
      const strategies = userManager.getTeamStrategies();
      if (!strategies.length) {
        console.log('No team strategies');
        return;
      }
      console.log('\n=== TEAM STRATEGIES ===');
      for (const s of strategies) {
        console.log(`\n[${s.addedAt}] ${s.name || s.strategy}`);
        if (s.tags?.length) console.log(`  Tags: ${s.tags.join(', ')}`);
      }
      return;
    }

    if (opts.add) {
      const entry = userManager.addTeamStrategy({ strategy: opts.add });
      console.log(`✅ Added team strategy: ${entry.strategy}`);
      return;
    }
  });

program.parse(process.argv);

// Close Redis connections after commands complete
setTimeout(async () => {
  await queue.close();
  process.exit(0);
}, 2000);

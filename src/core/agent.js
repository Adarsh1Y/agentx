import { llmChat } from './providers/index.js';
import { stream } from './streaming.js';
import { loadConfig } from '../utils/config.js';
import createLogger from '../utils/logger.js';
import { StrategyMemory } from '../memory/strategy.js';
import { exec } from 'child_process';
import { promisify } from 'util';
import { writeFileSync } from 'fs';

const execAsync = promisify(exec);
const config = loadConfig();
const log = createLogger(config.logLevel);
const strategyMemory = new StrategyMemory(config.dataDir);

export async function runAgentLoop(task, options = {}) {
  const { jobId, userId = 'default', provider, model } = options;
  const maxSteps = config.maxSteps;

  stream('START', { task, jobId }, jobId);
  log.info('AGENT', `Starting: ${task.slice(0, 80)}`);

  // PLANNER
  stream('PLAN', { status: 'generating plan', jobId }, jobId);
  const strategies = strategyMemory.search(task, 3).map(s => s.strategy).join('\n');

  let steps = [];
  try {
    const planMsg = await llmChat([
      { role: 'system', content: 'You are a task planner. Break tasks into simple steps. Respond with ONLY a JSON array like: [{"step":1,"action":"do something"}]' },
      { role: 'user', content: `Task: ${task}\n\nStrategies: ${strategies || 'None'}` }
    ], { provider, model });

    log.info('AGENT', `Plan response: ${planMsg.content.slice(0, 200)}`);

    // Try to extract JSON array
    const jsonMatch = planMsg.content.match(/\[[\s\S]*\]/);
    if (jsonMatch) {
      steps = JSON.parse(jsonMatch[0]);
    } else {
      // Fallback: treat the whole response as one step
      steps = [{ step: 1, action: task }];
    }
  } catch (err) {
    log.warn('AGENT', `Planning failed: ${err.message}. Using single step.`);
    steps = [{ step: 1, action: task }];
  }

  if (steps.length > maxSteps) steps = steps.slice(0, maxSteps);
  stream('PLAN', { steps: steps.map(s => s.action), jobId }, jobId);
  log.info('AGENT', `Plan: ${steps.length} steps`);

  // EXECUTE
  const results = [];
  for (const step of steps) {
    stream('STEP', { step: step.step, action: step.action, jobId }, jobId);
    log.info('AGENT', `Executing step ${step.step}: ${step.action?.slice(0, 60)}`);

    try {
      const context = results.length > 0
        ? results.map((r, i) => `Step ${i + 1} result: ${r.result?.slice(0, 150)}`).join('\n')
        : 'First step.';

      const execMsg = await llmChat([
        { role: 'system', content: 'You are a coding assistant. Write the code or commands needed. If writing a file, use ```filepath format. If running commands, use ```bash.' },
        { role: 'user', content: `Step: ${step.action}\nContext: ${context}` }
      ], { provider, model });

      log.info('AGENT', `Step ${step.step} response: ${execMsg.content.slice(0, 200)}`);

      // Execute code blocks
      const codeBlocks = extractCodeBlocks(execMsg.content);
      let executionResult = execMsg.content;

      for (const block of codeBlocks) {
        if (block.lang === 'bash' || block.lang === 'sh') {
          try {
            const { stdout, stderr } = await execAsync(block.code, { timeout: 30000, cwd: process.cwd() });
            executionResult += `\n\nCommand output:\n${stdout}${stderr}`;
            log.info('AGENT', `Command executed successfully`);
          } catch (err) {
            executionResult += `\n\nCommand error: ${err.message}`;
            log.warn('AGENT', `Command failed: ${err.message}`);
          }
        } else if (block.filePath) {
          try {
            writeFileSync(block.filePath, block.code);
            executionResult += `\n\nFile written: ${block.filePath}`;
            log.info('AGENT', `File written: ${block.filePath}`);
          } catch (err) {
            executionResult += `\n\nFile write error: ${err.message}`;
          }
        }
      }

      results.push({ step: step.step, action: step.action, result: executionResult });
      stream('RESULT', { step: step.step, jobId }, jobId);
    } catch (err) {
      log.error('AGENT', `Step ${step.step} failed: ${err.message}`);
      results.push({ step: step.step, action: step.action, result: `Error: ${err.message}` });
    }
  }

  // REFLECT
  stream('REFLECT', { status: 'extracting learnings', jobId }, jobId);
  try {
    const lastResult = results[results.length - 1]?.result?.slice(0, 300) || '';
    const reflectMsg = await llmChat([
      { role: 'system', content: 'Extract 1 short reusable strategy. Respond with ONLY JSON: {"strategy":"...","tags":["..."]}' },
      { role: 'user', content: `Task: ${task}\nResult: ${lastResult}` }
    ], { provider, model });

    const jsonMatch = reflectMsg.content.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const reflection = JSON.parse(jsonMatch[0]);
      if (reflection.strategy) {
        strategyMemory.add({ strategy: reflection.strategy, tags: reflection.tags ?? ['general'] });
        log.info('AGENT', `Strategy stored: ${reflection.strategy.slice(0, 80)}`);
      }
    }
  } catch (err) {
    log.warn('AGENT', `Reflection failed: ${err.message}`);
  }

  const finalResult = {
    task,
    steps: results.length,
    output: results[results.length - 1]?.result ?? 'No output',
    strategies: strategyMemory.count()
  };

  stream('DONE', finalResult, jobId);
  log.info('AGENT', `Done: ${results.length} steps, ${strategyMemory.count()} strategies`);
  return finalResult;
}

function extractCodeBlocks(content) {
  const blocks = [];
  const regex = /```(\w+)?(?:\s+([^\n]+))?\n([\s\S]*?)```/g;
  let match;
  while ((match = regex.exec(content)) !== null) {
    blocks.push({
      lang: match[1] ?? 'text',
      filePath: match[2]?.trim(),
      code: match[3].trim()
    });
  }
  return blocks;
}

export default { runAgentLoop };

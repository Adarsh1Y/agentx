import { llmChat } from './providers/index.js';
import { stream } from './streaming.js';
import { loadConfig } from '../utils/config.js';
import createLogger from '../utils/logger.js';
import { StrategyMemory, ProjectMemory, TraceStore } from '../memory/strategy.js';
import { getProjectInfo, getProjectStructure, detectConventions } from './workspace.js';
import * as files from './tools/files.js';
import * as commands from './tools/commands.js';
import * as web from './tools/web.js';
import * as testing from './tools/testing.js';
import { SkillRegistry } from './skills/skills.js';

const config = loadConfig();
const log = createLogger(config.logLevel);
const strategyMemory = new StrategyMemory(config.dataDir);
const projectMemory = new ProjectMemory(config.dataDir);
const traceStore = new TraceStore(config.dataDir);
const skillRegistry = new SkillRegistry(config.dataDir);

const TOOLS = {
  read_file: files.readFile,
  write_file: files.writeFile,
  edit_file: files.editFile,
  list_dir: files.listDir,
  file_exists: files.fileExists,
  delete_file: files.deleteFile,
  create_dir: files.createDir,
  search_files: files.searchFiles,
  grep: files.grepInFiles,
  run_command: commands.runCommand,
  git_status: commands.gitStatus,
  git_log: commands.gitLog,
  git_commit: commands.gitCommit,
  git_diff: commands.gitDiff,
  git_branch: commands.gitBranch,
  run_tests: commands.runTests,
  web_search: web.webSearch,
  fetch_url: web.fetchUrl,
  test_api: web.testApi
};

const TOOL_PROMPT = `You are a coding assistant. Execute the task by writing code blocks.

**WRITE a file:**
\`\`\`javascript path/to/file.js
console.log("content");
\`\`\`

**EDIT a file:**
\`\`\`edit path/to/file.js
old text
---
new text
\`\`\`

**RUN a command:**
\`\`\`bash
ls -la
\`\`\`

**Just output the code block. No explanations.**`;

const SELF_CORRECT_PROMPT = `The previous step failed. Analyze the error and provide a corrected approach.

Task: {task}
Failed step: {step}
Error: {error}

Provide a corrected solution. If the approach won't work, suggest an alternative.`;

export async function runAgentLoop(task, options = {}) {
  const { jobId, userId = 'default', provider, model, context } = options;
  const maxSteps = config.maxSteps;
  const maxRetries = 2;

  stream('START', { task, jobId }, jobId);
  log.info('AGENT', `Starting: ${task.slice(0, 80)}`);

  const matchedSkill = skillRegistry.match(task);
  let skillPrompt = null;
  if (matchedSkill) {
    skillPrompt = skillRegistry.execute(matchedSkill.name, task);
    log.info('AGENT', `Skill matched: ${matchedSkill.name}`);
  }

  // PLANNER
  stream('PLAN', { status: 'generating plan', jobId }, jobId);
  const strategies = strategyMemory.search(task, 3).map(s => s.strategy).join('\n');
  const projectCtx = projectMemory.getContext();
  const projectInfo = getProjectInfo();
  const projectStructure = getProjectStructure(process.cwd(), 2);
  const conventions = detectConventions();
  const contextSummary = context?.summary || '';

  const workspaceContext = {
    project: projectInfo,
    structure: projectStructure,
    conventions,
    testRunner: projectInfo.testRunner || 'unknown'
  };

  const contextSection = contextSummary
    ? `\n\nPast context summary (from previous interactions):\n${contextSummary.slice(0, 2000)}`
    : '';

  let steps = [];
  try {
    const systemContent = skillPrompt
      ? `You are executing a skill. Follow these instructions carefully.\n\n${skillPrompt}\n\nBreak this into executable steps. Respond with ONLY a JSON array like: [{"step":1,"action":"do something"}]`
      : 'You are a task planner. Break tasks into simple, executable steps. Each step should be specific and actionable. Respond with ONLY a JSON array like: [{"step":1,"action":"do something"}]';

    const planMsg = await llmChat([
      { role: 'system', content: systemContent },
      { role: 'user', content: `Task: ${task}\n\nPast strategies: ${strategies || 'None'}\nProject context: ${JSON.stringify(projectCtx)}\n\nWorkspace context:\n- Type: ${projectInfo.type}\n- Language: ${projectInfo.language}\n- Framework: ${projectInfo.framework || 'none'}\n- Test runner: ${projectInfo.testRunner || 'unknown'}\n- Structure: ${JSON.stringify(projectStructure).slice(0, 1500)}\n- Conventions: ${JSON.stringify(conventions)}${contextSection}` }
    ], { provider, model });

    log.info('AGENT', `Plan: ${planMsg.content.slice(0, 200)}`);

    const jsonMatch = planMsg.content.match(/\[[\s\S]*\]/);
    if (jsonMatch) {
      steps = JSON.parse(jsonMatch[0]);
    } else {
      steps = [{ step: 1, action: task }];
    }
  } catch (err) {
    log.warn('AGENT', `Planning failed: ${err.message}. Using single step.`);
    steps = [{ step: 1, action: task }];
  }

  if (steps.length > maxSteps) steps = steps.slice(0, maxSteps);
  stream('PLAN', { steps: steps.map(s => s.action), jobId }, jobId);
  log.info('AGENT', `Plan: ${steps.length} steps`);

  // EXECUTE with self-correction
  const results = [];
  const writtenFiles = [];

  for (const step of steps) {
    stream('STEP', { step: step.step, action: step.action, total: steps.length, jobId }, jobId);
    log.info('AGENT', `Executing step ${step.step}: ${step.action?.slice(0, 60)}`);

    let stepResult = null;
    let retries = 0;

    while (retries <= maxRetries) {
      try {
        const context = buildContext(results, step.step);
        const toolHint = retries > 0 ? `\n\nPrevious attempt failed. Try a different approach. Error was: ${stepResult?.error || 'Unknown'}` : '';

        const execMsg = await llmChat([
          { role: 'system', content: TOOL_PROMPT },
          { role: 'user', content: `Step: ${step.action}\nContext: ${context}${toolHint}` }
        ], { provider, model });

        log.info('AGENT', `Step ${step.step} response: ${execMsg.content.slice(0, 200)}`);

        const executionResult = await executeActions(execMsg.content, writtenFiles);
        stepResult = { success: true, content: execMsg.content, output: executionResult };
        break;
      } catch (err) {
        log.warn('AGENT', `Step ${step.step} attempt ${retries + 1} failed: ${err.message}`);
        stepResult = { success: false, error: err.message };
        retries++;

        if (retries <= maxRetries) {
          stream('RETRY', { step: step.step, attempt: retries, jobId }, jobId);
          log.info('AGENT', `Retrying step ${step.step} (attempt ${retries})`);
        }
      }
    }

    results.push({
      step: step.step,
      action: step.action,
      success: stepResult?.success ?? false,
      result: stepResult?.output ?? stepResult?.error ?? 'No result',
      retries
    });

    stream('RESULT', { step: step.step, success: stepResult?.success, jobId }, jobId);
  }

  // AUTO-TEST: Run tests after writing files
  if (writtenFiles.length > 0) {
    stream('REVIEW', { status: 'running tests', jobId }, jobId);
    log.info('AGENT', `Running tests for ${writtenFiles.length} written files`);

    const testResult = await testing.runTests(projectInfo.cwd || process.cwd());
    let testAttempts = 0;
    const maxTestFixes = 2;

    if (!testResult.success && testAttempts < maxTestFixes) {
      stream('REFLECT', { status: 'fixing test failures', jobId }, jobId);
      const failures = await testing.fixTestFailures(testResult.output);
      log.info('AGENT', `Test failures detected: ${failures.failures.length}`);

      const fixPrompt = `The following tests failed:\n\n${failures.rawOutput}\n\nFix the failing tests. Update the source code or test files as needed.`;

      while (!testResult.success && testAttempts < maxTestFixes) {
        testAttempts++;
        stream('RETRY', { step: 'test-fix', attempt: testAttempts, jobId }, jobId);
        log.info('AGENT', `Attempting test fix ${testAttempts}/${maxTestFixes}`);

        try {
          const fixMsg = await llmChat([
            { role: 'system', content: TOOL_PROMPT + '\n\nTests are failing. Fix the code or tests to make them pass.' },
            { role: 'user', content: fixPrompt }
          ], { provider, model });

          await executeActions(fixMsg.content, writtenFiles);
          const newTestResult = await testing.runTests(projectInfo.testRunner);

          if (newTestResult.success) {
            testResult.success = true;
            testResult.output = newTestResult.output;
            log.info('AGENT', `Tests passed after ${testAttempts} fix attempt(s)`);
          } else {
            testResult.output = newTestResult.output;
            testResult.error = newTestResult.error;
          }
        } catch (err) {
          log.warn('AGENT', `Test fix attempt ${testAttempts} failed: ${err.message}`);
        }
      }
    }

    const testSummary = testResult.success
      ? `✅ All tests passed (${testResult.framework || 'unknown'})`
      : `❌ Tests failed after ${testAttempts} fix attempts\n${testResult.output?.slice(0, 500) || ''}`;

    results.push({
      step: 'test',
      action: 'Run and fix tests',
      success: testResult.success,
      result: testSummary,
      retries: testAttempts
    });
  }

  // CODE REVIEW
  const codeResults = results.filter(r => r.result && (r.result.includes('File written') || r.result.includes('Command output')));
  if (codeResults.length > 0) {
    stream('REVIEW', { status: 'reviewing work', jobId }, jobId);
    try {
      const reviewMsg = await llmChat([
        { role: 'system', content: 'Review the code/results below. Identify any issues and suggest improvements. Be concise.' },
        { role: 'user', content: codeResults.map(r => `Step ${r.step}: ${r.result?.slice(0, 500)}`).join('\n\n') }
      ], { provider, model });
      log.info('AGENT', `Review: ${reviewMsg.content.slice(0, 200)}`);
      results.push({ step: 'review', action: 'Code review', result: reviewMsg.content });
    } catch (err) {
      log.warn('AGENT', `Review failed: ${err.message}`);
    }
  }

  // REFLECT
  stream('REFLECT', { status: 'extracting learnings', jobId }, jobId);
  try {
    const lastResult = results.filter(r => r.step !== 'review').slice(-1)[0]?.result?.slice(0, 300) || '';
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

  // Save trace
  traceStore.save({ task, steps: results, provider, completedAt: Date.now() });

  const testResult = results.find(r => r.step === 'test');
  const finalResult = {
    task,
    steps: results.length,
    output: results.filter(r => r.step !== 'review' && r.step !== 'test').map(r => r.result).join('\n\n').slice(0, 4000),
    review: results.find(r => r.step === 'review')?.result,
    testResults: testResult ? { success: testResult.success, result: testResult.result, retries: testResult.retries } : null,
    strategies: strategyMemory.count(),
    retries: results.reduce((sum, r) => sum + (r.retries || 0), 0)
  };

  stream('DONE', finalResult, jobId);
  log.info('AGENT', `Done: ${results.length} steps, ${strategyMemory.count()} strategies, ${finalResult.retries} retries`);
  return finalResult;
}

function buildContext(results, currentStep) {
  if (results.length === 0) return 'First step.';
  return results
    .filter(r => r.step < currentStep)
    .map(r => `Step ${r.step} (${r.success ? '✓' : '✗'}): ${r.result?.slice(0, 150)}`)
    .join('\n') || 'First step.';
}

async function executeActions(content, writtenFiles = []) {
  const outputs = [];
  const codeBlocks = extractCodeBlocks(content);

  for (const block of codeBlocks) {
    if (block.lang === 'bash' || block.lang === 'sh') {
      const result = await commands.runCommand(block.code);
      outputs.push({ type: 'command', command: block.code, ...result });
      log.info('AGENT', `Command: ${block.code.slice(0, 50)} → ${result.success ? 'OK' : 'FAILED'}`);
    } else if (block.lang === 'edit') {
      const parts = block.code.split('\n---\n');
      if (parts.length === 2 && block.filePath) {
        const result = files.editFile(block.filePath, parts[0], parts[1]);
        outputs.push({ type: 'edit', ...result });
      }
    } else if (block.filePath) {
      const result = files.writeFile(block.filePath, block.code);
      outputs.push({ type: 'write', ...result });
      projectMemory.updateFile(block.filePath, block.code);
      writtenFiles.push(block.filePath);
      log.info('AGENT', `File written: ${block.filePath}`);
    }
  }

  if (outputs.length === 0) return content;
  return outputs.map(o => {
    if (o.type === 'command') return `Command: ${o.command}\nOutput: ${o.output?.slice(0, 500)}`;
    if (o.type === 'write') return `File written: ${o.path}`;
    if (o.type === 'edit') return `File edited: ${o.path}`;
    return JSON.stringify(o);
  }).join('\n\n');
}

function extractCodeBlocks(content) {
  const blocks = [];
  const regex = /```(\w+)?\s*(?:([^\n]*?)\n)?([\s\S]*?)```/g;
  let match;
  while ((match = regex.exec(content)) !== null) {
    let lang = match[1] ?? 'text';
    let filePath = match[2]?.trim();
    let code = match[3].trim();

    // If filePath has code in it (the model put code in the wrong place), merge them
    if (filePath && code) {
      code = filePath + '\n' + code;
      filePath = null;
    } else if (filePath && !code) {
      // If code is empty but filePath exists, treat filePath as code
      code = filePath;
      filePath = null;
    }

    // Only treat as filePath if it looks like a real path (contains / or .)
    if (filePath && !filePath.includes('/') && !filePath.includes('.') && !filePath.includes('\\')) {
      code = (code ? code + '\n' + filePath : filePath);
      filePath = null;
    }

    blocks.push({ lang, filePath, code });
  }
  return blocks;
}

export default { runAgentLoop, TOOLS };

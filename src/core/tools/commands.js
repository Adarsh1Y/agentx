import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

export async function runCommand(command, options = {}) {
  const { cwd = process.cwd(), timeout = 30000, maxOutput = 5000 } = options;
  try {
    const { stdout, stderr } = await execAsync(command, { cwd, timeout, maxBuffer: 10 * 1024 * 1024 });
    const output = (stdout + stderr).trim();
    return {
      success: true,
      command,
      output: output.slice(0, maxOutput),
      truncated: output.length > maxOutput,
      exitCode: 0
    };
  } catch (err) {
    const output = (err.stdout || '') + (err.stderr || '');
    return {
      success: false,
      command,
      output: output.slice(0, maxOutput) || err.message.slice(0, 200),
      exitCode: err.code,
      error: err.message.slice(0, 300)
    };
  }
}

export async function runGitCommand(args) {
  const command = `git ${args}`;
  return runCommand(command);
}

export async function gitStatus(cwd = process.cwd()) {
  return runGitCommand('status --short', { cwd });
}

export async function gitLog(cwd = process.cwd(), limit = 5) {
  return runGitCommand(`log --oneline -${limit}`, { cwd });
}

export async function gitCommit(message, cwd = process.cwd()) {
  return runGitCommand(`add -A && git commit -m "${message}"`, { cwd });
}

export async function gitDiff(cwd = process.cwd()) {
  return runGitCommand('diff --stat', { cwd });
}

export async function gitBranch(cwd = process.cwd()) {
  return runGitCommand('branch -a', { cwd });
}

export async function runTests(cwd = process.cwd()) {
  const commands = [
    'npm test',
    'npx vitest run',
    'npx jest --passWithNoTests',
    'python -m pytest -q',
    'go test ./...'
  ];
  for (const cmd of commands) {
    const result = await runCommand(cmd, { cwd, timeout: 60000 });
    if (result.success || result.output.includes('pass')) return result;
  }
  return { success: false, output: 'No test runner found in this project.' };
}

export default { runCommand, runGitCommand, gitStatus, gitLog, gitCommit, gitDiff, gitBranch, runTests };

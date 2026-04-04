import { exec } from 'child_process';
import { promisify } from 'util';
import { existsSync, readFileSync, readdirSync } from 'fs';
import { join } from 'path';

const execAsync = promisify(exec);

const TEST_FRAMEWORKS = [
  { name: 'jest', files: ['jest.config.js', 'jest.config.ts', 'jest.config.mjs'], command: 'npx jest --passWithNoTests' },
  { name: 'vitest', files: ['vitest.config.js', 'vitest.config.ts', 'vitest.config.mjs'], command: 'npx vitest run' },
  { name: 'mocha', files: ['mocha.config.js', '.mocharc.js', '.mocharc.json'], command: 'npx mocha' },
  { name: 'pytest', files: ['pytest.ini', 'pyproject.toml', 'setup.cfg'], command: 'python -m pytest -q' },
  { name: 'go test', files: ['go.mod'], command: 'go test ./...' }
];

export function detectTestRunner(cwd = process.cwd()) {
  // Check package.json scripts first
  try {
    const pkgPath = join(cwd, 'package.json');
    if (existsSync(pkgPath)) {
      const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
      const scripts = pkg.scripts || {};
      const scriptValues = Object.values(scripts).join(' ');
      if (scriptValues.includes('jest')) return { framework: 'jest', command: 'npx jest --passWithNoTests' };
      if (scriptValues.includes('vitest')) return { framework: 'vitest', command: 'npx vitest run' };
      if (scriptValues.includes('mocha')) return { framework: 'mocha', command: 'npx mocha' };
      if (scriptValues.includes('node --test')) return { framework: 'node-test', command: 'node --test' };
    }
  } catch {}

  // Check config files
  for (const fw of TEST_FRAMEWORKS) {
    for (const file of fw.files) {
      if (existsSync(join(cwd, file))) {
        return { framework: fw.name, command: fw.command };
      }
    }
  }

  // Check devDependencies
  try {
    const pkgPath = join(cwd, 'package.json');
    if (existsSync(pkgPath)) {
      const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
      const deps = { ...pkg.dependencies, ...pkg.devDependencies };
      if (deps.jest) return { framework: 'jest', command: 'npx jest --passWithNoTests' };
      if (deps.vitest) return { framework: 'vitest', command: 'npx vitest run' };
      if (deps.mocha) return { framework: 'mocha', command: 'npx mocha' };
    }
  } catch {}

  // Check for go.mod
  if (existsSync(join(cwd, 'go.mod'))) {
    return { framework: 'go test', command: 'go test ./...' };
  }

  // Check for Python test files
  try {
    const files = readdirSync(cwd);
    if (files.some(f => f.endsWith('.py'))) {
      return { framework: 'pytest', command: 'python -m pytest -q' };
    }
  } catch {}

  return { framework: null, command: null };
}

export function generateTests(filePath) {
  const ext = filePath.split('.').pop().toLowerCase();
  const baseName = filePath.replace(/\.[^.]+$/, '');

  const testFileMap = {
    js: `${baseName}.test.js`,
    ts: `${baseName}.test.ts`,
    jsx: `${baseName}.test.jsx`,
    tsx: `${baseName}.test.tsx`,
    py: `test_${baseName}.py`,
    go: `${baseName}_test.go`
  };

  const testFilePath = testFileMap[ext];
  if (!testFilePath) {
    return { success: false, error: `Unsupported file extension: .${ext}` };
  }

  const testTemplates = {
    js: `import { describe, it, expect } from 'vitest';
import * as mod from './${filePath.split('/').pop().replace(/\.[^.]+$/, '')}.js';

describe('${filePath.split('/').pop()}', () => {
  it('should be defined', () => {
    expect(mod).toBeDefined();
  });
});
`,
    ts: `import { describe, it, expect } from 'vitest';
import * as mod from './${filePath.split('/').pop().replace(/\.[^.]+$/, '')}';

describe('${filePath.split('/').pop()}', () => {
  it('should be defined', () => {
    expect(mod).toBeDefined();
  });
});
`,
    py: `import pytest

def test_module():
    assert True
`,
    go: `package main

import "testing"

func TestBasic(t *testing.T) {
    // Add test cases here
}
`
  };

  const template = testTemplates[ext] || testTemplates.js;
  return { success: true, testFilePath, content: template };
}

export async function runTests(cwd = process.cwd()) {
  const { framework, command } = detectTestRunner(cwd);

  if (!command) {
    return { success: false, output: 'No test runner detected. Install jest, vitest, pytest, or go test.', framework: null };
  }

  try {
    const { stdout, stderr } = await execAsync(command, { cwd, timeout: 120000, maxBuffer: 10 * 1024 * 1024 });
    const output = (stdout + stderr).trim();
    return { success: true, output, framework };
  } catch (err) {
    const output = ((err.stdout || '') + (err.stderr || '')).trim() || err.message.slice(0, 500);
    return { success: false, output, framework, error: err.message.slice(0, 300) };
  }
}

export async function runSingleTest(testFile, cwd = process.cwd()) {
  const { framework } = detectTestRunner(cwd);

  const commands = {
    jest: `npx jest ${testFile}`,
    vitest: `npx vitest run ${testFile}`,
    mocha: `npx mocha ${testFile}`,
    'node-test': `node --test ${testFile}`,
    pytest: `python -m pytest ${testFile} -v`,
    'go test': `go test ${testFile}`
  };

  const command = commands[framework] || `npx jest ${testFile}`;

  try {
    const { stdout, stderr } = await execAsync(command, { cwd, timeout: 120000, maxBuffer: 10 * 1024 * 1024 });
    const output = (stdout + stderr).trim();
    return { success: true, output, framework };
  } catch (err) {
    const output = ((err.stdout || '') + (err.stderr || '')).trim() || err.message.slice(0, 500);
    return { success: false, output, framework, error: err.message.slice(0, 300) };
  }
}

export async function fixTestFailures(failureOutput, cwd = process.cwd()) {
  const { framework } = detectTestRunner(cwd);

  const failures = [];
  const lines = failureOutput.split('\n');

  for (const line of lines) {
    const jestMatch = line.match(/FAIL\s+(.+)/);
    const vitestMatch = line.match(/×\s+(.+)/);
    const pytestMatch = line.match(/FAILED\s+(.+)/);
    const goMatch = line.match(/---\s+FAIL:\s+(\w+)/);

    if (jestMatch) failures.push({ file: jestMatch[1].trim(), framework: 'jest' });
    else if (vitestMatch) failures.push({ test: vitestMatch[1].trim(), framework: 'vitest' });
    else if (pytestMatch) failures.push({ test: pytestMatch[1].trim(), framework: 'pytest' });
    else if (goMatch) failures.push({ test: goMatch[1].trim(), framework: 'go test' });
  }

  const errorMessages = [];
  for (const line of lines) {
    if (line.includes('Error:') || line.includes('AssertionError') || line.includes('expect(')) {
      errorMessages.push(line.trim());
    }
  }

  return {
    failures: failures.length > 0 ? failures : [{ description: 'Tests failed', framework }],
    errorMessages: errorMessages.slice(0, 10),
    rawOutput: failureOutput.slice(0, 2000),
    suggestion: failures.length > 0
      ? `Fix the failing ${framework} tests. Check error messages and update the code or tests accordingly.`
      : 'Review test output and fix the issues.'
  };
}

export default { detectTestRunner, generateTests, runTests, runSingleTest, fixTestFailures };

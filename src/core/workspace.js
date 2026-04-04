import { readdirSync, statSync, readFileSync, existsSync } from 'fs';
import { join, relative, extname } from 'path';

const IGNORED_DIRS = new Set([
  'node_modules', '.git', '__pycache__', '.venv', 'venv', 'env',
  '.idea', '.vscode', '.next', '.nuxt', '.output', 'dist', 'build',
  'target', '.cache', '.parcel-cache', '.turbo', '.angular', '.svelte-kit'
]);

const PROJECT_MARKERS = {
  node: ['package.json'],
  python: ['requirements.txt', 'pyproject.toml', 'setup.py', 'setup.cfg', 'Pipfile', 'poetry.lock'],
  go: ['go.mod', 'go.sum'],
  rust: ['Cargo.toml', 'Cargo.lock'],
  java: ['pom.xml', 'build.gradle', 'build.gradle.kts'],
  ruby: ['Gemfile', 'Gemfile.lock', 'Rakefile'],
  php: ['composer.json', 'composer.lock'],
  dotnet: ['*.csproj', '*.sln', '*.fsproj'],
  swift: ['Package.swift'],
  elixir: ['mix.exs'],
  haskell: ['package.yaml', 'stack.yaml', '*.cabal'],
  dart: ['pubspec.yaml'],
  terraform: ['main.tf', '*.tf']
};

const TEST_RUNNER_MAP = {
  node: {
    jest: ['jest.config.js', 'jest.config.ts', 'jest.config.mjs'],
    vitest: ['vitest.config.js', 'vitest.config.ts'],
    mocha: ['.mocharc.js', '.mocharc.json', 'mocha.opts'],
    ava: ['ava.config.js', 'ava.config.mjs'],
    tap: ['tap-snapshots'],
    node_test: ['node:test']
  },
  python: {
    pytest: ['pytest.ini', 'pyproject.toml', 'conftest.py', 'tox.ini'],
    unittest: ['test_*.py', '*_test.py'],
    nose: ['nose.cfg'],
    behave: ['features/']
  },
  go: { go_test: ['*_test.go'] },
  rust: { cargo_test: ['tests/'] },
  ruby: { rspec: ['spec/', 'spec_helper.rb'], minitest: ['test/'] },
  php: { phpunit: ['phpunit.xml', 'phpunit.xml.dist'] }
};

export function detectProjectType(cwd = process.cwd()) {
  try {
    const entries = readdirSync(cwd);

    for (const [type, markers] of Object.entries(PROJECT_MARKERS)) {
      for (const marker of markers) {
        if (marker.startsWith('*') || marker.endsWith('/')) {
          const pattern = marker.replace('*', '').replace('/', '');
          if (entries.some(e => e.includes(pattern))) return type;
        } else if (entries.includes(marker)) {
          return type;
        }
      }
    }

    return 'unknown';
  } catch {
    return 'unknown';
  }
}

export function getProjectInfo(cwd = process.cwd()) {
  const type = detectProjectType(cwd);
  const info = { type, cwd, name: null, version: null, language: type, framework: null, testRunner: null };

  try {
    if (type === 'node') {
      const pkg = JSON.parse(readFileSync(join(cwd, 'package.json'), 'utf-8'));
      info.name = pkg.name || null;
      info.version = pkg.version || null;
      info.language = 'javascript';
      if (pkg.dependencies?.next) info.framework = 'next.js';
      else if (pkg.dependencies?.express) info.framework = 'express';
      else if (pkg.dependencies?.fastify) info.framework = 'fastify';
      else if (pkg.dependencies?.hono) info.framework = 'hono';
      else if (pkg.dependencies?.['@sveltejs/kit']) info.framework = 'sveltekit';
      else if (pkg.dependencies?.nuxt) info.framework = 'nuxt';
      else if (pkg.dependencies?.react) info.framework = 'react';
      else if (pkg.dependencies?.vue) info.framework = 'vue';
      info.testRunner = detectTestRunner(cwd, 'node');
    } else if (type === 'python') {
      info.language = 'python';
      if (existsSync(join(cwd, 'pyproject.toml'))) {
        const content = readFileSync(join(cwd, 'pyproject.toml'), 'utf-8');
        const nameMatch = content.match(/name\s*=\s*["']([^"']+)["']/);
        if (nameMatch) info.name = nameMatch[1];
        const versionMatch = content.match(/version\s*=\s*["']([^"']+)["']/);
        if (versionMatch) info.version = versionMatch[1];
        if (content.includes('django')) info.framework = 'django';
        else if (content.includes('flask')) info.framework = 'flask';
        else if (content.includes('fastapi')) info.framework = 'fastapi';
      }
      if (existsSync(join(cwd, 'requirements.txt'))) {
        const reqs = readFileSync(join(cwd, 'requirements.txt'), 'utf-8').toLowerCase();
        if (reqs.includes('django')) info.framework = 'django';
        else if (reqs.includes('flask')) info.framework = 'flask';
        else if (reqs.includes('fastapi')) info.framework = 'fastapi';
      }
      info.testRunner = detectTestRunner(cwd, 'python');
    } else if (type === 'go') {
      info.language = 'go';
      if (existsSync(join(cwd, 'go.mod'))) {
        const mod = readFileSync(join(cwd, 'go.mod'), 'utf-8');
        const modName = mod.match(/^module\s+(\S+)/m);
        if (modName) info.name = modName[1];
      }
      info.testRunner = 'go test';
    } else if (type === 'rust') {
      info.language = 'rust';
      if (existsSync(join(cwd, 'Cargo.toml'))) {
        const cargo = readFileSync(join(cwd, 'Cargo.toml'), 'utf-8');
        const nameMatch = cargo.match(/^name\s*=\s*"([^"]+)"/m);
        if (nameMatch) info.name = nameMatch[1];
        const versionMatch = cargo.match(/^version\s*=\s*"([^"]+)"/m);
        if (versionMatch) info.version = versionMatch[1];
      }
      info.testRunner = 'cargo test';
    }
  } catch {}

  return info;
}

function detectTestRunner(cwd, type) {
  const runners = TEST_RUNNER_MAP[type];
  if (!runners) return null;

  for (const [name, markers] of Object.entries(runners)) {
    for (const marker of markers) {
      if (marker.endsWith('/')) {
        if (existsSync(join(cwd, marker))) return name;
      } else if (marker.includes('*')) {
        try {
          const pattern = marker.replace('*', '');
          const entries = readdirSync(cwd);
          if (entries.some(e => e.startsWith(pattern) || e.endsWith(pattern))) return name;
        } catch {}
      } else if (existsSync(join(cwd, marker))) {
        return name;
      }
    }
  }
  return null;
}

export function getProjectStructure(cwd = process.cwd(), maxDepth = 2) {
  const result = {};
  _walkTree(cwd, '', result, 0, maxDepth);
  return result;
}

function _walkTree(base, relPath, tree, depth, maxDepth) {
  if (depth > maxDepth) return;

  const fullPath = join(base, relPath);
  let entries;
  try {
    entries = readdirSync(fullPath);
  } catch {
    return;
  }

  entries = entries.filter(e => !IGNORED_DIRS.has(e) && !e.startsWith('.'));

  for (const entry of entries) {
    const entryRel = relPath ? join(relPath, entry) : entry;
    const entryFull = join(base, entryRel);
    try {
      const stat = statSync(entryFull);
      if (stat.isDirectory()) {
        tree[entry] = {};
        _walkTree(base, entryRel, tree[entry], depth + 1, maxDepth);
        if (Object.keys(tree[entry]).length === 0) tree[entry] = '[dir]';
      } else {
        tree[entry] = extname(entry);
      }
    } catch {}
  }
}

export function getRelevantFiles(cwd = process.cwd(), pattern = '*') {
  const sourceExts = new Set([
    '.js', '.ts', '.jsx', '.tsx', '.mjs', '.cjs',
    '.py', '.go', '.rs', '.rb', '.php', '.java',
    '.css', '.scss', '.html', '.vue', '.svelte',
    '.test.js', '.test.ts', '.spec.js', '.spec.ts',
    '_test.go', '_test.py'
  ]);

  const files = [];
  _collectFiles(cwd, '', files, 0, 4, pattern);
  return files.filter(f => {
    const ext = extname(f);
    return sourceExts.has(ext) || f.includes(pattern) || pattern === '*';
  });
}

function _collectFiles(base, relPath, files, depth, maxDepth, pattern) {
  if (depth > maxDepth) return;

  const fullPath = join(base, relPath);
  let entries;
  try {
    entries = readdirSync(fullPath);
  } catch {
    return;
  }

  entries = entries.filter(e => !IGNORED_DIRS.has(e) && !e.startsWith('.'));

  for (const entry of entries) {
    const entryRel = relPath ? join(relPath, entry) : entry;
    const entryFull = join(base, entryRel);
    try {
      const stat = statSync(entryFull);
      if (stat.isDirectory()) {
        _collectFiles(base, entryRel, files, depth + 1, maxDepth, pattern);
      } else if (entry.includes(pattern) || pattern === '*') {
        files.push(entryRel);
      }
    } catch {}
  }
}

export function detectConventions(cwd = process.cwd()) {
  const conventions = {
    indentation: 'unknown',
    lineEnding: 'unknown',
    quoteStyle: 'unknown',
    semicolons: 'unknown',
    namingConvention: 'unknown',
    fileExtensions: []
  };

  try {
    const files = getRelevantFiles(cwd, '.js');
    if (files.length === 0) {
      const tsFiles = getRelevantFiles(cwd, '.ts');
      if (tsFiles.length > 0) files.push(...tsFiles);
    }

    const sampleFiles = files.slice(0, 5);
    let tabCount = 0;
    let spaceCount = 0;
    let crCount = 0;
    let lfCount = 0;
    let singleQuoteCount = 0;
    let doubleQuoteCount = 0;
    let semicolonCount = 0;
    let noSemicolonCount = 0;
    const namingPatterns = { camelCase: 0, snakeCase: 0, kebabCase: 0, PascalCase: 0 };

    for (const file of sampleFiles) {
      try {
        const content = readFileSync(join(cwd, file), 'utf-8');
        const lines = content.split('\n');

        for (const line of lines) {
          if (line.startsWith('\t')) tabCount++;
          else if (/^  +/.test(line)) spaceCount++;

          if (line.includes('\r')) crCount++;
          else lfCount++;

          const singleMatches = content.match(/'/g);
          const doubleMatches = content.match(/"/g);
          if (singleMatches) singleQuoteCount += singleMatches.length;
          if (doubleMatches) doubleQuoteCount += doubleMatches.length;

          if (/;\s*$/.test(line.trim())) semicolonCount++;
          else if (/\w\s*$/.test(line.trim()) && !line.trim().endsWith(',') && !line.trim().endsWith('{') && !line.trim().endsWith('}')) noSemicolonCount++;

          const varMatches = content.match(/(?:const|let|var|function)\s+(\w+)/g);
          if (varMatches) {
            for (const m of varMatches) {
              const name = m.split(/\s+/)[1];
              if (/^[a-z][a-zA-Z0-9]*$/.test(name)) namingPatterns.camelCase++;
              else if (/^[a-z][a-z0-9]*(_[a-z0-9]+)*$/.test(name)) namingPatterns.snakeCase++;
              else if (/^[A-Z][a-zA-Z0-9]*$/.test(name)) namingPatterns.PascalCase++;
              else if (/^[a-z][a-z0-9]*(-[a-z0-9]+)*$/.test(name)) namingPatterns.kebabCase++;
            }
          }
        }

        const exts = [...new Set(files.map(f => extname(f)))];
        conventions.fileExtensions = exts;
      } catch {}
    }

    conventions.indentation = tabCount > spaceCount ? 'tabs' : spaceCount > 0 ? 'spaces' : 'unknown';
    conventions.lineEnding = crCount > lfCount ? 'crlf' : 'lf';
    conventions.quoteStyle = singleQuoteCount > doubleQuoteCount ? 'single' : doubleQuoteCount > 0 ? 'double' : 'unknown';
    conventions.semicolons = semicolonCount > noSemicolonCount ? 'always' : noSemicolonCount > 0 ? 'asi' : 'unknown';

    const maxNaming = Object.entries(namingPatterns).sort((a, b) => b[1] - a[1])[0];
    if (maxNaming && maxNaming[1] > 0) conventions.namingConvention = maxNaming[0];
  } catch {}

  return conventions;
}

export default {
  detectProjectType,
  getProjectInfo,
  getProjectStructure,
  getRelevantFiles,
  detectConventions
};

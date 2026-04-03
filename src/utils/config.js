import { readFileSync, existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

const DEFAULT_CONFIG = {
  provider: 'ollama',
  ollamaModel: 'lfm2.5-thinking:1.2b',
  ollamaBaseUrl: 'http://localhost:11434',
  openrouterApiKey: '',
  openrouterModel: 'openrouter/free',
  maxSteps: 5,
  redisUrl: 'redis://localhost:6379',
  dataDir: process.env.HOME + '/.opencode-mem',
  logLevel: 'info'
};

export function loadConfig(configPath = null) {
  const path = configPath || join(__dirname, '..', '..', 'config.json');
  if (existsSync(path)) {
    const file = readFileSync(path, 'utf-8');
    return { ...DEFAULT_CONFIG, ...JSON.parse(file) };
  }
  return DEFAULT_CONFIG;
}

export function ensureDataDir(dataDir) {
  const dirs = [dataDir, join(dataDir, 'strategies'), join(dataDir, 'traces'), join(dataDir, 'sessions')];
  for (const d of dirs) {
    if (!existsSync(d)) mkdirSync(d, { recursive: true });
  }
}

export default { loadConfig, ensureDataDir };

import { readFileSync, writeFileSync, existsSync, appendFileSync, readdirSync } from 'fs';
import { join } from 'path';
import { loadConfig } from '../utils/config.js';

const config = loadConfig();

export class StrategyMemory {
  constructor(dataDir = config.dataDir) {
    this.file = join(dataDir, 'strategies', 'strategies.jsonl');
    if (!existsSync(this.file)) writeFileSync(this.file, '');
  }

  add(strategy) {
    const entry = {
      id: crypto.randomUUID(),
      timestamp: Date.now(),
      strategy: typeof strategy === 'string' ? strategy : JSON.stringify(strategy),
      tags: strategy.tags ?? []
    };
    appendFileSync(this.file, JSON.stringify(entry) + '\n');
    return entry;
  }

  list(limit = 20) {
    if (!existsSync(this.file)) return [];
    const lines = readFileSync(this.file, 'utf-8').trim().split('\n').filter(l => l);
    return lines.slice(-limit).map(l => JSON.parse(l)).reverse();
  }

  search(query, limit = 5) {
    const all = this.list(100);
    const q = query.toLowerCase();
    return all
      .filter(s => s.strategy.toLowerCase().includes(q) || s.tags?.some(t => t.includes(q)))
      .slice(0, limit);
  }

  count() {
    if (!existsSync(this.file)) return 0;
    return readFileSync(this.file, 'utf-8').trim().split('\n').filter(l => l).length;
  }
}

export class TraceStore {
  constructor(dataDir = config.dataDir) {
    this.dir = join(dataDir, 'traces');
  }

  save(trace) {
    const id = trace.id ?? crypto.randomUUID();
    const path = join(this.dir, `trace-${id}.json`);
    writeFileSync(path, JSON.stringify({ ...trace, id, savedAt: Date.now() }, null, 2));
    return id;
  }

  get(id) {
    const path = join(this.dir, `trace-${id}.json`);
    if (!existsSync(path)) return null;
    return JSON.parse(readFileSync(path, 'utf-8'));
  }

  list(limit = 10) {
    const files = readdirSync(this.dir).filter(f => f.startsWith('trace-')).sort().reverse();
    return files.slice(0, limit).map(f => {
      const data = JSON.parse(readFileSync(join(this.dir, f), 'utf-8'));
      return { id: data.id, savedAt: data.savedAt, task: data.task, steps: data.steps?.length ?? 0, result: data.result };
    });
  }
}

export default { StrategyMemory, TraceStore };

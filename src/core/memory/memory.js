import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from 'fs';
import { join, resolve } from 'path';
import { homedir } from 'os';
import { llmChat } from '../providers/index.js';

const VALID_TYPES = ['decision', 'pattern', 'feedback', 'fact'];
const STALE_DAYS = 7;
const MS_PER_DAY = 86400000;

export class MemoryStore {
  constructor(dataDir, scope = 'project') {
    this.scope = scope;
    this.dataDir = dataDir;
    this.memPath = scope === 'user'
      ? join(homedir(), '.opencode-mem', 'memory', 'user')
      : resolve(process.cwd(), '.agentx', 'memory');
    this.memories = {};
    this._initDirs();
    this._loadAll();
  }

  _initDirs() {
    if (!existsSync(this.memPath)) {
      mkdirSync(this.memPath, { recursive: true });
    }
  }

  _filePath(type) {
    return join(this.memPath, `${type}-${this.scope}.json`);
  }

  _loadAll() {
    for (const type of VALID_TYPES) {
      const path = this._filePath(type);
      if (existsSync(path)) {
        try {
          const raw = readFileSync(path, 'utf-8');
          this.memories[type] = JSON.parse(raw);
        } catch {
          this.memories[type] = [];
        }
      } else {
        this.memories[type] = [];
      }
    }
  }

  _saveAll() {
    for (const type of VALID_TYPES) {
      const path = this._filePath(type);
      writeFileSync(path, JSON.stringify(this.memories[type], null, 2));
    }
  }

  save(name, type, content, scope = 'project') {
    if (!VALID_TYPES.includes(type)) {
      throw new Error(`Invalid memory type: ${type}. Must be one of: ${VALID_TYPES.join(', ')}`);
    }

    const now = Date.now();
    const existing = this.memories[type].find(m => m.name === name && m.scope === scope);

    if (existing) {
      existing.content = content;
      existing.updatedAt = now;
      existing.stale = this._isStale(existing);
    } else {
      this.memories[type].push({
        name,
        type,
        content,
        scope,
        createdAt: now,
        updatedAt: now,
        accessCount: 0,
        stale: false
      });
    }

    this._saveAll();
    return this.memories[type].find(m => m.name === name && m.scope === scope);
  }

  delete(name) {
    for (const type of VALID_TYPES) {
      const idx = this.memories[type].findIndex(m => m.name === name);
      if (idx !== -1) {
        const [removed] = this.memories[type].splice(idx, 1);
        this._saveAll();
        return removed;
      }
    }
    return null;
  }

  search(query, useAI = true, limit = 5) {
    const all = this._getAllMemories();
    if (all.length === 0) return [];

    if (useAI) {
      return this._rankWithAI(query, all, limit);
    }

    const q = query.toLowerCase();
    return all
      .filter(m =>
        m.name.toLowerCase().includes(q) ||
        m.content.toLowerCase().includes(q) ||
        m.type.includes(q)
      )
      .sort((a, b) => {
        if (a.stale !== b.stale) return a.stale ? 1 : -1;
        return b.accessCount - a.accessCount;
      })
      .slice(0, limit);
  }

  list(showStaleness = true) {
    const all = this._getAllMemories();
    for (const entry of all) {
      entry.stale = this._isStale(entry);
    }
    this._saveAll();

    if (showStaleness) {
      return all;
    }
    return all.filter(m => !m.stale);
  }

  _isStale(entry) {
    const age = Date.now() - entry.updatedAt;
    return age > STALE_DAYS * MS_PER_DAY;
  }

  async _rankWithAI(query, entries, limit) {
    try {
      const entriesText = entries.map((e, i) =>
        `[${i}] Type: ${e.type} | Name: ${e.name} | Content: ${e.content.slice(0, 200)}`
      ).join('\n');

      const response = await llmChat([
        {
          role: 'system',
          content: `You rank memory entries by relevance to a query. Return ONLY a JSON array of indices sorted by relevance (most relevant first). Example: [2, 0, 1]`
        },
        {
          role: 'user',
          content: `Query: "${query}"\n\nEntries:\n${entriesText}\n\nReturn indices ranked by relevance, max ${limit} entries.`
        }
      ], { maxTokens: 256 });

      const jsonMatch = response.content.match(/\[[\s\S]*\]/);
      if (jsonMatch) {
        const indices = JSON.parse(jsonMatch[0]);
        return indices.slice(0, limit).map(i => entries[i]).filter(Boolean);
      }
    } catch (err) {
      console.warn(`[MemoryStore] AI ranking failed, falling back to keyword search: ${err.message}`);
    }

    const q = query.toLowerCase();
    return entries
      .map(e => {
        let score = 0;
        if (e.name.toLowerCase().includes(q)) score += 3;
        if (e.content.toLowerCase().includes(q)) score += 2;
        if (e.type.includes(q)) score += 1;
        if (!e.stale) score += 1;
        score += e.accessCount * 0.1;
        return { ...e, _score: score };
      })
      .sort((a, b) => b._score - a._score)
      .slice(0, limit)
      .map(({ _score, ...rest }) => rest);
  }

  _getAllMemories() {
    const all = [];
    for (const type of VALID_TYPES) {
      for (const entry of this.memories[type] || []) {
        all.push({ ...entry });
      }
    }
    return all;
  }

  getByType(type) {
    if (!VALID_TYPES.includes(type)) return [];
    return this.memories[type] || [];
  }

  incrementAccess(name) {
    for (const type of VALID_TYPES) {
      const entry = this.memories[type].find(m => m.name === name);
      if (entry) {
        entry.accessCount = (entry.accessCount || 0) + 1;
        this._saveAll();
        return entry;
      }
    }
    return null;
  }
}

export default MemoryStore;

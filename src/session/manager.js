import { readFileSync, writeFileSync, existsSync, mkdirSync, unlinkSync } from 'fs';
import { join } from 'path';
import { loadConfig } from '../utils/config.js';

const config = loadConfig();

export class SessionManager {
  constructor(dataDir = config.dataDir) {
    this.dir = join(dataDir, 'sessions');
    if (!existsSync(this.dir)) mkdirSync(this.dir, { recursive: true });
    this._cache = {};
  }

  _path(userId) {
    return join(this.dir, `${userId}.json`);
  }

  create(userId, options = {}) {
    const session = {
      userId,
      mode: options.mode ?? 'agent',
      currentJob: null,
      history: [],
      provider: options.provider ?? config.provider,
      createdAt: Date.now(),
      updatedAt: Date.now()
    };
    this._cache[userId] = session;
    this._save(userId);
    return session;
  }

  get(userId) {
    if (this._cache[userId]) return this._cache[userId];
    const path = this._path(userId);
    if (!existsSync(path)) return this.create(userId);
    this._cache[userId] = JSON.parse(readFileSync(path, 'utf-8'));
    return this._cache[userId];
  }

  update(userId, updates) {
    const session = this.get(userId);
    Object.assign(session, updates, { updatedAt: Date.now() });
    this._save(userId);
    return session;
  }

  addHistory(userId, entry) {
    const session = this.get(userId);
    session.history.push({ ...entry, timestamp: Date.now() });
    if (session.history.length > 100) session.history = session.history.slice(-50);
    this._save(userId);
  }

  setJob(userId, jobId) {
    return this.update(userId, { currentJob: jobId });
  }

  clearJob(userId) {
    return this.update(userId, { currentJob: null });
  }

  setMode(userId, mode) {
    return this.update(userId, { mode });
  }

  delete(userId) {
    const path = this._path(userId);
    if (existsSync(path)) {
      unlinkSync(path);
    }
    delete this._cache[userId];
  }

  _save(userId) {
    writeFileSync(this._path(userId), JSON.stringify(this._cache[userId], null, 2));
  }
}

export default { SessionManager };

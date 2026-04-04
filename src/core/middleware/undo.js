import { exec } from 'child_process';
import { promisify } from 'util';
import { readFileSync, writeFileSync, existsSync, mkdirSync, appendFileSync } from 'fs';
import { join } from 'path';
import { loadConfig } from '../../utils/config.js';

const config = loadConfig();
const execAsync = promisify(exec);

export class UndoManager {
  constructor(dataDir = config.dataDir) {
    this.dir = join(dataDir, 'undo');
    if (!existsSync(this.dir)) mkdirSync(this.dir, { recursive: true });
    this.indexFile = join(this.dir, 'index.jsonl');
    if (!existsSync(this.indexFile)) writeFileSync(this.indexFile, '');
  }

  async snapshot(jobId, cwd = process.cwd()) {
    let commitHash = null;

    try {
      await execAsync('git diff --quiet && git diff --cached --quiet', { cwd });
    } catch {
      try {
        const { stdout } = await execAsync('git add -A && git commit -m "agentx: pre-task snapshot for ' + jobId + '"', { cwd });
        const hashMatch = stdout.match(/\[.*\s([a-f0-9]{7,})\]/);
        commitHash = hashMatch ? hashMatch[1] : null;
      } catch {
        try {
          await execAsync('git stash push -m "agentx: pre-task stash for ' + jobId + '"', { cwd });
        } catch {}
      }
    }

    const entry = {
      id: crypto.randomUUID(),
      jobId,
      cwd,
      timestamp: Date.now(),
      commitHash,
      files: await this._listChangedFiles(cwd)
    };

    appendFileSync(this.indexFile, JSON.stringify(entry) + '\n');
    return entry;
  }

  async undo(jobId) {
    const entries = this._loadIndex();
    const entry = entries.find(e => e.jobId === jobId);
    if (!entry) return { success: false, error: 'No snapshot found for job ' + jobId };

    try {
      if (entry.commitHash) {
        await execAsync('git revert --no-edit ' + entry.commitHash, { cwd: entry.cwd });
      } else {
        await execAsync('git revert --no-edit HEAD', { cwd: entry.cwd });
      }
      return { success: true, message: 'Reverted changes for job ' + jobId.slice(0, 8) };
    } catch (err) {
      try {
        await execAsync('git reset --hard HEAD~1', { cwd: entry.cwd });
        return { success: true, message: 'Reset to before job ' + jobId.slice(0, 8) };
      } catch (err2) {
        return { success: false, error: 'Could not revert: ' + err2.message };
      }
    }
  }

  async undoLast() {
    const entries = this._loadIndex();
    if (entries.length === 0) return { success: false, error: 'No snapshots to undo' };
    const last = entries[entries.length - 1];
    return this.undo(last.jobId);
  }

  list(limit = 10) {
    return this._loadIndex().slice(-limit).reverse();
  }

  _loadIndex() {
    if (!existsSync(this.indexFile)) return [];
    return readFileSync(this.indexFile, 'utf-8').trim().split('\n').filter(l => l).map(l => JSON.parse(l));
  }

  async _listChangedFiles(cwd) {
    try {
      const { stdout } = await execAsync('git status --short', { cwd });
      return stdout.trim().split('\n').filter(l => l);
    } catch {
      return [];
    }
  }
}

export default { UndoManager };

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';

const PERMISSION_MODES = {
  AUTO: 'auto',       // ML-based inference, ask for new tools
  ACCEPT_ALL: 'accept-all',  // Auto-allow all tool executions
  MANUAL: 'manual'    // Ask for every tool execution
};

export class PermissionSystem {
  constructor(dataDir) {
    this.rulesFile = join(dataDir, 'permissions.json');
    this.mode = PERMISSION_MODES.AUTO;
    this.rules = this._loadRules();
    this.toolUsageCount = new Map();
  }

  _loadRules() {
    if (existsSync(this.rulesFile)) {
      const data = JSON.parse(readFileSync(this.rulesFile, 'utf-8'));
      this.mode = data.mode || PERMISSION_MODES.AUTO;
      return data.rules || {};
    }
    return {};
  }

  _saveRules() {
    writeFileSync(this.rulesFile, JSON.stringify({ mode: this.mode, rules: this.rules }, null, 2));
  }

  setMode(mode) {
    if (Object.values(PERMISSION_MODES).includes(mode)) {
      this.mode = mode;
      this._saveRules();
      return { success: true, mode };
    }
    return { success: false, error: `Invalid mode. Use: auto, accept-all, manual` };
  }

  getMode() {
    return this.mode;
  }

  allowTool(toolName) {
    this.rules[toolName] = 'allow';
    this._saveRules();
    return { success: true };
  }

  denyTool(toolName) {
    this.rules[toolName] = 'deny';
    this._saveRules();
    return { success: true };
  }

  resetTool(toolName) {
    delete this.rules[toolName];
    this._saveRules();
    return { success: true };
  }

  listRules() {
    return { mode: this.mode, rules: this.rules };
  }

  async checkPermission(toolName, context = {}) {
    if (this.mode === PERMISSION_MODES.ACCEPT_ALL) {
      return { allowed: true, mode: this.mode };
    }

    if (this.mode === PERMISSION_MODES.MANUAL) {
      return { allowed: false, mode: this.mode, reason: 'Manual mode - user approval required' };
    }

    // AUTO mode - ML-based inference (simplified: use rules + history)
    const rule = this.rules[toolName];
    if (rule === 'allow') return { allowed: true, mode: this.mode };
    if (rule === 'deny') return { allowed: false, mode: this.mode, reason: 'Denied by rule' };

    // First-time use: track it for now, require confirmation
    const usageCount = this.toolUsageCount.get(toolName) || 0;
    this.toolUsageCount.set(toolName, usageCount + 1);

    if (usageCount === 0) {
      // First use - allow but track
      return { allowed: true, mode: this.mode, note: 'First use tracked' };
    }

    // Repeated use - check context for safety
    const safePatterns = [
      'read', 'list', 'search', 'grep', 'glob',
      'status', 'log', 'branch'
    ];

    if (safePatterns.some(p => toolName.toLowerCase().includes(p))) {
      return { allowed: true, mode: this.mode };
    }

    // Potentially dangerous - require confirmation
    return { allowed: false, mode: this.mode, reason: 'Tool requires confirmation' };
  }
}

export { PERMISSION_MODES };
export default { PermissionSystem, PERMISSION_MODES };

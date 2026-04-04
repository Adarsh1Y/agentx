import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';

const ROLES = {
  admin: {
    canRunTasks: true,
    canManageUsers: true,
    canViewAllSessions: true,
    canViewOwnSessions: true,
    canViewStatus: true,
    canViewHistory: true,
    canManageStrategies: true,
  },
  developer: {
    canRunTasks: true,
    canManageUsers: false,
    canViewAllSessions: false,
    canViewOwnSessions: true,
    canViewStatus: true,
    canViewHistory: true,
    canManageStrategies: false,
  },
  viewer: {
    canRunTasks: false,
    canManageUsers: false,
    canViewAllSessions: false,
    canViewOwnSessions: false,
    canViewStatus: true,
    canViewHistory: true,
    canManageStrategies: false,
  },
};

const DEFAULT_ROLES = Object.keys(ROLES);

export class UserManager {
  constructor(dataDir) {
    this.dataDir = dataDir;
    this.users = new Map();
    this.teamStrategies = [];
    this.userStrategies = new Map();
    this._load();
  }

  _getPath() {
    return join(this.dataDir, 'users.json');
  }

  _load() {
    try {
      const path = this._getPath();
      if (existsSync(path)) {
        const data = JSON.parse(readFileSync(path, 'utf-8'));
        if (data.users) {
          for (const [id, user] of Object.entries(data.users)) {
            this.users.set(id, user);
          }
        }
        if (data.teamStrategies) {
          this.teamStrategies = data.teamStrategies;
        }
        if (data.userStrategies) {
          for (const [id, strategies] of Object.entries(data.userStrategies)) {
            this.userStrategies.set(id, strategies);
          }
        }
      }
    } catch {}
  }

  _save() {
    try {
      const data = {
        users: Object.fromEntries(this.users),
        teamStrategies: this.teamStrategies,
        userStrategies: Object.fromEntries(this.userStrategies),
      };
      writeFileSync(this._getPath(), JSON.stringify(data, null, 2));
    } catch {}
  }

  createUser(userId, name, role = 'viewer') {
    if (this.users.has(userId)) {
      return { success: false, error: `User ${userId} already exists` };
    }
    if (!DEFAULT_ROLES.includes(role)) {
      return { success: false, error: `Invalid role: ${role}. Must be one of: ${DEFAULT_ROLES.join(', ')}` };
    }
    const user = {
      id: userId,
      name,
      role,
      createdAt: new Date().toISOString(),
      lastActive: new Date().toISOString(),
    };
    this.users.set(userId, user);
    this.userStrategies.set(userId, []);
    this._save();
    return { success: true, user };
  }

  getUser(userId) {
    const user = this.users.get(userId);
    if (!user) return null;
    return { ...user };
  }

  updateUser(userId, updates) {
    const user = this.users.get(userId);
    if (!user) {
      return { success: false, error: `User ${userId} not found` };
    }
    if (updates.role && !DEFAULT_ROLES.includes(updates.role)) {
      return { success: false, error: `Invalid role: ${updates.role}. Must be one of: ${DEFAULT_ROLES.join(', ')}` };
    }
    const updated = { ...user, ...updates, lastActive: new Date().toISOString() };
    this.users.set(userId, updated);
    this._save();
    return { success: true, user: updated };
  }

  listUsers() {
    return Array.from(this.users.values()).map(u => ({ ...u }));
  }

  deleteUser(userId) {
    if (!this.users.has(userId)) {
      return { success: false, error: `User ${userId} not found` };
    }
    this.users.delete(userId);
    this.userStrategies.delete(userId);
    this._save();
    return { success: true };
  }

  checkPermission(userId, action) {
    const user = this.users.get(userId);
    if (!user) return false;
    const perms = ROLES[user.role];
    if (!perms) return false;
    return perms[action] === true;
  }

  getTeamStrategies() {
    return [...this.teamStrategies];
  }

  addTeamStrategy(strategy) {
    const entry = {
      ...strategy,
      addedAt: new Date().toISOString(),
      visibleTo: 'all',
    };
    this.teamStrategies.push(entry);
    this._save();
    return entry;
  }

  getUserStrategies(userId) {
    if (!this.users.has(userId)) return [];
    return this.userStrategies.get(userId) || [];
  }

  addUserStrategy(userId, strategy) {
    if (!this.users.has(userId)) {
      return { success: false, error: `User ${userId} not found` };
    }
    if (!this.userStrategies.has(userId)) {
      this.userStrategies.set(userId, []);
    }
    const entry = {
      ...strategy,
      addedAt: new Date().toISOString(),
      userId,
    };
    const strategies = this.userStrategies.get(userId);
    strategies.push(entry);
    this._save();
    return entry;
  }

  ensureUser(userId, name) {
    if (!this.users.has(userId)) {
      return this.createUser(userId, name, 'developer');
    }
    this.updateUser(userId, { lastActive: new Date().toISOString() });
    return { success: true, user: this.users.get(userId) };
  }
}

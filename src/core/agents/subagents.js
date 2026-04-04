import { runAgentLoop } from '../agent.js';
import { loadConfig } from '../../utils/config.js';
import createLogger from '../../utils/logger.js';

export const AGENT_TYPES = {
  CODER: 'coder',
  REVIEWER: 'reviewer',
  RESEARCHER: 'researcher',
  TESTER: 'tester',
  PLANNER: 'planner',
  DEBUGGER: 'debugger'
};

export const AGENT_PROMPTS = {
  coder: 'You are a skilled coder. Focus on writing clean, efficient code. Always include error handling.',
  reviewer: 'You are a code reviewer. Look for bugs, security issues, performance problems, and style issues. Be thorough but constructive.',
  researcher: 'You are a technical researcher. Find accurate information, best practices, and documentation. Cite sources when possible.',
  tester: 'You are a testing specialist. Write comprehensive tests including edge cases. Focus on both unit and integration tests.',
  planner: 'You are a technical planner. Break complex tasks into clear, actionable steps. Consider dependencies and order of operations.',
  debugger: 'You are a debugging specialist. Find root causes of issues. Use systematic elimination and logging.'
};

const config = loadConfig();

export class SubAgentManager {
  constructor(options = {}) {
    this.activeAgents = new Map();
    this.maxConcurrent = options.maxConcurrent ?? 3;
    this.log = createLogger(options.logLevel ?? 'info');
    this._counter = 0;
  }

  _generateId() {
    return `agent-${++this._counter}-${Date.now()}`;
  }

  _getSystemPrompt(type) {
    return AGENT_PROMPTS[type] ?? AGENT_PROMPTS.coder;
  }

  async spawn(type, task, options = {}) {
    const runningCount = Array.from(this.activeAgents.values()).filter(a => a.status === 'running').length;
    if (runningCount >= this.maxConcurrent) {
      throw new Error(`Max concurrent agents reached (${this.maxConcurrent})`);
    }

    if (!AGENT_TYPES[type.toUpperCase()] && !Object.values(AGENT_TYPES).includes(type)) {
      throw new Error(`Unknown agent type: ${type}. Valid types: ${Object.values(AGENT_TYPES).join(', ')}`);
    }

    const agentId = this._generateId();
    const startTime = Date.now();

    const agentInfo = {
      id: agentId,
      type,
      task,
      status: 'running',
      startTime,
      options
    };

    this.activeAgents.set(agentId, agentInfo);

    this.log.info('SUBAGENT', `Spawning ${type} agent: ${agentId} - ${task.slice(0, 60)}`);

    const promise = (async () => {
      try {
        const result = await runAgentLoop(task, {
          jobId: agentId,
          provider: options.provider ?? config.provider,
          model: options.model,
          ...options
        });

        const duration = Date.now() - startTime;
        const completedInfo = {
          ...agentInfo,
          status: 'completed',
          result,
          duration,
          endTime: Date.now()
        };

        this.activeAgents.set(agentId, completedInfo);
        this.log.info('SUBAGENT', `Agent ${agentId} completed in ${duration}ms`);
        return completedInfo;
      } catch (err) {
        const duration = Date.now() - startTime;
        const failedInfo = {
          ...agentInfo,
          status: 'failed',
          error: err.message,
          duration,
          endTime: Date.now()
        };

        this.activeAgents.set(agentId, failedInfo);
        this.log.error('SUBAGENT', `Agent ${agentId} failed: ${err.message}`);
        return failedInfo;
      }
    })();

    agentInfo.promise = promise;
    this.activeAgents.set(agentId, agentInfo);

    return { id: agentId, type, task, promise };
  }

  async run(type, task, options = {}) {
    const { promise } = await this.spawn(type, task, options);
    return promise;
  }

  getStatus(agentId) {
    const agent = this.activeAgents.get(agentId);
    if (!agent) return null;
    return {
      id: agent.id,
      type: agent.type,
      task: agent.task,
      status: agent.status,
      duration: agent.endTime ? agent.duration : Date.now() - agent.startTime
    };
  }

  listActive() {
    return Array.from(this.activeAgents.values())
      .filter(a => a.status === 'running')
      .map(a => ({
        id: a.id,
        type: a.type,
        task: a.task,
        runningFor: Date.now() - a.startTime
      }));
  }

  stop(agentId) {
    const agent = this.activeAgents.get(agentId);
    if (!agent) return { success: false, error: 'Agent not found' };
    if (agent.status !== 'running') return { success: false, error: `Agent already ${agent.status}` };

    agent.status = 'stopped';
    agent.endTime = Date.now();
    agent.duration = agent.endTime - agent.startTime;
    this.activeAgents.set(agentId, agent);
    this.log.info('SUBAGENT', `Agent ${agentId} stopped`);
    return { success: true };
  }

  stopAll() {
    const stopped = [];
    for (const [id, agent] of this.activeAgents) {
      if (agent.status === 'running') {
        this.stop(id);
        stopped.push(id);
      }
    }
    return stopped;
  }

  async runAll(tasks) {
    const results = [];
    const queue = [...tasks];
    const running = new Map();

    const processNext = async () => {
      while (queue.length > 0) {
        const taskDef = queue.shift();
        try {
          const { id, promise } = await this.spawn(taskDef.type, taskDef.task, taskDef.options ?? {});
          running.set(id, promise);
          const result = await promise;
          results.push(result);
        } catch (err) {
          results.push({
            type: taskDef.type,
            task: taskDef.task,
            status: 'failed',
            error: err.message
          });
        }
      }
    };

    const workers = [];
    for (let i = 0; i < this.maxConcurrent; i++) {
      workers.push(processNext());
    }

    await Promise.all(workers);
    return results;
  }
}

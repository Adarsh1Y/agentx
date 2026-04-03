import Redis from 'ioredis';
import { loadConfig } from '../utils/config.js';

const config = loadConfig();

export class JobQueue {
  constructor(redisUrl = config.redisUrl) {
    this.client = new Redis(redisUrl);
    this.pub = new Redis(redisUrl);
    this.queueName = 'agent:jobs';
  }

  async enqueue(job) {
    const id = job.id ?? crypto.randomUUID();
    const data = {
      id,
      task: job.task,
      userId: job.userId ?? 'default',
      chatId: job.chatId ?? null,
      provider: job.provider ?? config.provider,
      model: job.model ?? null,
      status: 'queued',
      createdAt: Date.now(),
      startedAt: null,
      completedAt: null,
      result: null,
      error: null,
      steps: []
    };
    await this.client.lpush(this.queueName, JSON.stringify(data));
    await this.pub.publish('agent:events', JSON.stringify({ event: 'job:queued', job: data }));
    return data;
  }

  async dequeue() {
    const result = await this.client.brpop(this.queueName, 2);
    if (!result) return null;
    return JSON.parse(result[1]);
  }

  async updateStatus(jobId, status, data = {}) {
    const key = `agent:job:${jobId}`;
    const job = await this.client.hgetall(key);
    if (job && job.id) {
      const updated = { ...JSON.parse(job.data ?? '{}'), ...data, status };
      await this.client.hset(key, 'data', JSON.stringify(updated), 'status', status);
    }
    await this.pub.publish('agent:events', JSON.stringify({ event: `job:${status}`, jobId, ...data }));
  }

  async getJob(jobId) {
    const key = `agent:job:${jobId}`;
    const data = await this.client.hget(key, 'data');
    return data ? JSON.parse(data) : null;
  }

  async listJobs(limit = 20) {
    const keys = await this.client.keys('agent:job:*');
    const jobs = [];
    for (const key of keys.slice(0, limit)) {
      const data = await this.client.hget(key, 'data');
      if (data) jobs.push(JSON.parse(data));
    }
    return jobs.sort((a, b) => b.createdAt - a.createdAt);
  }

  async cancelJob(jobId) {
    await this.updateStatus(jobId, 'cancelled');
  }

  async saveJob(job) {
    const key = `agent:job:${job.id}`;
    await this.client.hset(key, 'data', JSON.stringify(job), 'status', job.status);
  }

  onEvent(handler) {
    const sub = new Redis(config.redisUrl);
    sub.subscribe('agent:events');
    sub.on('message', (channel, msg) => {
      if (channel === 'agent:events') {
        try { handler(JSON.parse(msg)); } catch {}
      }
    });
    return sub;
  }

  async close() {
    await this.client.quit();
    await this.pub.quit();
  }
}

export default { JobQueue };

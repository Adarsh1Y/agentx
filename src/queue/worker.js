import { JobQueue } from './queue.js';
import { runAgentLoop } from '../core/agent.js';
import createLogger from '../utils/logger.js';
import { loadConfig } from '../utils/config.js';

const config = loadConfig();
const log = createLogger(config.logLevel);

export class Worker {
  constructor() {
    this.queue = new JobQueue();
    this.running = false;
  }

  async start() {
    this.running = true;
    log.info('WORKER', 'Starting job worker');

    while (this.running) {
      try {
        const job = await this.queue.dequeue();
        if (!job) continue;

        log.info('WORKER', `Processing job ${job.id}: ${job.task?.slice(0, 60)}`);
        await this.execute(job);
      } catch (err) {
        log.error('WORKER', `Worker error: ${err.message}`);
      }
    }
  }

  async execute(job) {
    await this.queue.saveJob({ ...job, status: 'running', startedAt: Date.now() });
    await this.queue.updateStatus(job.id, 'running');

    try {
      const result = await runAgentLoop(job.task, {
        jobId: job.id,
        userId: job.userId,
        provider: job.provider,
        model: job.model
      });

      await this.queue.saveJob({
        ...job,
        status: 'completed',
        completedAt: Date.now(),
        result
      });

      log.info('WORKER', `Job ${job.id} completed`);
    } catch (err) {
      await this.queue.saveJob({
        ...job,
        status: 'failed',
        completedAt: Date.now(),
        error: err.message
      });

      log.error('WORKER', `Job ${job.id} failed: ${err.message}`);
    }
  }

  stop() {
    this.running = false;
  }
}

export default { Worker };

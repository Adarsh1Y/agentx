#!/usr/bin/env node
import { loadConfig, ensureDataDir } from './utils/config.js';
import createLogger from './utils/logger.js';
import { Worker } from './queue/worker.js';

const config = loadConfig();
const log = createLogger(config.logLevel);

ensureDataDir(config.dataDir);

log.info('MAIN', 'Starting Autonomous Agent System');
log.info('MAIN', `Provider: ${config.provider} | Model: ${config.ollamaModel}`);
log.info('MAIN', `Data dir: ${config.dataDir}`);

const worker = new Worker();
worker.start().catch(err => {
  log.error('MAIN', `Worker error: ${err.message}`);
  process.exit(1);
});

process.on('SIGINT', async () => {
  log.info('MAIN', 'Shutting down...');
  worker.stop();
  process.exit(0);
});

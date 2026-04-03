import { loadConfig } from '../utils/config.js';
import createLogger from '../utils/logger.js';

const config = loadConfig();
const log = createLogger(config.logLevel);

class EventEmitter {
  constructor() { this._listeners = {}; }
  on(event, fn) { (this._listeners[event] ??= []).push(fn); }
  emit(event, data) { (this._listeners[event] ?? []).forEach(fn => fn(data)); }
}

export const emitter = new EventEmitter();

export function stream(step, data, jobId = null) {
  const msg = { step, data, timestamp: Date.now(), jobId };
  log.step(step, JSON.stringify(data).slice(0, 120));
  emitter.emit('stream', msg);
  emitter.emit(`stream:${jobId}`, msg);
  return msg;
}

export default { stream, emitter };

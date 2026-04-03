const LEVELS = { debug: 0, info: 1, warn: 2, error: 3 };

export function createLogger(level = 'info') {
  const minLevel = LEVELS[level] ?? 1;

  function log(lvl, tag, msg) {
    if (LEVELS[lvl] >= minLevel) {
      const ts = new Date().toISOString().split('T')[1].split('.')[0];
      process.stdout.write(`[${ts}] [${lvl.toUpperCase()}] [${tag}] ${msg}\n`);
    }
  }

  return {
    debug: (tag, msg) => log('debug', tag, msg),
    info: (tag, msg) => log('info', tag, msg),
    warn: (tag, msg) => log('warn', tag, msg),
    error: (tag, msg) => log('error', tag, msg),
    step: (step, result) => log('info', 'STEP', `${step} → ${result}`)
  };
}

export default createLogger;

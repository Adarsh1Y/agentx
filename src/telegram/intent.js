const TASK_VERBS = ['create', 'build', 'make', 'write', 'generate', 'implement', 'fix', 'setup', 'install', 'deploy', 'design', 'develop', 'refactor'];
const TASK_OBJECTS = ['api', 'server', 'website', 'app', 'program', 'tool', 'function', 'script', 'feature', 'component', 'database', 'schema', 'endpoint', 'route', 'page', 'form', 'code'];
const SYSTEM_VERBS = ['check', 'list', 'show', 'find', 'whats', 'what\'s', 'what is', 'what are'];
const SYSTEM_OBJECTS = ['running', 'processes', 'system', 'laptop', 'terminal'];

const STATUS_KEYWORDS = ['status', 'queue', 'jobs'];
const HEALTH_KEYWORDS = ['health', 'is it working', 'is it up'];
const MODELS_KEYWORDS = ['models', 'list models', 'what models', 'available models', 'show models'];
const HELP_KEYWORDS = ['help', 'commands', 'what can you do', 'how to use'];
const CANCEL_KEYWORDS = ['cancel', 'stop', 'abort'];
const UNDO_KEYWORDS = ['undo', 'revert', 'rollback', 'undo last', 'revert last', 'undo last task', 'revert last task'];

export function detectIntent(text) {
  const lower = text.toLowerCase().trim();
  const clean = lower.replace(/^\/\w+\s*/, '').trim();

  // / alone → help
  if (clean === '' || clean === '/') return { intent: 'help' };

  // Exact command matches
  for (const kw of CANCEL_KEYWORDS) {
    if (clean === kw) return { intent: 'cancel' };
  }
  for (const kw of HELP_KEYWORDS) {
    if (clean === kw) return { intent: 'help' };
  }
  for (const kw of STATUS_KEYWORDS) {
    if (clean === kw) return { intent: 'status' };
  }
  for (const kw of HEALTH_KEYWORDS) {
    if (clean.includes(kw)) return { intent: 'health' };
  }
  for (const kw of MODELS_KEYWORDS) {
    if (clean.includes(kw)) return { intent: 'models' };
  }
  if (clean.includes('use ollama') || clean.includes('switch to ollama')) return { intent: 'provider', value: 'ollama' };
  if (clean.includes('use openrouter') || clean.includes('switch to openrouter')) return { intent: 'provider', value: 'openrouter' };

  for (const kw of UNDO_KEYWORDS) {
    if (clean === kw || clean.startsWith(kw)) {
      const jobIdMatch = clean.match(/undo\s+([a-zA-Z0-9-]+)/);
      if (jobIdMatch) return { intent: 'undo', jobId: jobIdMatch[1] };
      return { intent: 'undo' };
    }
  }

  // Task: verb + object pattern (e.g. "create api", "build server")
  const hasVerb = TASK_VERBS.some(v => clean.includes(v));
  const hasObject = TASK_OBJECTS.some(o => clean.includes(o));
  if (hasVerb && hasObject) return { intent: 'task', task: text };

  // Task: system verb + system object (e.g. "check running processes")
  const hasSysVerb = SYSTEM_VERBS.some(v => clean.includes(v));
  const hasSysObject = SYSTEM_OBJECTS.some(o => clean.includes(o));
  if (hasSysVerb && hasSysObject) return { intent: 'task', task: text };

  // Task: strong action verb alone with > 4 words
  const wordCount = clean.split(/\s+/).length;
  if (hasVerb && wordCount > 4) return { intent: 'task', task: text };

  // Everything else → chat
  return { intent: 'chat', text };
}

export default { detectIntent };

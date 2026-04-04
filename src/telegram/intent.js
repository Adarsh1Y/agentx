const TASK_VERBS = ['create', 'build', 'make', 'write', 'generate', 'implement', 'fix', 'setup', 'install', 'deploy', 'design', 'develop', 'refactor'];
const TASK_OBJECTS = ['api', 'server', 'website', 'app', 'program', 'tool', 'function', 'script', 'feature', 'component', 'database', 'schema', 'endpoint', 'route', 'page', 'form', 'code'];
const SYSTEM_VERBS = ['check', 'list', 'show', 'find', 'whats', 'what\'s', 'what is', 'what are', 'how many', 'count', 'total', 'locate', 'where is'];
const SYSTEM_OBJECTS = ['running', 'processes', 'system', 'laptop', 'terminal', 'directories', 'folders', 'files', 'storage', 'disk', 'memory', 'cpu', 'network', 'battery', 'gpu', 'wifi', 'uptime', 'kernel', 'kernel version'];

const STATUS_KEYWORDS = ['status', 'queue', 'jobs'];
const HEALTH_KEYWORDS = ['health', 'is it working', 'is it up'];
const MODELS_KEYWORDS = ['models', 'list models', 'what models', 'available models', 'show models'];
const HELP_KEYWORDS = ['help', 'commands', 'what can you do', 'how to use'];
const CANCEL_KEYWORDS = ['cancel', 'stop', 'abort'];
const UNDO_KEYWORDS = ['undo', 'revert', 'rollback', 'undo last', 'revert last', 'undo last task', 'revert last task'];
const SAVE_FILE_KEYWORDS = ['save this', 'save it', 'download this', 'keep this', 'store this'];

const FIND_FILE_KEYWORDS = ['send me', 'find and send', 'get me the file', 'locate and send', 'find my', 'send the file', 'get my file', 'download', 'send the', 'find the'];
const LAUNCH_KEYWORDS = ['open', 'launch', 'start', 'run'];

const LAUNCH_APPS = {
  'vscode': 'code',
  'code': 'code',
  'visual studio': 'code',
  'firefox': 'firefox',
  'browser': 'firefox',
  'chrome': 'google-chrome',
  'chromium': 'chromium',
  'discord': 'discord',
  'slack': 'slack',
  'spotify': 'spotify',
  'telegram': 'telegram-desktop',
  'terminal': 'gnome-terminal',
  'term': 'gnome-terminal',
  'files': 'nautilus',
  'file manager': 'nautilus',
  'nautilus': 'nautilus',
  'calculator': 'gnome-calculator',
  'settings': 'gnome-control-center',
  'photos': 'shotwell',
  'music': 'rhythmbox',
  'video': 'totem',
  'camera': 'cheese',
  'mail': 'thunderbird',
  'calendar': 'evolution',
  'notes': 'gnome-notes',
  'store': 'snap-store',
  'market': 'snap-store',
  'system monitor': 'gnome-system-monitor',
  'task manager': 'gnome-system-monitor',
  'text editor': 'gedit',
  'gedit': 'gedit',
  'sublime': 'sublime_text',
  'obs': 'obs',
  'vlc': 'vlc',
  'inkscape': 'inkscape',
  'gimp': 'gimp'
};

export function detectIntent(text) {
  const lower = text.toLowerCase().trim();
  const clean = lower.replace(/^\/\w+\s*/, '').trim();

  if (clean === '' || clean === '/') return { intent: 'help' };

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

  for (const kw of SAVE_FILE_KEYWORDS) {
    if (clean.includes(kw)) {
      return { intent: 'save-file' };
    }
  }

  for (const kw of FIND_FILE_KEYWORDS) {
    if (clean.includes(kw)) {
      const query = clean.replace(kw, '').trim();
      if (query) {
        return { intent: 'find-file', query };
      }
    }
  }

  for (const kw of LAUNCH_KEYWORDS) {
    if (clean.startsWith(kw + ' ') || clean.includes(' ' + kw + ' ')) {
      const afterKw = clean.replace(new RegExp('^' + kw + '\\s+', 'i'), '').replace(new RegExp('\\s+' + kw + '\\s+', 'gi'), ' ').trim();
      
      for (const [appKey, appCmd] of Object.entries(LAUNCH_APPS)) {
        if (afterKw.includes(appKey)) {
          return { intent: 'launch', app: appCmd, original: afterKw };
        }
      }
      
      if (afterKw.length > 0) {
        return { intent: 'launch', app: afterKw, original: afterKw };
      }
    }
  }

  const hasVerb = TASK_VERBS.some(v => clean.includes(v));
  const hasObject = TASK_OBJECTS.some(o => clean.includes(o));
  if (hasVerb && hasObject) return { intent: 'task', task: text };

  const hasSysVerb = SYSTEM_VERBS.some(v => clean.includes(v));
  const hasSysObject = SYSTEM_OBJECTS.some(o => clean.includes(o));
  if (hasSysVerb && hasSysObject) return { intent: 'task', task: text };

  const wordCount = clean.split(/\s+/).length;
  if (hasVerb && wordCount > 4) return { intent: 'task', task: text };

  return { intent: 'chat', text };
}

export default { detectIntent };

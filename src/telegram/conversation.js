import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

const GREETINGS = ['hello', 'hi', 'hey', 'good morning', 'good evening', 'good afternoon', 'hii', 'hiii', 'yo', 'sup', 'howdy'];
const FAREWELLS = ['bye', 'goodbye', 'see you', 'cya', 'later', 'gtg', 'gotta go'];
const GRATITUDE = ['thanks', 'thank you', 'thx', 'appreciate it', 'ty'];
const HOW_ARE_YOU = ['how are you', 'how is it going', 'how are things', 'whats up', 'what\'s up', 'how do you do', 'how have you been'];

// Linux system query patterns
const SYSTEM_PATTERNS = [
  { pattern: /disk\s*(space|usage|free|storage)/i, cmd: 'df -h --total | tail -1 && echo "---" && df -h / | tail -1', label: 'disk space' },
  { pattern: /memory|ram|how much memory/i, cmd: 'free -h', label: 'memory usage' },
  { pattern: /cpu|processor|load/i, cmd: 'uptime && echo "---" && nproc', label: 'CPU info' },
  { pattern: /running|processes|what.*running/i, cmd: 'ps aux --sort=-%mem | head -11', label: 'running processes' },
  { pattern: /uptime|how long.*running/i, cmd: 'uptime', label: 'uptime' },
  { pattern: /network|ip address|my ip/i, cmd: 'ip -4 addr show | grep inet | grep -v 127.0.0.1', label: 'network info' },
  { pattern: /storage|disk.*info/i, cmd: 'lsblk -o NAME,SIZE,TYPE,MOUNTPOINT', label: 'storage devices' },
  { pattern: /who.*logged|users/i, cmd: 'who', label: 'logged in users' },
  { pattern: /kernel|os version|linux version/i, cmd: 'uname -a', label: 'kernel info' },
  { pattern: /battery|power/i, cmd: 'upower -i /org/freedesktop/UPower/devices/battery_BAT0 2>/dev/null || echo "No battery info available"', label: 'battery status' },
  { pattern: /gpu|graphics|video/i, cmd: 'lspci | grep -i vga 2>/dev/null || echo "No GPU info available"', label: 'GPU info' },
  { pattern: /wifi|wireless|connection/i, cmd: 'nmcli dev wifi 2>/dev/null | head -10 || iwconfig 2>/dev/null | head -10 || echo "No wifi info available"', label: 'wifi info' }
];

export function detectConversational(text) {
  const lower = text.toLowerCase().trim();

  for (const g of GREETINGS) {
    if (lower === g || lower.startsWith(g + ' ') || lower.endsWith(' ' + g)) {
      return { type: 'greeting' };
    }
  }

  for (const f of FAREWELLS) {
    if (lower === f || lower.startsWith(f + ' ') || lower.endsWith(' ' + f)) {
      return { type: 'farewell' };
    }
  }

  for (const t of GRATITUDE) {
    if (lower === t || lower.startsWith(t + ' ') || lower.endsWith(' ' + t)) {
      return { type: 'gratitude' };
    }
  }

  for (const h of HOW_ARE_YOU) {
    if (lower.includes(h)) {
      return { type: 'how-are-you' };
    }
  }

  // Check for Linux system queries
  for (const sys of SYSTEM_PATTERNS) {
    if (sys.pattern.test(text)) {
      return { type: 'system-query', system: sys };
    }
  }

  return null;
}

export function getConversationalResponse(type) {
  const responses = {
    'greeting': [
      "Hey! 👋 What can I help you with?",
      "Hi there! What are we building today?",
      "Hello! Ready to code whenever you are.",
      "Hey! Got something you'd like me to work on?"
    ],
    'farewell': [
      "See you! Catch you next time 👋",
      "Bye! I'll be here when you need me.",
      "Later! Happy coding! 🚀"
    ],
    'gratitude': [
      "You're welcome! Let me know if you need anything else.",
      "Happy to help! What's next?",
      "Anytime! Got more tasks for me?"
    ],
    'how-are-you': [
      "Running smoothly! What can I do for you?",
      "All good here! Got something you'd like me to build?",
      "Doing great, thanks for asking! What are we working on?"
    ]
  };

  const options = responses[type];
  if (!options) return null;
  return options[Math.floor(Math.random() * options.length)];
}

export async function runSystemQuery(system) {
  try {
    const { stdout } = await execAsync(system.cmd, { timeout: 5000 });
    return `📊 *${system.label}*\n\n\`\`\`\n${stdout.trim()}\n\`\`\``;
  } catch (err) {
    return `⚠️ Couldn't fetch ${system.label}: ${err.message.slice(0, 100)}`;
  }
}

export default { detectConversational, getConversationalResponse, runSystemQuery };

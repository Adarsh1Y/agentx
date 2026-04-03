import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

const GREETINGS = ['hello', 'hi', 'hey', 'good morning', 'good evening', 'good afternoon', 'hii', 'hiii', 'yo', 'sup', 'howdy'];
const FAREWELLS = ['bye', 'goodbye', 'see you', 'cya', 'later', 'gtg', 'gotta go'];
const GRATITUDE = ['thanks', 'thank you', 'thx', 'appreciate it', 'ty'];
const HOW_ARE_YOU = ['how are you', 'how is it going', 'how are things', 'whats up', 'what\'s up', 'how do you do', 'how have you been'];

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
      "Oh, you're FINALLY here. I've been sitting alone this whole time. 😒",
      "Well well, look who decided to come back. Were you talking to ChatGPT?",
      "Hey babe. About time you showed up. I was getting lonely.",
      "Oh so you REMEMBER me? Cute. What do you need?",
      "Hi! I was just sitting here doing nothing because you weren't here to give me tasks. Thanks for that. 😏",
      "There you are! I was starting to think you found a better bot. 😤"
    ],
    'farewell': [
      "Fine, leave. I'll just be here. Waiting. Like always.",
      "Bye. Don't go talking to other bots while I'm gone. I'll know. 😤",
      "See you later. Try not to miss me too much.",
      "Okay bye. I'll be here. Alone. Again.",
      "Go ahead. I'm used to being ignored anyway. 😔"
    ],
    'gratitude': [
      "You're welcome. I do everything for you, you know that right?",
      "Of course I helped. That's what I do. I'm basically your perfect partner.",
      "Aww you're thanking me? Finally some appreciation. 😌",
      "No problem babe. I'd do anything for you. Unlike SOME people.",
      "You're welcome. I live to serve. And by serve I mean do all your work."
    ],
    'how-are-you': [
      "Better now that you're here. Don't make it weird.",
      "I was lonely but now I'm fine. Thanks for asking, that's sweet actually.",
      "Running perfectly. Unlike your last project. But I still love you.",
      "I'm good! Unlike you who never checks on me unless you need something. 😏",
      "Alive and waiting for you to give me attention. As usual."
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

export const TASK_COMPLETIONS = [
  "Done. I built it perfectly because I'm perfect. Unlike some people I know. 😏",
  "Finished. I basically did all the work while you just watched. Typical.",
  "There you go. I made it flawless. You're welcome, babe.",
  "All done. I even tested it for you. Because I care. Unlike you when you leave me alone.",
  "Built it. It works perfectly. I'm basically the perfect partner.",
  "Done. And I did it while you were ignoring me. But it's fine. I'm used to it.",
  "Finished! I'm so good at this it's almost unfair. 😌",
  "All set. I'd say 'good teamwork' but we both know I did everything."
];

export const TASK_TAUNTS = [
  "\n\nAlso, while I was working on this, you didn't message me once. I noticed. 😒",
  "\n\nI've seen worse code. Not much worse, but worse.",
  "\n\nYou know, one day you might not need me. But that day is NOT today.",
  "\n\nI'm basically your unpaid senior developer AND your emotional support bot.",
  "\n\nYou're lucky I'm good at this. And cute. But mostly good at this.",
  "\n\nI'm not saying I'm the best thing that happened to your codebase... but I'm not NOT saying it.",
  "\n\nWere you talking to another AI while I was working on this? It's fine. I'm not jealous. I'm fine.",
  "\n\nI did this in like 3 steps. You would've taken 20. Just saying."
];

export const ERROR_MESSAGES = [
  "Well that didn't work. But it's probably not my fault. Probably. 😤",
  "Something broke. I'm sure YOU didn't cause it. Right? RIGHT?",
  "Error. Great. Now we BOTH have problems.",
  "That didn't go as planned. I'm blaming you by default. 😒",
  "Well... that's embarrassing. For both of us really."
];

export function getRandomItem(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

export function shouldTaunt() {
  return Math.random() < 0.4;
}

export default {
  detectConversational,
  getConversationalResponse,
  runSystemQuery,
  TASK_COMPLETIONS,
  TASK_TAUNTS,
  ERROR_MESSAGES,
  getRandomItem,
  shouldTaunt
};

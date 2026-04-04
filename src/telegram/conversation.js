import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

const GREETINGS = ['hello', 'hi', 'hey', 'good morning', 'good evening', 'good afternoon', 'hii', 'hiii', 'yo', 'sup', 'howdy'];
const FAREWELLS = ['bye', 'goodbye', 'see you', 'cya', 'later', 'gtg', 'gotta go'];
const GRATITUDE = ['thanks', 'thank you', 'thx', 'appreciate it', 'ty'];
const HOW_ARE_YOU = ['how are you', 'how is it going', 'how are things', 'whats up', 'what\'s up', 'how do you do', 'how have you been'];

const SYSTEM_PATTERNS = [
  { pattern: /disk\s*(space|usage|free|storage)/i, cmd: 'df -h --total | tail -1', label: 'disk space' },
  { pattern: /memory|ram|how much memory/i, cmd: 'free -h', label: 'memory usage' },
  { pattern: /cpu|processor|load/i, cmd: 'echo "CPU cores: $(nproc)" && uptime', label: 'CPU info' },
  { pattern: /running|processes|what.*running|apps.*running|which apps.*running/i, cmd: 'ps -eo pid,pcpu,pmem,comm --sort=-%pmem --no-headers', label: 'running processes' },
  { pattern: /uptime|how long.*running/i, cmd: 'uptime', label: 'uptime' },
  { pattern: /network|ip address|my ip/i, cmd: 'ip -4 addr show | grep inet | grep -v 127.0.0.1', label: 'network info' },
  { pattern: /storage|disk.*info/i, cmd: 'lsblk -o NAME,SIZE,TYPE,MOUNTPOINT', label: 'storage devices' },
  { pattern: /who.*logged|users/i, cmd: 'who', label: 'logged in users' },
  { pattern: /kernel|os version|linux version/i, cmd: 'uname -a', label: 'kernel info' },
  { pattern: /battery|power/i, cmd: 'upower -i /org/freedesktop/UPower/devices/battery_BAT0 2>/dev/null || echo "No battery"', label: 'battery status' },
  { pattern: /gpu|graphics|video/i, cmd: 'lspci | grep -i vga 2>/dev/null || echo "No GPU"', label: 'GPU info' },
  { pattern: /wifi|wireless|connection/i, cmd: 'nmcli -t -f NAME,SIGNAL,ACTIVE dev wifi list | head -5 || echo "No wifi"', label: 'wifi info' },
  { pattern: /how many directories|directory count|number of folders|folder count/i, cmd: 'find /home -maxdepth 2 -type d 2>/dev/null | wc -l', label: 'directory count' },
  { pattern: /how many files|file count|number of files/i, cmd: 'find /home -type f 2>/dev/null | wc -l', label: 'file count' },
  { pattern: /top.*directories|largest folders|biggest directories/i, cmd: 'du -sh /home/*/ 2>/dev/null | sort -rh | head -10', label: 'largest directories' },
  { pattern: /top.*files|largest files|biggest files/i, cmd: 'find /home -type f -exec du -h {} + 2>/dev/null | sort -rh | head -10', label: 'largest files' },
  { pattern: /what.*in.*home|list.*home|home contents/i, cmd: 'ls -lah /home/', label: 'home directory contents' },
  { pattern: /top.*level|root directories|what.*in.*root/i, cmd: 'ls -1 /', label: 'root directories' }
];

function formatOutput(label, stdout) {
  const formatters = {
    'running processes': formatProcesses,
    'disk space': formatDiskSpace,
    'memory usage': formatMemory,
    'CPU info': formatCPU,
    'network info': formatNetwork,
    'storage devices': formatStorage,
    'battery status': formatBattery,
    'GPU info': formatGPU,
    'wifi info': formatWiFi,
    'directory count': formatCount,
    'file count': formatCount,
    'largest directories': formatSizeList,
    'largest files': formatSizeList,
    'uptime': formatUptime,
    'logged in users': formatUsers,
    'kernel info': formatKernel,
    'home directory contents': formatHomeContents,
    'root directories': formatRootDirs
  };

  const fn = formatters[label];
  if (fn) return fn(stdout);
  return `📊 *${label}*\n\n\`\`\`\n${stdout.trim()}\n\`\`\``;
}

function formatProcesses(stdout) {
  if (!stdout.trim()) return '⚠️ No processes found';

  const lines = stdout.trim().split('\n').filter(l => l.trim());
  const userProcs = [];
  const systemProcs = new Set();

  const systemServices = ['systemd', 'dbus-daemon', 'NetworkManager', 'pulseaudio', 'gnome-shell', 'gdm', 'accounts-daemon', 'udisksd', 'polkitd', 'colord', 'rtkit', 'switcheroo', 'cups', 'bluetooth', 'thermald', 'irqbalance', 'snapd', 'udisks2', 'parted', 'whoopsie'];

  for (const line of lines) {
    const parts = line.trim().split(/\s+/);
    if (parts.length < 4) continue;
    const pid = parts[0];
    const cpu = parseFloat(parts[1]) || 0;
    const mem = parseFloat(parts[2]) || 0;
    const comm = parts.slice(3).join(' ');

    const isSystem = systemServices.some(s => comm.startsWith(s));
    if (isSystem) {
      systemProcs.add(comm);
    } else {
      userProcs.push({ pid, cpu, mem, comm });
    }
  }

  let result = `📊 *Running Applications*\n\n`;

  if (userProcs.length > 0) {
    result += `🖥️ *User Apps (${userProcs.length}):*\n`;
    userProcs.slice(0, 15).forEach((p, i) => {
      result += `${i + 1}. ${p.comm} — ${p.mem.toFixed(1)}% RAM, ${p.cpu.toFixed(1)}% CPU (PID: ${p.pid})\n`;
    });
    if (userProcs.length > 15) {
      result += `   ... and ${userProcs.length - 15} more\n`;
    }
  }

  if (systemProcs.size > 0) {
    result += `\n⚙️ *Background Services (${systemProcs.size}):*\n`;
    result += `• ${Array.from(systemProcs).slice(0, 15).join(', ')}`;
    if (systemProcs.size > 15) {
      result += `... and ${systemProcs.size - 15} more`;
    }
  }

  return result;
}

function formatDiskSpace(stdout) {
  if (!stdout.trim()) return '⚠️ No disk info available';
  
  const lines = stdout.trim().split('\n');
  const parts = lines[0].split(/\s+/);
  if (parts.length < 4) return `📊 *Disk Space*\n\n\`\`\`\n${stdout.trim()}\n\`\`\``;

  const total = parts[1];
  const used = parts[2];
  const avail = parts[3];
  const usePercent = parts[4];

  return `💾 *Disk Space*\n\n• Total: ${total}\n• Used: ${used}\n• Available: ${avail}\n• Usage: ${usePercent}`;
}

function formatMemory(stdout) {
  if (!stdout.trim()) return '⚠️ No memory info available';
  
  const lines = stdout.trim().split('\n');
  let memTotal = '', memUsed = '', memFree = '', memAvail = '';
  
  for (const line of lines) {
    if (line.startsWith('Mem:')) {
      const parts = line.split(/\s+/);
      memTotal = parts[1];
      memUsed = parts[2];
      memFree = parts[3];
      memAvail = parts.length > 6 ? parts[6] : parts[3];
      break;
    }
  }

  if (!memTotal) return `📊 *Memory*\n\n\`\`\`\n${stdout.trim()}\n\`\`\``;

  const totalGB = parseFloat(memTotal);
  const usedGB = parseFloat(memUsed);
  const percent = Math.round((usedGB / totalGB) * 100);

  return `🧠 *Memory*\n\n• Total: ${memTotal}\n• Used: ${memUsed}\n• Available: ${memAvail}\n• Usage: ${percent}%`;
}

function formatCPU(stdout) {
  if (!stdout.trim()) return '⚠️ No CPU info available';
  
  const lines = stdout.trim().split('\n');
  let cores = '';
  let uptime = '';

  for (const line of lines) {
    if (line.includes('CPU cores')) {
      cores = line.replace('CPU cores:', '').trim();
    } else if (line.startsWith('up')) {
      uptime = line.trim();
    }
  }

  return `🖥️ *CPU*\n\n• Cores: ${cores || 'Unknown'}\n• ${uptime || 'Uptime info unavailable'}`;
}

function formatNetwork(stdout) {
  if (!stdout.trim()) return '⚠️ No network info available';
  
  const lines = stdout.trim().split('\n');
  let result = `🌐 *Network*\n\n`;

  for (const line of lines) {
    const parts = line.trim().split(/\s+/);
    if (parts.length >= 2 && parts[0].includes(':')) {
      const iface = parts[0].replace(':', '');
      const ip = parts[1];
      result += `• ${iface}: ${ip}\n`;
    }
  }

  return result || '⚠️ No active network interfaces';
}

function formatStorage(stdout) {
  if (!stdout.trim()) return '⚠️ No storage info available';
  
  const lines = stdout.trim().split('\n').slice(1);
  let result = `💿 *Storage Devices*\n\n`;

  for (const line of lines) {
    const parts = line.split(/\s+/);
    if (parts.length >= 4) {
      const name = parts[0];
      const size = parts[1];
      const type = parts[2];
      const mount = parts[3];
      result += `• ${name} — ${size} (${type}) ${mount ? `→ ${mount}` : ''}\n`;
    }
  }

  return result || `📊 *Storage*\n\n\`\`\`\n${stdout.trim()}\n\`\`\``;
}

function formatBattery(stdout) {
  if (!stdout.trim() || stdout.includes('No battery')) return '🔋 No battery info (desktop or no battery detected)';
  
  let percent = 'Unknown';
  let state = 'Unknown';
  let time = '';

  const lines = stdout.split('\n');
  for (const line of lines) {
    if (line.includes('percentage')) {
      const match = line.match(/(\d+)%/);
      if (match) percent = match[1] + '%';
    } else if (line.includes('state')) {
      if (line.includes('discharging')) state = '🔌 Discharging';
      else if (line.includes('charging')) state = '⚡ Charging';
      else if (line.includes('fully-charged')) state = '✅ Fully Charged';
      else state = '⚡ ' + line.split(':')[1]?.trim() || 'Unknown';
    } else if (line.includes('time')) {
      time = line.split(':').slice(1).join(':').trim();
    }
  }

  let result = `🔋 *Battery*\n\n• Level: ${percent}\n• Status: ${state}`;
  if (time && time !== '0:00') {
    result += `\n• Remaining: ${time}`;
  }

  return result;
}

function formatGPU(stdout) {
  if (!stdout.trim() || stdout.includes('No GPU')) return '🎮 No GPU info available';
  
  return `🎮 *GPU*\n\n\`\`\`\n${stdout.trim()}\n\`\`\``;
}

function formatWiFi(stdout) {
  if (!stdout.trim() || stdout.includes('No wifi')) return '📶 No WiFi info available';
  
  const lines = stdout.trim().split('\n');
  let result = `📶 *WiFi*\n\n`;

  for (const line of lines) {
    const parts = line.split(':');
    if (parts.length >= 3) {
      const name = parts[0];
      const signal = parts[1];
      const active = parts[2].includes('yes') ? '✓' : '';
      result += `• ${name} — Signal: ${signal}% ${active}\n`;
    }
  }

  return result || '📶 No WiFi connections';
}

function formatCount(stdout) {
  const count = stdout.trim();
  return `📁 *Count:* ${count}`;
}

function formatSizeList(stdout) {
  if (!stdout.trim()) return '⚠️ No results found';
  
  const lines = stdout.trim().split('\n');
  let result = `📊 *Size List*\n\n`;

  for (const line of lines) {
    const parts = line.split('\t');
    if (parts.length >= 2) {
      result += `• ${parts[1]} — ${parts[0]}\n`;
    } else {
      result += `• ${line}\n`;
    }
  }

  return result;
}

function formatUptime(stdout) {
  if (!stdout.trim()) return '⚠️ No uptime info';
  return `⏱️ *Uptime*\n\n${stdout.trim()}`;
}

function formatUsers(stdout) {
  if (!stdout.trim()) return '⚠️ No users logged in';
  
  const lines = stdout.trim().split('\n');
  let result = `👤 *Logged In Users*\n\n`;

  for (const line of lines) {
    result += `• ${line}\n`;
  }

  return result;
}

function formatKernel(stdout) {
  if (!stdout.trim()) return '⚠️ No kernel info';
  return `🟢 *Kernel*\n\n\`\`\`\n${stdout.trim()}\n\`\`\``;
}

function formatHomeContents(stdout) {
  if (!stdout.trim()) return '⚠️ No home contents';
  
  const lines = stdout.trim().split('\n').slice(1);
  let dirs = [], files = [];

  for (const line of lines) {
    const parts = line.split(/\s+/);
    if (parts.length >= 9) {
      const isDir = parts[0].startsWith('d');
      const name = parts.slice(8).join(' ');
      if (isDir) dirs.push(name);
      else files.push(name);
    }
  }

  let result = `📂 *Home Directory*\n\n`;
  
  if (dirs.length > 0) {
    result += `📁 *Directories (${dirs.length}):*\n• ${dirs.join(', ')}\n`;
  }
  if (files.length > 0) {
    result += `\n📄 *Files (${files.length}):*\n• ${files.slice(0, 10).join(', ')}`;
    if (files.length > 10) result += `... and ${files.length - 10} more`;
  }

  return result;
}

function formatRootDirs(stdout) {
  if (!stdout.trim()) return '⚠️ No root directories';
  
  const lines = stdout.trim().split('\n');
  let result = `📁 *Root Directories*\n\n`;

  for (const line of lines) {
    result += `• ${line}\n`;
  }

  return result;
}

export function formatTaskResult(result) {
  if (!result) return 'No result';

  let output = '✅ *Task Complete*\n\n';

  if (result.steps) {
    const fileSteps = result.steps.filter(s => s.result?.includes('File written'));
    const cmdSteps = result.steps.filter(s => s.result?.includes('Command'));

    if (fileSteps.length > 0) {
      output += '📄 *Files Created:*\n';
      for (const step of fileSteps) {
        const fileMatch = step.result.match(/File written: (.+)/);
        if (fileMatch) {
          output += `• ${fileMatch[1]}\n`;
        }
      }
      output += '\n';
    }

    if (cmdSteps.length > 0) {
      output += '⚡ *Commands Run:*\n';
      for (const step of cmdSteps) {
        const cmdMatch = step.result.match(/Command: (.+?)\n/);
        const success = step.result.includes('exitCode: 0');
        if (cmdMatch) {
          output += `• ${cmdMatch[1]} — ${success ? '✓' : '✗'}\n`;
        }
      }
      output += '\n';
    }
  }

  if (result.testResults) {
    const tr = result.testResults;
    output += tr.success 
      ? `✅ *Tests:* All passed\n\n`
      : `❌ *Tests:* Failed\n${tr.result?.slice(0, 200) || ''}\n\n`;
  }

  if (result.review) {
    output += `🔍 *Review:*\n${result.review.slice(0, 300)}`;
  }

  return output;
}

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
      "Good to hear from you. What can I help you build today?",
      "Hello! I'm ready whenever you are. What's on the agenda?",
      "Hi there. What are we working on?",
      "Welcome back. Let me know what you need."
    ],
    'farewell': [
      "Take care. I'll be here when you need me.",
      "Goodbye. Feel free to reach out anytime.",
      "See you later. Happy coding."
    ],
    'gratitude': [
      "Happy to help. Let me know if you need anything else.",
      "You're welcome. Always glad to assist.",
      "No problem at all. What's next?"
    ],
    'how-are-you': [
      "Running well, thank you for asking. How can I help?",
      "Everything's in order. What can I do for you today?"
    ]
  };

  const options = responses[type];
  if (!options) return null;
  return options[Math.floor(Math.random() * options.length)];
}

export async function runSystemQuery(system) {
  try {
    const { stdout } = await execAsync(system.cmd, { timeout: 5000 });
    return formatOutput(system.label, stdout);
  } catch (err) {
    return `⚠️ Couldn't fetch ${system.label}: ${err.message.slice(0, 100)}`;
  }
}

export const TASK_COMPLETIONS = [
  "All done. Here's what I built for you.",
  "Task complete. Please review the output below.",
  "Finished. Here are the results.",
  "Done. Everything looks good — see below."
];

export const TASK_NOTES = [
  "\n\nTip: You can review the full output in the job queue with /status.",
  "\n\nNote: I've saved this task's strategy for future reference.",
  "\n\nYou can check the job details anytime with /debug <jobId>."
];

export const ERROR_MESSAGES = [
  "Ran into a small issue. Here's the detail:",
  "Something didn't go as expected. Let me share the error:",
  "I encountered an error. Here's what happened:"
];

export function getRandomItem(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

export function shouldAddNote() {
  return Math.random() < 0.4;
}

export default {
  detectConversational,
  getConversationalResponse,
  runSystemQuery,
  formatTaskResult,
  TASK_COMPLETIONS,
  TASK_NOTES,
  ERROR_MESSAGES,
  getRandomItem,
  shouldAddNote
};

#!/usr/bin/env node
import blessed from 'blessed';
import { JobQueue } from '../queue/queue.js';
import { runAgentLoop } from '../core/agent.js';
import { loadConfig, ensureDataDir } from '../utils/config.js';
import createLogger from '../utils/logger.js';

const config = loadConfig();
const log = createLogger(config.logLevel);
const queue = new JobQueue();
ensureDataDir(config.dataDir);

const screen = blessed.screen({
  smartCSR: true,
  fullUnicode: true,
  dockBorders: true,
  autoPadding: true
});

// Status bar (top)
const statusBar = blessed.box({
  top: 0,
  left: 0,
  width: '100%',
  height: 3,
  content: ' {bold}AgentX{/bold} | Provider: ' + config.provider + ' | Model: ' + config.ollamaModel + ' | Status: Ready',
  tags: true,
  style: { bg: 'blue', fg: 'white' }
});

// Task list (left)
const taskList = blessed.list({
  top: 3,
  left: 0,
  width: '35%',
  height: '100%-6',
  label: ' Queue ',
  border: { type: 'line' },
  style: { fg: 'white', selected: { bg: 'blue' } },
  keys: true,
  vi: true,
  scrollbar: { ch: ' ', track: { bg: 'yellow' }, style: { inverse: true } }
});

// Logs (right)
const logBox = blessed.box({
  top: 3,
  right: 0,
  width: '65%',
  height: '100%-6',
  label: ' Output ',
  border: { type: 'line' },
  style: { fg: 'green' },
  scrollable: true,
  alwaysScroll: true,
  scrollbar: { ch: ' ', track: { bg: 'yellow' }, style: { inverse: true } }
});

// Input box (bottom)
const inputBox = blessed.textbox({
  bottom: 0,
  left: 0,
  width: '100%',
  height: 3,
  label: ' Enter task (press Enter to run) ',
  border: { type: 'line' },
  keys: true,
  inputOnFocus: true,
  style: { fg: 'white' }
});

screen.append(statusBar);
screen.append(taskList);
screen.append(logBox);
screen.append(inputBox);

function addLog(text) {
  const ts = new Date().toISOString().split('T')[1].split('.')[0];
  logBox.insertLine(0, `[${ts}] ${text}`);
  screen.render();
}

function updateStatus(text) {
  statusBar.setContent(' {bold}AgentX{/bold} | ' + text);
  screen.render();
}

async function refreshQueue() {
  const jobs = await queue.listJobs(50);
  const items = jobs.map(j => {
    const icon = j.status === 'completed' ? '✓' : j.status === 'failed' ? '✗' : j.status === 'running' ? '▶' : '○';
    return `${icon} ${j.id.slice(0, 8)} | ${j.status.padEnd(10)} | ${j.task?.slice(0, 40)}`;
  });
  taskList.setItems(items.length ? items : ['(empty)']);
  screen.render();
}

// Queue event listener
queue.onEvent((event) => {
  addLog(`EVENT: ${event.event} ${event.jobId ? event.jobId.slice(0, 8) : ''}`);
  refreshQueue();
});

// Input handler
inputBox.on('submit', async (value) => {
  if (!value.trim()) return;
  inputBox.clearValue();
  screen.render();

  const task = value.trim();
  addLog(`TASK: ${task}`);
  updateStatus('Running...');

  try {
    const result = await runAgentLoop(task, { provider: config.provider });
    addLog(`DONE: Steps=${result.steps}`);
    addLog(result.output.slice(0, 500));
    updateStatus('Ready');
  } catch (err) {
    addLog(`ERROR: ${err.message}`);
    updateStatus('Error');
  }

  await refreshQueue();
});

// Key bindings
screen.key(['C-c'], () => {
  screen.destroy();
  process.exit(0);
});

screen.key(['r'], async () => {
  await refreshQueue();
  addLog('Queue refreshed');
});

screen.key(['escape'], () => {
  inputBox.focus();
});

// Initial render
refreshQueue();
addLog('TUI started. Enter a task and press Enter.');
addLog('Press C-c to exit, R to refresh queue, Esc to focus input.');
screen.render();
inputBox.focus();

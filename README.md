# Autonomous AI Coding Agent

A self-improving autonomous AI coding agent system with dual LLM provider support (local Ollama + cloud OpenRouter free models).

## Features

- **Agent Loop**: Plan → Execute → Reflect with built-in planner, coder, and critic roles
- **Dual LLM Providers**: Local Ollama models or OpenRouter free cloud models
- **Strategy Memory**: Learns from tasks and stores reusable patterns
- **Redis Queue**: Background job processing with pub/sub progress streaming
- **Session Management**: Per-user state, mode tracking, job history
- **CLI**: Run tasks, chat, debug jobs, view strategies, manage queue
- **TUI Dashboard**: Real-time terminal UI with blessed
- **Telegram Bot**: Remote control via `/run`, `/debug`, `/status`, `/cancel`

## Quick Start

```bash
cd autonomous-agent
npm install

# Run a task with local Ollama
node src/cli/index.js run "Create a REST API in Express"

# Run with OpenRouter free models
node src/cli/index.js run "Create a REST API" --provider openrouter

# Chat mode
node src/cli/index.js chat

# TUI Dashboard
node src/tui/index.js

# Background worker
node src/queue/worker.js
```

## Configuration

Edit `config.json`:

```json
{
  "provider": "ollama",
  "ollamaModel": "lfm2.5-thinking:1.2b",
  "openrouterApiKey": "sk-or-xxx",
  "openrouterModel": "openrouter/free"
}
```

## CLI Commands

| Command | Description |
|---------|-------------|
| `run <task>` | Execute a task |
| `chat` | Interactive chat mode |
| `debug <jobId>` | Show job steps and logs |
| `strategies` | List learned strategies |
| `queue` | Show job status |
| `config` | View/set configuration |
| `models` | List available models |

## Telegram Bot

Set `TELEGRAM_BOT_TOKEN` env var and run `node src/telegram/index.js`.

Commands: `/run`, `/debug`, `/status`, `/cancel`, `/chat`, `/agent`, `/models`, `/provider`

## Architecture

```
src/
├── core/           # Agent loop, LLM providers, streaming
├── cli/            # Commander CLI
├── tui/            # Blessed terminal UI
├── telegram/       # Telegram bot integration
├── queue/          # Redis queue + worker
├── memory/         # Strategy memory + trace store
├── session/        # Per-user session management
└── utils/          # Config, logger
```

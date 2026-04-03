# AgentX

A coding assistant that thinks, plans, and learns. Runs locally on your machine — no API keys required (unless you want them).

## What It Does

You tell AgentX what you need in plain English. It breaks the task down, writes the code, runs commands, and stores what it learned for next time.

**Examples:**
- "create a rest api in express"
- "write a function that checks if a number is prime"
- "whats running on my laptop"
- "build a todo app with react"

No commands. No special syntax. Just type what you need.

## Quick Start

```bash
# Clone
git clone https://github.com/Adarsh1Y/agentx
cd agentx

# Install
npm install

# Run setup (checks Redis, Ollama, creates data dirs)
bash setup.sh

# Start the Telegram bot
node src/telegram/index.js
```

## How It Works

AgentX runs a simple loop:

1. **Plan** — breaks your request into steps
2. **Execute** — writes code, runs commands, creates files
3. **Reflect** — stores what it learned for future tasks

It uses **OpenRouter** (free tier) by default for the LLM, with automatic fallback to **Ollama** (local models) if the cloud is unavailable.

## Features

**Natural language interface** — Just talk to it. No slash commands needed.

**Dual LLM support** — OpenRouter for speed, Ollama for offline. Auto-switches if one goes down.

**Strategy memory** — Learns from every task. Gets better over time.

**Background job queue** — Long tasks run asynchronously via Redis.

**Multiple interfaces** — CLI, terminal dashboard (TUI), and Telegram bot.

## Telegram Bot

Message the bot like you'd message a colleague:

| You say | AgentX does |
|---------|-------------|
| "create a rest api" | Plans and builds it |
| "whats running on my laptop" | Checks your system |
| "status" | Shows recent jobs |
| "health" | Checks provider status |
| "models" | Lists available models |
| "use ollama" | Switches to local models |
| "/" | Shows all commands |

## CLI

```bash
# Run a task
node src/cli/index.js run "create a rest api"

# Chat mode
node src/cli/index.js chat

# View learned strategies
node src/cli/index.js strategies

# Check job queue
node src/cli/index.js queue

# View config
node src/cli/index.js config
```

## Configuration

Edit `config.json`:

```json
{
  "provider": "openrouter",
  "openrouterApiKey": "sk-or-xxx",
  "openrouterModel": "openrouter/free",
  "ollamaModel": "qwen2.5:1.5b",
  "maxSteps": 5
}
```

## Project Structure

```
agentx/
├── src/
│   ├── core/             # Agent loop, LLM providers, streaming
│   │   ├── agent.js      # Plan → Execute → Reflect loop
│   │   ├── streaming.js  # Real-time event system
│   │   └── providers/    # OpenRouter + Ollama with auto-switch
│   ├── telegram/         # Telegram bot with intent detection
│   │   ├── index.js      # Bot entry point
│   │   └── intent.js     # Natural language intent detection
│   ├── cli/              # Command-line interface
│   ├── tui/              # Terminal dashboard
│   ├── queue/            # Redis job queue + worker
│   ├── memory/           # Strategy memory + trace store
│   └── session/          # Per-user session management
├── config.json           # Main configuration
├── .env                  # Secrets (gitignored)
└── setup.sh              # One-line setup script
```

## License

MIT

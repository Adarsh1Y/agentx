#!/bin/bash
set -e

echo "=== AgentX - Install & Setup ==="

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

info()  { echo -e "${GREEN}[✓]${NC} $1"; }
warn()  { echo -e "${YELLOW}[!]${NC} $1"; }
error() { echo -e "${RED}[✗]${NC} $1"; }

# Check Node.js
if command -v node &>/dev/null; then
  info "Node.js $(node --version) found"
else
  error "Node.js not found. Install it first."
  exit 1
fi

# Check npm
if command -v npm &>/dev/null; then
  info "npm $(npm --version) found"
else
  error "npm not found."
  exit 1
fi

# Install npm dependencies
echo ""
echo "Installing npm dependencies..."
npm install
info "Dependencies installed"

# Check/install Redis (Valkey)
echo ""
if command -v redis-server &>/dev/null; then
  info "Redis/Valkey found: $(redis-server --version | awk '{print $3}')"
else
  warn "Redis not found. Install with: sudo pacman -S redis  OR  sudo apt install redis-server"
fi

# Start Redis if not running
if redis-cli ping &>/dev/null; then
  info "Redis is running"
else
  warn "Redis not running. Starting..."
  redis-server --daemonize yes 2>/dev/null && info "Redis started" || warn "Failed to start Redis automatically"
fi

# Check Ollama
echo ""
if command -v ollama &>/dev/null; then
  info "Ollama found"
  if ollama ps 2>/dev/null | grep -q .; then
    info "Ollama server is running"
  else
    warn "Ollama server not running. Start with: ollama serve"
  fi
  if ollama list 2>/dev/null | grep -q "lfm2.5-thinking"; then
    info "Model lfm2.5-thinking:1.2b found"
  else
    warn "lfm2.5-thinking:1.2b not found. Pull with: ollama pull lfm2.5-thinking:1.2b"
  fi
else
  warn "Ollama not found. Install from https://ollama.com"
fi

# Create data directories
echo ""
mkdir -p ~/.opencode-mem/{strategies,traces,sessions}
info "Data directories created at ~/.opencode-mem/"

# Check config
echo ""
if [ -f config.json ]; then
  info "config.json found"
  PROVIDER=$(node -e "console.log(require('./config.json').provider)")
  MODEL=$(node -e "console.log(require('./config.json').ollamaModel)")
  info "Provider: $PROVIDER | Model: $MODEL"
else
  error "config.json not found"
  exit 1
fi

echo ""
echo "=== Setup Complete ==="
echo ""
echo "Commands:"
echo "  node src/cli/index.js run \"your task\"     # Run a task"
echo "  node src/cli/index.js chat                 # Chat mode"
echo "  node src/tui/index.js                      # TUI dashboard"
echo "  node src/queue/worker.js                   # Background worker"
echo "  node src/cli/index.js strategies           # View learned strategies"
echo "  node src/cli/index.js queue                # View job queue"
echo "  node src/cli/index.js config               # View config"
echo ""
echo "Telegram: export TELEGRAM_BOT_TOKEN=xxx && node src/telegram/index.js"

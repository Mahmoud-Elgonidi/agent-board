#!/bin/bash
# start.sh — Start backend + frontend
set -e

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "🟣 Agent Board — starting up"
echo "   Root: $ROOT"

# Ensure DB directory exists
mkdir -p ~/.orchestrator

# Install deps if node_modules missing
if [ ! -d "$ROOT/node_modules" ]; then
  echo "📦 Installing root deps..."
  cd "$ROOT" && npm install
fi
if [ ! -d "$ROOT/backend/node_modules" ]; then
  echo "📦 Installing backend deps..."
  cd "$ROOT/backend" && npm install
fi
if [ ! -d "$ROOT/frontend/node_modules" ]; then
  echo "📦 Installing frontend deps..."
  cd "$ROOT/frontend" && npm install
fi

cd "$ROOT"
echo "🚀 Starting backend + frontend..."
npm run dev

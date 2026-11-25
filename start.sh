#!/usr/bin/env bash
set -euo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" >/dev/null 2>&1 && pwd)"
cd "$DIR"

PORT="${PORT:-3000}"

echo ""
echo "  Starting Correspondence Tracker on http://localhost:${PORT}"
echo "  Keep this terminal open. Press Ctrl+C to stop."
echo ""

if command -v xdg-open >/dev/null 2>&1 && [ -n "${DISPLAY:-}" ]; then
  (sleep 1 && xdg-open "http://localhost:${PORT}" >/dev/null 2>&1) &
fi

PORT="$PORT" node server.js

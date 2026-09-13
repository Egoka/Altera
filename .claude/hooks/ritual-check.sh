#!/usr/bin/env bash
# Кооперативный адаптер Claude Stop; не принимает стадию или задачу.
# Повторный Stop проверяет тот же контракт. Codex этот Claude hook не запускает.
set -euo pipefail
cat >/dev/null
PROJECT_DIR="${CLAUDE_PROJECT_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}"
GATE_SCRIPT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)/scripts/agent-loop/gate.py"
if ! command -v python3 >/dev/null 2>&1; then
  echo 'Agent-loop gate requires Python 3; Stop contract remains unverified.' >&2
  exit 2
fi
set +e
RESULT="$(python3 "$GATE_SCRIPT" --root "$PROJECT_DIR" stop 2>&1)"
STATUS=$?
set -e
if [ "$STATUS" -ne 0 ]; then
  printf '%s\n' "$RESULT" >&2
  exit 2
fi
exit 0

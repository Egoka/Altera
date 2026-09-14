#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WEB_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
PORT="${PORT:-3000}"
WAIT_SECONDS="${SMOKE_WAIT_SECONDS:-30}"
LOG="$(mktemp)"

cleanup() {
  if [ -n "${SERVER_PID:-}" ] && kill -0 "$SERVER_PID" 2>/dev/null; then
    kill "$SERVER_PID" 2>/dev/null || true
    wait "$SERVER_PID" 2>/dev/null || true
  fi
  rm -f "$LOG"
}
trap cleanup EXIT

if curl -sS -o /dev/null --connect-timeout 1 --max-time 1 "http://127.0.0.1:${PORT}/" 2>/dev/null; then
  echo "✗ порт $PORT уже занят; production web не запускался"
  exit 1
fi

echo "→ запуск production web на порту $PORT"
PORT="$PORT" node "$WEB_DIR/.output/server/index.mjs" >"$LOG" 2>&1 &
SERVER_PID=$!

echo "→ ожидание готовности (до ${WAIT_SECONDS}с)"
for ((attempt = 1; attempt <= WAIT_SECONDS; attempt++)); do
  if ! kill -0 "$SERVER_PID" 2>/dev/null; then
    echo "✗ production web завершился до готовности. Вывод:"
    cat "$LOG"
    exit 1
  fi

  STATUS="$(curl -sS -o /dev/null -w '%{http_code}' "http://127.0.0.1:${PORT}/" 2>/dev/null || true)"
  if ! kill -0 "$SERVER_PID" 2>/dev/null; then
    echo "✗ production web завершился во время ожидания готовности. Вывод:"
    cat "$LOG"
    exit 1
  fi
  if [ "$STATUS" != "000" ]; then
    break
  fi

  if [ "$attempt" -eq "$WAIT_SECONDS" ]; then
    echo "✗ production web не ответил за ${WAIT_SECONDS}с. Вывод:"
    cat "$LOG"
    exit 1
  fi
  sleep 1
done

for ROUTE in / /en; do
  STATUS="$(curl -sS -o /dev/null -w '%{http_code}' "http://127.0.0.1:${PORT}${ROUTE}")"
  if ! kill -0 "$SERVER_PID" 2>/dev/null; then
    echo "✗ production web завершился во время проверки $ROUTE. Вывод:"
    cat "$LOG"
    exit 1
  fi
  echo "$ROUTE: $STATUS"
  if [ "$STATUS" != "200" ]; then
    echo "✗ ожидался HTTP 200 для $ROUTE. Вывод:"
    cat "$LOG"
    exit 1
  fi
done

echo "✓ production web отвечает на SSR-маршрутах"

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

check_route() {
  local ROUTE="$1"
  local EXPECTED_STATUS="$2"
  STATUS="$(curl -sS -o /dev/null -w '%{http_code}' "http://127.0.0.1:${PORT}${ROUTE}")"
  if ! kill -0 "$SERVER_PID" 2>/dev/null; then
    echo "✗ production web завершился во время проверки $ROUTE. Вывод:"
    cat "$LOG"
    exit 1
  fi
  echo "$ROUTE: $STATUS"
  if [ "$STATUS" != "$EXPECTED_STATUS" ]; then
    echo "✗ ожидался HTTP $EXPECTED_STATUS для $ROUTE. Вывод:"
    cat "$LOG"
    exit 1
  fi
}

check_redirect() {
  local ROUTE="$1"
  local EXPECTED_STATUS="$2"
  local EXPECTED_PATH="$3"
  local RESULT
  local LOCATION

  RESULT="$(curl -sS -o /dev/null -w $'%{http_code}\n%{redirect_url}' "http://127.0.0.1:${PORT}${ROUTE}")"
  STATUS="${RESULT%%$'\n'*}"
  LOCATION="${RESULT#*$'\n'}"

  echo "$ROUTE: $STATUS → $LOCATION"
  if [ "$STATUS" != "$EXPECTED_STATUS" ] || [ "$LOCATION" != "http://127.0.0.1:${PORT}${EXPECTED_PATH}" ]; then
    echo "✗ ожидался HTTP $EXPECTED_STATUS с Location: $EXPECTED_PATH для $ROUTE. Вывод:"
    cat "$LOG"
    exit 1
  fi
}

check_content() {
  local ROUTE="$1"
  local EXPECTED_CONTENT="$2"
  local BODY

  BODY="$(curl -sS "http://127.0.0.1:${PORT}${ROUTE}")"
  if [[ "$BODY" != *"$EXPECTED_CONTENT"* ]]; then
    echo "✗ SSR-ответ $ROUTE не содержит ожидаемый language switch. Вывод:"
    cat "$LOG"
    exit 1
  fi
}

for ROUTE in / /en; do
  check_route "$ROUTE" 200
done

for ROUTE in /fonts-showcase /components-showcase /test-error; do
  check_route "$ROUTE" 404
done

check_redirect "/ru" 301 "/"
check_content "/" 'aria-label="Switch language to English"'
check_content "/en" 'aria-label="Switch language to Русский"'

echo "✓ production web отвечает на SSR-маршрутах, dev-маршруты недоступны"

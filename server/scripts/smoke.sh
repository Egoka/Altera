#!/usr/bin/env bash
# Дымовая проверка старта сервера: поднять собранный сервер, дождаться готовности,
# выполнить настоящий GraphQL-запрос и убедиться в ответе.
#
# Скрипт намеренно не глушит ошибки: любое падение старта — ненулевой код выхода.
# Используется и в CI, и локально, чтобы проверялось одно и то же.
#
# Требует: собранный dist (pnpm run build:ci) и доступный Redis по REDIS_URL.

set -euo pipefail

PORT="${PORT:-4000}"
WAIT_SECONDS="${SMOKE_WAIT_SECONDS:-30}"
LOG="$(mktemp)"

cleanup() {
  if [ -n "${SERVER_PID:-}" ] && kill -0 "$SERVER_PID" 2>/dev/null; then
    kill "$SERVER_PID" 2>/dev/null || true
    wait "$SERVER_PID" 2>/dev/null || true
  fi
}
trap cleanup EXIT

echo "→ запуск сервера на порту $PORT"
node dist/server.js > "$LOG" 2>&1 &
SERVER_PID=$!

echo "→ ожидание готовности (до ${WAIT_SECONDS}с)"
for i in $(seq 1 "$WAIT_SECONDS"); do
  if ! kill -0 "$SERVER_PID" 2>/dev/null; then
    echo "✗ процесс сервера завершился до готовности. Вывод:"
    cat "$LOG"
    exit 1
  fi
  if curl -sf -o /dev/null "http://127.0.0.1:${PORT}/" \
      -X POST -H 'content-type: application/json' -H 'x-graphql-yoga-csrf: smoke' \
      --data '{"query":"{__typename}"}'; then
    break
  fi
  if [ "$i" -eq "$WAIT_SECONDS" ]; then
    echo "✗ сервер не ответил за ${WAIT_SECONDS}с. Вывод:"
    cat "$LOG"
    exit 1
  fi
  sleep 1
done

echo "→ проверка ответа GraphQL"
RESPONSE="$(curl -sS "http://127.0.0.1:${PORT}/" \
  -X POST -H 'content-type: application/json' -H 'x-graphql-yoga-csrf: smoke' \
  --data '{"query":"{__typename}"}')"

echo "  ответ: $RESPONSE"

if ! printf '%s' "$RESPONSE" | grep -q '"__typename":"Query"'; then
  echo "✗ неожиданный ответ. Вывод сервера:"
  cat "$LOG"
  exit 1
fi

echo "✓ сервер поднялся и ответил на GraphQL-запрос"

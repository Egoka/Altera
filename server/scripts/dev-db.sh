#!/usr/bin/env bash
# Пересоздаёт локальную базу разработки и локальное хранилище медиа и наполняет их данными:
# база `altera_dev` в Postgres из docker-compose.yml (порт 25432) → миграции → сид T-007 →
# `seed/dev-seed.ts`. Базы `altera` (обычная локальная) и `altera_e2e` (тесты) не трогает.
#
#   pnpm --filter server run db:dev
#
# После этого в server/.env:
#   DATABASE_URL="postgresql://altera:altera@localhost:25432/altera_dev"
#   DATABASE_URL_UNPOOLED="postgresql://altera:altera@localhost:25432/altera_dev"
#   STORAGE_DRIVER=local, STORAGE_LOCAL_DIR=.storage-dev
set -euo pipefail

cd "$(dirname "$0")/.."

DEV_DB_NAME="${DEV_DB_NAME:-altera_dev}"
DEV_STORAGE_DIR="${DEV_STORAGE_DIR:-.storage-dev}"
# Имя проекта задано явно: из git worktree каталог называется иначе, и compose не нашёл бы
# уже запущенные контейнеры проекта `altera`.
COMPOSE=(docker compose -p "${COMPOSE_PROJECT_NAME:-altera}" -f ../docker-compose.yml)

case "$DEV_STORAGE_DIR" in
  "" | "/" | "." | ".." | /*) echo "Недопустимый DEV_STORAGE_DIR: $DEV_STORAGE_DIR" >&2; exit 1 ;;
esac

export DATABASE_URL="postgresql://altera:altera@localhost:25432/${DEV_DB_NAME}"
export DATABASE_URL_UNPOOLED="$DATABASE_URL"
export STORAGE_LOCAL_DIR="$DEV_STORAGE_DIR"

echo "→ Postgres: база ${DEV_DB_NAME}"
if ! "${COMPOSE[@]}" exec -T postgres psql -U altera -d postgres -tAc "SELECT 1 FROM pg_database WHERE datname = '${DEV_DB_NAME}'" | grep -q 1; then
  "${COMPOSE[@]}" exec -T postgres createdb -U altera "$DEV_DB_NAME"
fi

echo "→ Миграции (reset)"
npx prisma migrate reset --force --skip-seed --skip-generate

echo "→ Хранилище: ${DEV_STORAGE_DIR}"
rm -rf "$DEV_STORAGE_DIR"

echo "→ Данные"
npx ts-node seed/dev-seed.ts

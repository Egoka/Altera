# Permission Exceptions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Добавить owner-managed индивидуальные исключения прав с хранением, GraphQL API, истечением и аудитом.

**Architecture:** Prisma хранит исключения, доменный сервис атомарно меняет их вместе с аудитом, GraphQL
делегирует сервису, а контекст передаёт активные записи существующей проверке прав. Идемпотентный runner
отмечает и аудирует истечение.

**Tech Stack:** TypeScript, GraphQL Yoga, Prisma 6.12, PostgreSQL, Vitest.

**Spec:** `docs/superpowers/specs/2026-09-18-permission-exceptions-design.md`

## Global Constraints

- Только `owner` выдаёт и отзывает исключения.
- Цели: `editor`, `moderator`, `analyst`, `admin`; `reader`/`author` запрещены.
- Право `owner` исключением не выдаётся.
- Все изменения и автоматическое истечение пишутся в append-only аудит.
- Миграция не применяется к неизвестной или live базе.

---

### Task 1: Доменный сервис и RED/GREEN

**Files:**

- Create: `server/tests/permission-exceptions.test.ts`
- Create: `server/src/permission-exceptions/service.ts`

**Interfaces:**

- Produces: `grantPermissionException`, `revokePermissionException`, `expirePermissionExceptions`.

- [ ] Написать тесты, где не-owner получает `FORBIDDEN`, запрещённая цель получает `VALIDATION_ERROR`, а owner grant создаёт исключение и audit.
- [ ] Запустить `pnpm --filter server exec vitest run tests/permission-exceptions.test.ts` и подтвердить RED из-за отсутствующего модуля.
- [ ] Реализовать минимальный сервис через переданный Prisma-like client и явные часы.
- [ ] Добавить RED для revoke и повторного expiry, затем реализовать условное обновление и audit.
- [ ] Повторить целевой тест до PASS.

### Task 2: Prisma и GraphQL

**Files:**

- Modify: `server/prisma/schema.prisma`
- Create: `server/prisma/migrations/20260918000000_permission_exceptions/migration.sql`
- Create: `server/src/graphql/permission-exception/schema.graphql`
- Create: `server/src/graphql/permission-exception/resolver.ts`
- Modify: `server/src/prisma.ts`
- Modify: `server/src/exceptions/permissions.ts`

**Interfaces:**

- Consumes: сервис Task 1.
- Produces: `permissionExceptions`, `grantException`, `revokeException`; контекстные исключения для `ensurePermission`.

- [ ] Добавить RED-тест resolver на owner-only mutation и тест context/permission на активное и истёкшее право.
- [ ] Запустить целевые тесты и подтвердить ожидаемый FAIL.
- [ ] Добавить Prisma model/migration, SDL/resolver и загрузку исключений в context.
- [ ] Сгенерировать Prisma client без применения миграций и довести целевые тесты до PASS.

### Task 3: Expiry runner, полная проверка и delivery

**Files:**

- Create: `server/src/permission-exceptions/scheduler.ts`
- Modify: `server/src/server.ts`
- Create: `docs/reports/tasks/T-028.json`
- Create: `docs/reports/tasks/T-028.md`

**Interfaces:**

- Consumes: `expirePermissionExceptions`.
- Produces: немедленный и периодический идемпотентный expiry pass.

- [ ] Добавить RED-тест scheduler на немедленный запуск, интервал и безопасное логирование ошибки.
- [ ] Реализовать scheduler с `unref()` и подключить его после создания сервера.
- [ ] Запустить format, lint, server tests, root tests и `server build:ci` на Node 24.12.0.
- [ ] Закоммитить, push, открыть PR в `app`, дождаться GitHub checks без watch-loop.
- [ ] Записать receipt и финальный Markdown для точного tested SHA, закоммитить и повторить актуальные проверки/CI.

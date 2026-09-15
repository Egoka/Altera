# T-011: отчёт о миграции ролей и состояния учётной записи

- **Дата**: 2026-09-15
- **План**: `docs/plans/2026-09-15-t011-migration-roles-account-states.md`
- **Базовый коммит**: `6c431e5184a558395dcc95db81ada4b1f670600d`
- **Ветка**: `server/t-011-migration-roles-account-states`
- **Статус**: реализация завершена, передаётся на тестирование и независимое ревью

## Что сделано

- В PostgreSQL, Prisma и GraphQL добавлены роли `moderator`, `analyst`, `owner` с каноническим
  порядком `reader, author, editor, moderator, analyst, admin, owner`.
- Добавлены две последовательные миграции: additive-расширение `Role`, затем
  `AccountArchiveMode`, nullable archive-state, снимки актора и `isServiceAccount` с backfill для
  существующих `editor` и `admin`.
- Добавлен contract test, сравнивающий ожидаемый массив с Prisma enum и объединённым GraphQL SDL.
- GraphQL-типы frontend перегенерированы; две страницы управления пользователями используют
  generated `Role`, lowercase mock-значения и подписи всех семи ролей.
- Публичный GraphQL `User`, сессии, категории причины блокировки и flow архивирования не менялись.

## Как проверено

Среда проверки:

```text
PostgreSQL 16.15 (одноразовый локальный Docker-контейнер)
Node v24.3.0
pnpm 10.18.3
```

Репозиторий требует Node 24.12.0; эта версия не установлена в runtime, поэтому pnpm выводил
предупреждение `Unsupported engine`. Все перечисленные команды при этом завершились с ожидаемыми
exit code.

### AC-1 — `t011-migration-rehearsal`

На `t011_empty` выполнены `prisma migrate deploy` и `prisma migrate status`: применены все шесть
миграций, затем получено `Database schema is up to date!`, exit 0.

На `t011_populated` сначала через Prisma применены четыре baseline-миграции, затем добавлены четыре
sentinel-пользователя (`reader`, `author`, `editor`, `admin`), один content type и две связанные
статьи для `author`/`editor`. После upgrade:

```text
Role labels: reader, author, editor, moderator, analyst, admin, owner
users before/after: 4/4
articles before/after: 2/2
role counts before/after: admin=1, author=1, editor=1, reader=1
isServiceAccount: reader=false, author=false, editor=true, admin=true
archive state: все пять nullable-полей NULL для четырёх sentinel-строк
article FK: обе пары article id / authorId сохранены
```

Повторный `prisma migrate status` сообщил `Database schema is up to date!`, exit 0. В транзакции,
завершённой `ROLLBACK`, вставка без `role`/service flag получила `reader`/`false`; успешно вставлены
`moderator`, `analyst`, `owner`, а `archivedByRole` принял каждое из семи значений.

### AC-2 — `t011-role-schema-contract`

```text
Команда: pnpm --filter server exec vitest run tests/role-schema-contract.test.ts
RED: exit 1 — Prisma не содержал moderator, analyst, owner
GREEN: exit 0 — 1 test passed
```

### AC-3 — `t011-frontend-role-single-source`

```text
pnpm codegen: exit 0
cmp /tmp/t011-codegen-before.diff /tmp/t011-codegen-after.diff: exit 0
grep ручного type/enum Role и user|admin: exit 1, stdout пуст (PASS: совпадений нет)
grep uppercase mock-ролей: exit 1, stdout пуст (PASS: совпадений нет)
```

### AC-4 — `t011-project-gates`

```text
pnpm --filter server run build:ci: exit 0
pnpm format: exit 0, All matched files use Prettier code style
pnpm lint: exit 0
pnpm test: exit 0
server: 11 files passed; 70 tests passed, 1 todo
web: 11 files passed; 75 tests passed
git diff --check: exit 0
```

Перед созданием отчёта snapshot имел base revision
`6c431e5184a558395dcc95db81ada4b1f670600d`; fingerprint списка изменённых путей
(`git status --porcelain=v1 | shasum -a 256`) —
`ecfd2f01a3a55f0d0cefb66475d47f1f63f04c1bf102a55d602953691fdf6e9e`.

## Остаток и передача

Реализация не применялась к Neon development и не выпускалась. Следующая стадия должна проверить
закоммиченную ревизию по AC-1…AC-4, затем передать её независимому ревьюеру. Render/Neon release
проверяется отдельно после merge в `app`.

## Выпуск: коррекция CI

PR #43 на ревизии `6aab217ac715f4f92c84092d8baed0e614d06316` выявил ошибку typecheck в двух
страницах admin: строковое значение формы присваивалось полю, ограниченному `Role`. Это
воспроизводится командой `pnpm --filter nuxt-app run typecheck` (exit 2, TS2322 на строках 240 и
417). Исправление ограничено приведением значения к типу целевого поля в обоих присваиваниях;
никаких миграций, GraphQL-контрактов или данных оно не изменяет.

После исправления на той же ветке выполнены:

```text
pnpm --filter nuxt-app run typecheck: exit 0
pnpm format: exit 0, All matched files use Prettier code style
pnpm lint: exit 0
pnpm test: exit 0
server: 11 files passed; 70 tests passed, 1 todo
web: 11 files passed; 75 tests passed
pnpm --filter server build:ci: exit 0
git diff --check: exit 0
```

Для merge требуется новый commit, повторный CI и независимая проверка изменённой ревизии.

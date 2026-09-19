# T-007: отчёт о детерминированном сиде

- **Task / issue**: T-007 / ALTE-63 (`01a0af61-f884-77db-b6cc-bce46335a18d`)
- **Источник**: `docs/backlog/tasks/T-007-deterministic-seed.md`, blob
  `772a87fd573b82a364d9029169c5b563375a6115`
- **Исходный baseline задачи**: `2979101be6c630d53d6796594253f1765913d0d5`
- **PR rebase base**: `67066a297cd047e1c6040dfcccac87e6de31496f` (`origin/app`)
- **Проверенная ревизия**: `d0a8ce9cf81f1126a940ca34cd181f02642cb82d`
- **Ветка**: `server/t007-deterministic-seed`
- **Implementer**: `b0f3bc32-dd95-471e-b40e-517aaf83edf0`
- **Run**: `01a0b7a2-1d06-7d5c-92d9-852f288a4ce2`

## Что сделано

- `prisma db seed` подключён к `server/seed/seed.ts` через Prisma-конфигурацию в
  `server/package.json`.
- Seed создаёт обычного читателя, авторов с планами `standard` и `pro`, их детерминированные
  неплатёжные `PlanGrant`, а также отдельные служебные записи `editor`, `moderator`, `analyst`,
  `admin` и первого `owner`.
- Добавлены шесть утверждённых рубрик продукта, пять форматов ADR-0005 и три демонстрационных
  тега. Реестры неизменяемых handle/slug заполняются до связанных сущностей.
- Для каждого значения `ArticleStatus` модели v2 создаётся один материал с исходной русской
  версией и ревизией. Их создание делегировано действующему DB-триггеру T-015, чтобы seed не
  дублировал инвариант синхронизации legacy-полей.
- Все записи используют стабильные ID и естественные уникальные ключи; повторный запуск
  выполняет `upsert` и не увеличивает счётчики. Начало обоих авторских грантов зафиксировано
  до дат тестовых публикаций и не зависит от времени запуска seed.

## Критерии

1. **Два запуска на пустой базе — passed.** После применения 14 миграций обе последовательные
   команды `pnpm --filter server exec prisma db seed` завершились с exit 0 и сообщением
   `T-007 seed completed`.
2. **Роли и статусы — passed.** SQL после второго запуска показал ровно по одной служебной
   записи `editor`, `moderator`, `analyst`, `admin`, `owner`; по одному материалу в статусах
   `draft`, `ai_check`, `review`, `in_review`, `rework`, `published`, `archived`; также 6 рубрик,
   5 форматов, 3 тега, 1 обычного читателя и 2 обычных авторов.

## Как проверено

Среда: Node `24.12.0`, pnpm `10.18.3`, одноразовый локальный PostgreSQL `17-alpine`. Миграции
применялись только к созданным для T-007 локальным базам; Neon и другие внешние базы не
затрагивались.

- RED: целевой Vitest suite не загрузился из-за отсутствующего `server/seed/seed.ts`.
- Целевой PostgreSQL-тест после реализации: 1 passed, exit 0; внутри одной чистой базы seed
  дважды запускается через публичную команду `prisma db seed` и проверяет неизменные счётчики,
  гранты авторов, роли, таксономию и полный enum статусов. Тест подключён к CI `server-smoke`.
- `prisma validate`: exit 0.
- `pnpm format`: exit 0.
- `pnpm lint`: exit 0.
- `T007_TEST_DATABASE_URL=… pnpm test`: exit 0; server — 26 files passed, 7 skipped,
  155 tests passed, 19 skipped; web — 21 files и 155 tests passed.
- `vitest run tests/admin-pd-audit.test.ts tests/seed-database.test.ts`: exit 0; 2 files,
  6 tests passed; T-029 files match `origin/app` byte-for-byte after rebase.
- `pnpm --filter server run build:ci`: exit 0.
- `git diff --check`: exit 0.

SQL после второго CLI-запуска:

```sql
SELECT role::text AS service_role, COUNT(*) AS count
FROM users
WHERE "isServiceAccount"
GROUP BY role
ORDER BY role;

SELECT status::text AS article_status, COUNT(*) AS count
FROM articles
GROUP BY status
ORDER BY status;

SELECT
  (SELECT COUNT(*) FROM sections) AS sections,
  (SELECT COUNT(*) FROM formats) AS formats,
  (SELECT COUNT(*) FROM tags) AS tags,
  (SELECT COUNT(*) FROM plan_grants) AS plan_grants,
  (SELECT COUNT(*) FROM users WHERE role = 'reader' AND NOT "isServiceAccount") AS readers,
  (SELECT COUNT(*) FROM users WHERE role = 'author' AND NOT "isServiceAccount") AS authors;
```

```text
 service_role | count
--------------+------
 editor       | 1
 moderator    | 1
 analyst      | 1
 admin        | 1
 owner        | 1

 article_status | count
----------------+------
 draft          | 1
 ai_check       | 1
 review         | 1
 in_review      | 1
 rework         | 1
 published      | 1
 archived       | 1

 sections | formats | tags | plan_grants | readers | authors
----------+---------+------+-------------+---------+--------
 6        | 5       | 3    | 2           | 1       | 2
```

## Остаток

- Нужны CI и независимое review итогового PR SHA.
- Production seed не запускался и не должен запускаться автоматически; merge и Done выполняет
  только controller.

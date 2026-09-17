# T-007: отчёт о детерминированном сиде

- **Task / issue**: T-007 / ALTE-63 (`01a0af61-f884-77db-b6cc-bce46335a18d`)
- **Источник**: `docs/backlog/tasks/T-007-deterministic-seed.md`, blob
  `772a87fd573b82a364d9029169c5b563375a6115`
- **Baseline**: `2979101be6c630d53d6796594253f1765913d0d5` (`origin/app`)
- **Проверенная ревизия реализации**: `720c198567b35b7e576ee0182fe346bafd13c822`
- **Ветка**: `server/t007-deterministic-seed`
- **Implementer**: `b0f3bc32-dd95-471e-b40e-517aaf83edf0`
- **Run**: `01a0afa1-7898-76e9-a800-77d7ba51384e`

## Что сделано

- `prisma db seed` подключён к `server/seed/seed.ts` через Prisma-конфигурацию в
  `server/package.json`.
- Seed создаёт обычного читателя, авторов с планами `standard` и `pro`, а также отдельные
  служебные записи `editor`, `moderator`, `analyst`, `admin` и первого `owner`.
- Добавлены шесть утверждённых рубрик продукта, пять форматов ADR-0005 и три демонстрационных
  тега. Реестры неизменяемых handle/slug заполняются до связанных сущностей.
- Для каждого значения `ArticleStatus` модели v2 создаётся один материал с исходной русской
  версией и ревизией. Их создание делегировано действующему DB-триггеру T-015, чтобы seed не
  дублировал инвариант синхронизации legacy-полей.
- Все записи используют стабильные ID и естественные уникальные ключи; повторный запуск
  выполняет `upsert` и не увеличивает счётчики.

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
  вызывается дважды и проверяются неизменные счётчики, роли, таксономия и полный enum статусов.
- `prisma validate`: exit 0.
- `pnpm format`: exit 0.
- `pnpm lint`: exit 0.
- `T007_TEST_DATABASE_URL=… pnpm test`: exit 0; server — 24 files passed, 7 skipped,
  141 tests passed, 19 skipped; web — 17 files и 132 tests passed.
- `pnpm --filter server run build:ci`: exit 0.
- `git diff --check`: exit 0.

## Остаток

- Нужны CI и независимое review итогового PR SHA.
- Production seed не запускался и не должен запускаться автоматически; merge и Done выполняет
  только controller.

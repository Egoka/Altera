# Миграционные тесты T-016 и T-017: базовые миграции одним вызовом Prisma

- **Дата**: 2026-09-19
- **Ветка**: `server/migration-test-single-baseline`
- **Задача**: прямое поручение владельца
- **Authorization**: письменное поручение в диалоге 2026-09-19 — «make the test fast and robust without
  weakening what it proves… apply all baseline migrations with a single `prisma db execute --stdin` call… Keep
  the target migration as a separate step… Check whether `server/tests/bookmark-plan-migration-database.test.ts`
  (T-017) uses the same per-migration spawn pattern, and apply the same change there if it does»; границы —
  тесты `server/tests`, план/отчёт, PR в `app`
- **Базовый коммит**: `f1e7c6e` (origin/app)
- **Исходное дерево**: clean (новый worktree от origin/app)
- **Отчёт**: `docs/reports/2026-09-19-migration-tests-single-baseline-report.md`
- **Статус**: выполняется

## 1. Цель

Тесты миграций T-016 (`media-asset-migration-database.test.ts`) и T-017
(`bookmark-plan-migration-database.test.ts`) в CI укладываются в таймаут с большим запасом и не зависят от
разброса скорости раннера. Проверяемое не ослабляется: базовые миграции применяются по порядку, затем целевая
миграция применяется отдельным шагом с проверкой кода выхода, и её результат проверяется на PostgreSQL 17.

## 2. Контекст

- Прогон https://github.com/Egoka/Altera/actions/runs/35454090217, попытка 1, job «Сборка сервера и дымовая
  проверка старта»: первый тест T-016 — 38 249 мс при таймауте 30 000 мс, второй — 19 252 мс. Повтор того же
  коммита (попытка 2) — 14 043 и 13 906 мс.
- В семи зелёных прогонах 2026-09-19 тест T-016 занимает 11,1–14,0 с, тест T-017 — 11,9–15,4 с (раздел 5 отчёта).
- Причина длительности: `applyBaselineMigrations()` вызывает `pnpm exec prisma db execute --file` отдельно для
  каждой миграции старше целевой. T-016 — 11 базовых миграций + 1 целевая, T-017 — 12 + 1; каждый запуск
  pnpm + Prisma CLI стоит около секунды, число запусков растёт с каждой новой миграцией.
- CI (`.github/workflows/pull_request.yml`) запускает с базой только T-016 и T-017. Тот же шаблон есть в
  `admin-records`, `article`, `audit-review-thread` и `taxonomy` migration-тестах, но в CI они пропускаются
  (нет `T0xx_TEST_DATABASE_URL`).
- Prisma 6.12: `prisma db execute` отправляет скрипт одним простым запросом (simple query). В PostgreSQL
  несколько операторов одного простого запроса выполняются одной неявной транзакцией, если в тексте нет явного
  `BEGIN`/`COMMIT`; явный `COMMIT` фиксирует накопленное, в том числе без открытого `BEGIN` — с предупреждением
  `there is no transaction in progress`.
- Миграции содержат собственные `BEGIN;`/`COMMIT;`, `ALTER TYPE … ADD VALUE` и временные таблицы
  `ON COMMIT DROP`. Простая склейка файлов сдвинула бы границы транзакций: новое значение enum из одного файла
  попало бы в одну транзакцию со следующими файлами.

## 3. Решение

- Общий helper `server/tests/helpers/migration-database.ts`:
  - `migrationsBefore(target)` — каталоги миграций с именем меньше целевого, отсортированные по имени (тот же
    порядок, что у `prisma migrate deploy` и прежнего цикла);
  - `baselineMigrationScript(target)` — один SQL-скрипт: файлы по порядку, после каждого — `COMMIT;`. Так каждая
    миграция фиксируется отдельно, как при прежних отдельных вызовах;
  - `applyBaselineMigrations(target, url)` — один `prisma db execute --stdin`; ненулевой код выхода — исключение
    с выводом Prisma;
  - `applyMigration(migration, url)` — прежний отдельный `prisma db execute --file` для целевой миграции,
    результат возвращается тесту для `expect(status).toBe(0)`.
- T-016 и T-017 используют helper; остальные helper-функции тестов (`withDatabase`, `prismaFor`, сиды,
  проверки) не меняются.
- Unit-тест helper без базы: скрипт содержит ровно миграции до целевой, в порядке имён, каждая с отдельным
  `COMMIT`, без целевой и более поздних.
- Таймаут 30 000 мс не меняется: после исправления тест ожидается около 3 с, запас — порядка десяти раз.

## 4. Шаги

1. Helper и unit-тест; unit-тест проходит локально.
2. Перевести T-016 и T-017 на helper, убрать неиспользуемые импорты.
3. `pnpm format`, `pnpm lint`, `pnpm test`, `tsc --noEmit` для изменённых тестов.
4. Commit, push, PR в `app`; длительности тестов «после» — из логов CI этого PR.
5. Отчёт с длительностями до/после, commit в ту же ветку.

## 5. Критерии готовности

- **AC-MT-1**: T-016 и T-017 применяют базовые миграции одним запуском Prisma CLI, целевую — отдельным запуском
  с проверкой кода выхода — diff.
- **AC-MT-2**: порядок и границы транзакций базовых миграций сохранены — unit-тест helper.
- **AC-MT-3**: в CI на PostgreSQL 17 оба файла проходят, все проверки результата миграций прежние; длительность
  теста существенно ниже прежних 11–15 с — логи CI PR.
- **AC-MT-4**: `pnpm format`, `pnpm lint`, `pnpm test` — exit 0.

## 6. Что сознательно не входит

- Перевод четырёх migration-тестов, которые CI не запускает (`admin-records`, `article`, `audit-review-thread`,
  `taxonomy`), — отдельная задача; helper готов для них.
- Изменение CI workflow, таймаутов, самих миграций и схемы.

## 7. Риски

- Миграция из одного оператора, который нельзя выполнять в транзакции (`CREATE INDEX CONCURRENTLY`,
  `VACUUM`), пройдёт через `--file`, но не в общем скрипте. Сейчас таких миграций нет; при появлении тест упадёт
  явно, с выводом Prisma.
- Одна сессия вместо отдельных: состояние сессии переходит между файлами. Сейчас миграции не используют `SET`
  уровня сессии, временные таблицы объявлены `ON COMMIT DROP`.
- Локально PostgreSQL 17 недоступен (Docker daemon отвечает HTTP 500), поэтому проверка на базе — только в CI.

## 8. Стадии и handoff

Прямое поручение: одна стадия реализации в этом worktree, итог — PR в `app` и отчёт с фактическими
длительностями из CI.

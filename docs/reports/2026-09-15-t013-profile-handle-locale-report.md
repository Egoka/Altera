# T-013: профиль, вечный резерв хэндлов и основной язык — отчёт

- **Дата**: 2026-09-15
- **Задача**: T-013 / ALTE-36
- **Ветка**: `server/t-013-profile-handle-locale`
- **План**: `docs/plans/2026-09-15-t013-profile-handle-locale.md`
- **Архитектурный baseline**: `4c059f1e609464aec3135984fa623ca42c478330`
- **Implementation baseline после свежего fetch `origin/app`**: `52910e46fda736df668073f656973d919052e1cb`
- **Статус**: реализовано, требуется независимое тестирование и ревью

## Что сделано

- В `User` добавлены `handle`, `locale`, ссылки на текущий и предыдущий avatar asset, статусы проверки
  имени/аватара и индексы статусов; legacy `slug` удалён.
- Добавлена append-only модель `HandleHistory`: её первичный ключ образует единый вечный реестр, связь с
  владельцем использует `ON DELETE SET NULL`, а текущий `User.handle` ссылается на тот же реестр.
- Миграция `20260915170000_user_profile_handle_locale` создаёт enums, таблицу, индексы, FK и оба `CHECK`,
  проверяет case-insensitive конфликты legacy slug, сохраняет legacy адреса и выдаёт каждому существующему
  пользователю новый случайный `u-{8 hex}` без использования e-mail.
- Регистрация резервирует хэндл и создаёт пользователя в одной Prisma transaction. `P2002` реестра приводит к
  новому случайному кандидату; остальные ошибки не маскируются. Гонка по e-mail дочитывает пользователя,
  созданного параллельным запросом, и продолжает выдачу magic link.
- Смена хэндла нормализует и валидирует значение, затем резервирует его и обновляет пользователя в одной
  transaction. Повторная выдача прежнего или занятого значения возвращает доменный `CONFLICT`; rollback при
  ошибке создания пользователя отдельно проверен на PostgreSQL.
- GraphQL принимает locale регистрации явно. Публичный `User` использует `handle` и не содержит e-mail/роль;
  приватные операции `me`, auth payload и admin list используют отдельный `AccountUser`. Web operations и
  сгенерированные типы обновлены, авторские cache tags переведены на handle.
- Namespace payload cache повышен с `v1` до `v2`, поэтому Redis-объекты со старым `author.slug` не читаются
  новым GraphQL-контрактом `User.handle!` после выкладки.

## Отклонения и решения реализации

- Инварианты и значения замороженного плана не менялись. Для совместимости приватных запросов введён
  `AccountUser`: это позволяет выполнить требование ADR-0018 к публичному `User`, не удаляя e-mail и роль из
  авторизованных `me`/auth/admin сценариев.
- Prisma CLI сворачивает диагностическое исключение preflight в `P2002`; сама миграция формирует сообщение с
  числом групп конфликтов без значений slug/e-mail. Integration test дополнительно доказывает полный rollback:
  колонка `handle` не появилась, обе исходные строки остались неизменными.
- Гарантия БД формулируется через единый append-only реестр: любой поддерживаемый сценарий выдачи сначала
  вставляет новую строку `handle_history`, а повторный `INSERT` прежнего значения отклоняется PK. FK текущего
  хэндла сам по себе не является разрешением на обход сервисной transaction прямым SQL-обновлением `users`.
- Production/development Neon не изменялась. Все destructive migration rehearsal выполнялись только в
  одноразовом локальном PostgreSQL 16.

## Как проверено

- `shasum -a 256 docs/plans/2026-09-15-t013-profile-handle-locale.md` →
  `9bceddbc711fcd03bcda2f0f41b2362408447c378f208e48767a21915680080c`; замороженный план перенесён без
  изменений.
- RED, allocator: `pnpm --filter server exec vitest run tests/profile-handle-allocation.test.ts` → 2/2 теста
  падали на выходящем `P2002` до реализации.
- RED, schema/API: `pnpm --filter server exec vitest run tests/auth-schema-contract.test.ts
  tests/public-schema-contract.test.ts` → новые проверки падали из-за отсутствующих `HandleHistory` и
  `User.handle`.
- PostgreSQL 16 integration: `T013_TEST_DATABASE_URL=<одноразовая локальная PostgreSQL 16> pnpm --filter server
  exec vitest run tests/profile-handle-database.test.ts` → 1 test file, 4/4 теста passed. Проверены чистый
  `migrate deploy`, backfill снимка схемы до T-013, case-insensitive preflight rollback, вечный резерв после
  сервисной смены/архива/удаления, `userId = NULL` после удаления и rollback случайного резерва при конфликте
  e-mail.
- На отдельной чистой локальной базе `prisma migrate deploy` применил все 8 миграций, затем `prisma migrate
  diff --from-url <одноразовая локальная PostgreSQL 16> --to-schema-datamodel prisma/schema.prisma --exit-code`
  завершился с `No difference detected`.
- `pnpm codegen` → exit 0; SDL, documents и generated GraphQL types согласованы.
- `pnpm --filter server run build:ci` → exit 0; Prisma Client сгенерирован, TypeScript собран без применения
  миграций к внешней среде.
- `pnpm --filter nuxt-app build` → exit 0; production Nuxt build завершён. Неблокирующие warnings: локальная
  Node `24.3.0` вместо зафиксированной `24.12.0`, устаревший browserslist snapshot и известное отсутствие sharp
  binary для darwin-arm64.
- `pnpm format` → exit 0.
- `pnpm lint` → exit 0.
- `T013_TEST_DATABASE_URL=<одноразовая локальная PostgreSQL 16> pnpm test` → exit 0: server 16 test files,
  95/95 tests passed; web 14 test files, 106/106 tests passed; всего 30 test files и 201/201 tests passed.
- Регрессия Redis проверяет cache miss для старых `cache:v1` payload как article detail, так и public list;
  unit-тесты смены хэндла покрывают успешную нормализацию, повтор своего прежнего значения, чужой резерв и
  валидацию до открытия transaction.
- `git diff --check` → exit 0.
- Независимое code review после исправления cache compatibility и операции смены хэндла: Critical 0,
  Important 0, verdict `Ready to merge: Yes`; release verification остаётся отдельной стадией.

## Ограничения и следующий этап

- Этот отчёт подтверждает локальную реализацию и migration rehearsal. Миграция Render/Neon, deployed HTTP,
  DB-aware readiness и Redis checks относятся к release stage после CI, merge и независимого review.
- Следующий владелец: тестировщик для независимой приёмки AC-1…AC-4 на implementation commit, затем reviewer.

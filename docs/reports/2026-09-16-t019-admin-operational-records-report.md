# T-019: операционные записи — отчёт реализации

- **Дата**: 2026-09-16
- **Задача**: T-019 / ALTE-48
- **Источник**: `docs/backlog/matrix.md`, спецификации `docs/spec/40-admin/*`
- **Baseline**: `64c47488bd847467ed2f44cdb4877b4b10591d78`
- **Ветка**: `server/t-019-admin-records`

## Результат

1. Добавлены очередь `Job` и отдельная история `JobAttempt` со статусами, порядковым номером попытки,
   временными метками и безопасной ссылкой на класс ошибки и `requestId`.
2. Добавлены записи AI-процессов по видам и статусам. Стоимость отсутствует у отдельного процесса и хранится
   только в `AiCostAggregate` по временному интервалу и виду процесса.
3. Добавлены история писем и события доставки. История хранит адрес, тему и очищенное содержимое; полей для
   токенов, секретов, паролей, cookies или credentials нет.
4. Добавлены сгруппированные записи ошибок и история рабочих статусов «новая / в работе / решена». Техническое
   сообщение и стек имеют явные имена `sanitizedMessage` и `sanitizedStack`; произвольного контекста и полей
   секретов нет.
5. Добавлены версионируемые юридические тексты семи утверждённых видов и согласия пользователя с конкретной
   версией. Уникальные ограничения исключают повтор версии и повтор согласия.
6. SQL-миграция `20260916120000_admin_operational_records` согласована с Prisma schema без drift.

## Критерии готовности

### 1. Секреты и токены не имеют полей в истории писем и записях ошибок

Интеграционный тест читает фактические колонки PostgreSQL после миграции и проверяет отсутствие имён для
`token`, `secret`, `password`, `credential`, `authorization` и `cookie`. Дополнительно он требует только
очищенные поля `sanitizedBody`, `sanitizedMessage`, `sanitizedStack` и запрещает необозначенные поля
`message`, `stack`, `context`. У отдельной записи AI-процесса нет стоимости; `totalCostMinor` существует
только у агрегата.

### 2. Миграция применяется на копии

Миграция применена вместе со всеми девятью предшествующими миграциями на новой одноразовой PostgreSQL 17
базе. Отдельный тест дважды создаёт независимую базу, применяет baseline и целевую миграцию, проверяет таблицы,
уникальность попыток и согласий, затем удаляет базу. Development/production Neon не затрагивались.

## Как проверено

Среда: Node `24.12.0`, pnpm `10.18.3`, одноразовый контейнер `postgres:17-alpine`.

| Проверка | Команда | Результат |
| --- | --- | --- |
| TDD RED схемы | `T019_TEST_DATABASE_URL=… pnpm --filter server test -- admin-records-migration-database.test.ts` | 2 теста упали: целевой migration отсутствовал |
| TDD RED privacy | та же команда после первого GREEN | 1 тест упал: у ошибки было поле `message`, отсутствовало `sanitizedMessage` |
| Migration rehearsal | `pnpm --dir server exec prisma migrate deploy` на новой PostgreSQL 17 БД | 10 миграций применены, exit 0 |
| Drift | `pnpm --dir server exec prisma migrate diff --from-migrations … --to-schema-datamodel … --exit-code` | `No difference detected`, exit 0 |
| Prisma schema | `pnpm --dir server exec prisma validate` | schema valid, exit 0 |
| Server build | `pnpm --filter server run build:ci` | Prisma generate, TypeScript и GraphQL copy, exit 0 |
| Server tests | `T019_TEST_DATABASE_URL=… pnpm --filter server test` | 19 files passed, 2 skipped; 119 tests passed, 6 skipped |
| Web tests | `pnpm --filter nuxt-app test` | 15 files passed; 121 tests passed |
| Lint | `pnpm lint` | exit 0 |
| Format | `pnpm format` | exit 0 |
| Diff whitespace | `git diff --check` | exit 0 |

## Ограничения

- Исполнитель очереди, почтовый транспорт, AI-адаптер, сборщик ошибок и GraphQL/UI разделы не входят в T-019.
- Шесть DB-тестов других задач остаются skipped без их отдельных переменных окружения; оба T-019 DB-теста
  реально выполнены на PostgreSQL 17.
- Миграция проверена только на изолированных одноразовых базах; development и production не мигрировались.

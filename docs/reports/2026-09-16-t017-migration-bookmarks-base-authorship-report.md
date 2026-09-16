# T-017: отчёт о миграции закладок и базового авторства

- **Task / issue**: T-017 / ALTE-53 (`01a0a9d5-fdea-7e05-97da-6447250e307b`)
- **Источник**: `docs/backlog/tasks/T-017-migration-bookmarks-base-authorship.md`, blob
  `4c4749708d1f5406ea65c090695e492d8ee2065f`
- **Baseline**: `99511c3ceb0ff32a93cb15b1b359f48b3a3f3e0c` (`origin/app`)
- **Ревизия реализации**: `ad4f35f6ab9155c834e59b8d411a45a08e0c9111`
- **Ветка**: `server/t-017-bookmarks-base-authorship`
- **Implementer**: `b0f3bc32-dd95-471e-b40e-517aaf83edf0`
- **Run**: `01a0aacc-fb52-78b7-b57d-68af98151e73`

## Что сделано

- Добавлены `PlanTier`, кэш плана `User.planTier` / `planUntil` и `PlanGrant`.
- Бессрочный автоматический грант допускает только `standard`, `endsAt = NULL` и
  `grantedById = NULL`; бессрочный `pro` и `free` отклоняются ограничениями PostgreSQL.
- Существующие пользователи с ролью `author` получают бессрочный базовый грант и кэш
  `planTier = standard`, без создания `Subscription`.
- Добавлена приватная модель `Bookmark` с составным ключом `(userId, articleId)`, каскадным
  удалением и индексом личного списка по времени добавления.
- Допуск к закладкам зафиксирован декларативно: составной внешний ключ хранит снимок роли и
  признака служебной записи, а `CHECK` принимает только обычные `reader` / `author`. Это также
  не позволяет конкурентно превратить владельца закладок в служебную запись.
- PostgreSQL-тест миграции подключён к CI job `server-smoke`; отсутствие DB-запуска больше не
  превращается в зелёное доказательство T-017.

## Критерии

1. **Служебная роль не может иметь закладок — passed.** PostgreSQL-тест отклоняет `editor`,
   служебного `reader`, повторную пару и переход владельца закладки в служебную роль. Отдельный
   двухсоединительный сценарий проверяет конкуренцию создания закладки и смены роли.
2. **Базовое авторство без подписки — data contract passed.** Миграция создаёт бессрочный
   `PlanGrant(standard)` и обновляет кэш автора без `Subscription`. Поведенческий тест
   `ensureActiveAuthor` принадлежит зависимой T-026, как указано в источнике T-017.

## Как проверено

Среда: Node `24.12.0`, pnpm `10.18.3`, одноразовый PostgreSQL `17-alpine`. Миграции не
применялись к Neon или другой внешней базе.

- RED schema contract: 2 теста упали из-за отсутствующих `PlanTier` и `Bookmark`.
- RED migration rehearsal: 2 теста упали из-за отсутствующего каталога целевой миграции.
- RED после первого review: бессрочный `pro` был принят; новый negative test упал ожидаемо.
- `prisma validate`: exit 0, схема валидна.
- Целевые тесты: schema contract — 2 passed; PostgreSQL migration — 3 passed.
- `prisma migrate deploy`: exit 0, применены 11 миграций на чистую одноразовую базу.
- `prisma migrate status`: exit 0, `Database schema is up to date!`.
- `prisma migrate diff --from-migrations ... --to-schema-datamodel ... --exit-code`: exit 0,
  `No difference detected.`
- `pnpm format`: exit 0.
- `pnpm lint`: exit 0.
- `T017_TEST_DATABASE_URL=… pnpm test`: exit 0; server — 22 files passed, 3 skipped,
  124 tests passed, 9 skipped; web — 17 files и 131 tests passed.
- `pnpm --filter server run build:ci`: exit 0.
- `git diff --check`: exit 0.

Предварительный независимый read-only review ревизии
`ad4f35f6ab9155c834e59b8d411a45a08e0c9111` не нашёл Critical / Important замечаний и дал
вердикт merge-ready. Неблокирующая рекомендация: заменить 50-мс барьер в concurrency test на
наблюдение `pg_stat_activity`; декларативный FK + CHECK проверены как корректные для обеих
очерёдностей гонки. Для контроллера всё ещё требуется native review итогового PR SHA.

## Остаток

- Реализация `ensureActiveAuthor` и её поведенческая матрица остаются в T-026.
- Миграция development / production, merge и Done выполняются только управляемым контроллером
  после CI и native review итогового SHA.

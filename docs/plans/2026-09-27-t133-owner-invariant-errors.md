# T-133: инвариант владельцев под конкуренцией, ошибки действий, e-mail владельцев — план

- **Дата**: 2026-09-27
- **Задача**: T-133 / ALTE-124 (native issue `01a0e14b-e385-7d35-88f0-3fc88c3467ae`)
- **Authorization**: прямое поручение владельца 2026-09-26 «заведи задачи на доработку возвращённых 16»
- **Источник**: `docs/backlog/tasks/T-133-admins-owner-invariant-errors.md`
- **Baseline**: `178b8ad5dfd0139a7c0616a6e8996a6996f76e56` (`origin/app`, свежий fetch 2026-09-27)
- **Ветка**: `server/t133-owner-invariant`, рабочее дерево `.worktrees/t133-owner-invariant`
- **Исходное дерево**: clean
- **Отчёт**: `docs/reports/2026-09-27-t133-owner-invariant-errors-report.md` (после зелёного CI)

**Цель:** закрыть четыре дефекта, найденные независимым ревью 2026-09-26 у возвращённой T-074:
write skew инварианта «хотя бы один владелец», невидимые ошибки мутаций раздела, полный e-mail
владельцев без записи чтения ПДн и создание служебной записи в двух транзакциях.

## 1. Контракт и границы

Старшинство источников: журнал решений (#10, #46–47, §26.7, §28.7) → `docs/spec/40-admin/admins.md`
и `docs/spec/50-access/escalation-and-demotion.md` §3 → находки ревью.

Сохраняемый контракт: состав мутаций раздела, аудит `role.*`, двухшаговое назначение владельца
(§26.7), словарь ошибок `server/src/errors/dictionary.ts`.

Не входит: архивирование записи при снятии роли (T-117), интерфейс исключений, стабильность e2e
(сделано PR #216).

## 2. Наблюдаемое исходное состояние

1. `server/src/admin/staff.ts:623-656,697-734` — `revokeOwner` и `deactivateOwner` меняют строку и
   считают владельцев на READ COMMITTED без блокировки: два параллельных отзыва читают каждый по
   двум владельцам и оба фиксируют изменение (write skew → 0 владельцев).
2. `web/app/composables/useAdminStaff.ts:104-123` — `failure` после отказа мутации ставится, но
   страница показывает только `CONFLICT` (`web/app/pages/admin/admins/index.vue:62,199-203,503-505`);
   список после отказа не перечитывается, хотя строка §9 обещает «список обновлён».
3. `server/src/admin/staff.ts:334-357` — `listOwners` отдаёт полный `email` без `admin.read.personal`,
   в отличие от списка служебных записей (`:289`) и списка писем (`server/src/admin/mail.ts:255-262`).
4. `server/src/admin/staff.ts:406-441` — аккаунт создаётся в транзакции
   `createUserWithReservedHandle`, а роль, признак служебной записи и аудит — во второй транзакции.
   Сбой второго шага оставляет аккаунт читателя с этим адресом, и повтор создания навсегда падает
   `VALIDATION_ERROR/not-an-account`.

`requestId` по словарю ошибок (`server/src/errors/graphql-error.ts:14,59-63`) публичен только у
`INTERNAL_ERROR` и `PROVIDER_UNAVAILABLE`; у остальных кодов он вырезается из extensions.

## 3. Шаги

### Шаг 1 (AC-1) — блокировка действующих владельцев

`server/src/admin/staff.ts`: добавить `lockActiveOwners(tx)` —
`SELECT "id" FROM "users" WHERE "role" = 'owner'::"Role" AND "archivedAt" IS NULL ORDER BY "id" FOR UPDATE`
(приём слияния разделов, `server/src/taxonomy/service.ts:154-159,258`). Вызывать первым действием
транзакции `revokeOwner` и `deactivateOwner`, до `loadTarget`, изменения роли и `ensureOwnerRemains`.
`ORDER BY "id"` даёт один порядок захвата строк обеим транзакциям.

### Шаг 2 (AC-3) — маска e-mail в списке владельцев

`listOwners` отдаёт `maskEmail(email)` и `emailMasked: true`; поле `emailMasked: Boolean!`
добавляется в `AdminOwner` (`server/src/graphql/staff/schema.graphql`), в запрос `GetOwners`
и в сгенерированные типы (`pnpm codegen`). Полный адрес остаётся только в карточке записи, чей
показ уже пишет `admin.read.personal` (`:305-318`) — отдельная запись для списка не нужна, потому
что ПДн он больше не раскрывает (§28.7).

### Шаг 3 (AC-4) — создание служебной записи одной транзакцией

`server/src/auth/handle.ts`: `createUserWithReservedHandle` принимает необязательные `role` и
`isServiceAccount` и необязательный шаг `onCreated(tx, user)`, который выполняется в той же
транзакции. Цикл повтора при занятом хэндле остаётся снаружи транзакции.
`createStaff` создаёт запись сразу служебной, с целевой ролью и аудитом `user.create.staff`
в одной транзакции; письмо входа по-прежнему ставится после коммита (`appoint-admin.md` §5).

### Шаг 4 (AC-2) — ошибки мутаций в интерфейсе

`web/app/composables/useAdminStaff.ts`: отдельное состояние `actionFailure` (как у
`useAdminJobs`), с `code`, `entity`, `field`, `rule`, `requestId`; после любого исхода мутации
список, владельцы и открытая карточка перечитываются, затем восстанавливается состояние отказа.
`web/app/pages/admin/admins/index.vue`: `role="alert"` с `data-staff-failure="<code>"` на странице
и в обоих диалогах; строка выбирается по коду (`CONFLICT` → существующие `conflict` и `lastOwner`,
`VALIDATION_ERROR`, `FORBIDDEN`, `NOT_FOUND`, `PROVIDER_UNAVAILABLE`, `ARCHIVED`, иначе общая),
а `requestId` печатается существующим ключом `requestCode`, когда сервер его отдал.
Новые ключи `ru.json` и `en.json` под `admin.staff`.

## 4. Проверки

| check_id | Что проверяет                                                          | Команда                                                                                                      |
| -------- | ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| T133-C1  | AC-1: два параллельных отзыва на PostgreSQL оставляют одного владельца | `T133_TEST_DATABASE_URL=… pnpm --filter server exec vitest run tests/admin-staff-database.test.ts` |
| T133-C2  | AC-3, AC-4 и блокировка на двойнике                                    | `pnpm --filter server exec vitest run tests/admin-staff.test.ts`                                             |
| T133-C3  | AC-2: строка «Ошибка — мутация» на каждый код                          | `pnpm --filter web exec playwright test tests/e2e/22-admin-admins.spec.ts`                                   |
| T133-C4  | Регрессия сервера и web                                                | `pnpm -r test`                                                                                               |
| T133-C5  | Типы, формат, линт                                                     | `pnpm --filter web typecheck`, `pnpm format`, `pnpm lint`                                                    |

Шаг CI для T133-C1 добавляется в `.github/workflows/pull_request.yml` рядом с прочими проверками
на настоящем PostgreSQL.

## 5. Риски

- `$queryRaw` в `revokeOwner`/`deactivateOwner` требует `$queryRaw` у тестового двойника
  `MemoryPrisma` — двойник дополняется, иначе прежние тесты раздела падают.
- Маска в списке владельцев меняет ответ `owners`: e2e-заготовка спецификации обновляется вместе
  со схемой.
- `requestId` у `VALIDATION_ERROR`, `FORBIDDEN`, `NOT_FOUND` и `CONFLICT` не публичен по словарю
  ошибок; интерфейс печатает его, когда он пришёл. Расширение словаря — отдельное решение.

# План T-128: кэш плана синхронизирован с выдачами; базовые выдачи вне раздела грантов

- **Задача**: T-128 (`docs/backlog/tasks/T-128-plan-cache-sync-grants.md`), карточка ALTE-117
- **Baseline задачи**: `5af26a3fd661917cb00e8021409ffe4e6352c8c1`
- **Ветка/worktree**: `server/t128-plan-cache-sync` от `origin/app` `266299a19be34d4d342c57fbe4d582506d9dd6a3`
- **Источники**: журнал §24.1, §25.1, §27.1; `docs/spec/70-plans-and-billing/role-derivation.md`
  §2 п. 2–3, п. 6, п. 9; `plan-free.md` п. 3, п. 6а; `docs/spec/40-admin/grants-and-promo.md`;
  ADR-0037; `docs/reports/2026-09-26-in-review-acceptance-report.md` (строки T-037, T-084)

## 1. Что сломано сейчас

1. `grantPlan` и `revokePlan` (`server/src/admin/grants.ts:124-186`) пишут только `PlanGrant` и
   аудит. Кэш `User.role`, `User.planTier`, `User.planUntil` остаётся прежним, поэтому читатель с
   действующей админской выдачей получает `PLAN_LIMIT`, а отозванная выдача авторство не закрывает
   (`role-derivation.md` §2 п. 2–3).
2. `enableBaseAuthorship` (`server/src/authorship/base-authorship.ts:60`) считает «первым нажатием»
   аккаунт вообще без `PlanGrant`. Любая прошлая админская выдача навсегда закрывает базовое
   авторство, хотя на первом запуске платности нет и `plan-free.md` п. 3 ещё не действует (§24.1).
3. `listAdminGrants` (`:84`) отдаёт все `PlanGrant`, включая автоматические базовые; `revokePlan`
   их отзывает. По §27.1 базовое авторство закрывается только архивированием аккаунта.
4. Бейдж `grade` в публичных ответах (`author`, `feed`, `catalog`) читает только `planTier` и
   срока не учитывает: истёкшая выдача `pro` продолжает показывать бейдж `pro`.

## 2. Решение

Одна точка вывода кэша плана из выдач, вызываемая во всех трёх транзакциях записи, и вывод
бейджа из пары `planTier` + `planUntil` на чтении. Истечение срочной выдачи не требует
планировщика: права уже считаются по `planUntil` (`hasActiveAuthorPlan`), а бейдж начинает
считаться так же — это разрешённый границами задачи «пересчёт при чтении».

### 2.1 Новые модули

- `server/src/plans/plan-state.ts` — чистые правила без обращения к базе:
  - `deriveGrantStatus` переезжает сюда из `admin/grants.ts` (там остаётся ре-экспорт, чтобы
    не трогать внешние импорты);
  - `isBaseGrant(grant)` — базовая выдача первого запуска: `endsAt === null && grantedById === null`
    (`plan-free.md` п. 6а);
  - `adminGrantWhere` — фильтр Prisma «всё, кроме базовых выдач» для раздела грантов;
  - `authorGradeOf(user, now)` — бейдж `pro` только у действующего `pro` (ADR-0037).
- `server/src/plans/plan-cache.ts`:
  - `derivePlanCache(grants, now)` — `{ role, planTier, planUntil }` по действующим выдачам,
    приоритет периодов берётся у существующей `deriveAccountSubscription` (журнал §8.22);
  - `syncPlanCache(tx, userId, now)` — читает выдачи пользователя в той же транзакции и пишет кэш.

Служебные роли и служебные записи от плана не зависят (`role-derivation.md` п. 6): `role` у них
не меняется.

### 2.2 Правки продуктового кода

| Файл | Правка | AC |
|---|---|---|
| `server/src/admin/grants.ts` | `grantPlan`: `syncPlanCache` в той же транзакции | AC-1 |
| `server/src/admin/grants.ts` | `revokePlan`: `syncPlanCache` в той же транзакции | AC-2 |
| `server/src/admin/grants.ts` | `revokePlan`: базовая выдача — `FORBIDDEN` | AC-4 |
| `server/src/admin/grants.ts` | `listAdminGrants`/`getAdminGrant`: без базовых выдач | AC-4 |
| `server/src/authorship/base-authorship.ts` | «первое нажатие» — отсутствие базовой выдачи, а не отсутствие любой | AC-3 |
| `server/src/graphql/{author,feed,catalog}/resolver.ts` | `grade` через `authorGradeOf`, в выборку добавляется `planUntil` | AC-5 |
| `server/src/account/dashboard.ts` | импорт `deriveGrantStatus` из нового модуля | — |

Отозванная **базовая** выдача остаётся закрытой: §27.1 допускает закрытие базового авторства
только согласованным архивированием аккаунта, поэтому повторного автоматического открытия нет.
Меняется только правило для **админских** выдач (срочных, с выдавшим сотрудником).

### 2.3 Проверки

- `server/tests/plan-cache.test.ts` — вывод кэша по выдачам (приоритет, срок, отзыв, служебные роли).
- `server/tests/admin-grants.test.ts` — AC-1, AC-2 (двойник), AC-4.
- `server/tests/base-authorship.test.ts` — AC-3 и сохранённое поведение отозванной базовой выдачи.
- `server/tests/plan-cache-database.test.ts` — AC-2 на настоящем PostgreSQL: выдача, вторая
  выдача, отзыв срочной, состояние кэша после каждого шага. Ключ `T128_TEST_DATABASE_URL`,
  отдельный шаг в `.github/workflows/pull_request.yml` рядом с прочими database-проверками.
- `server/tests/author-page.test.ts`, `public-catalogs.test.ts`, `home-feed.test.ts` — AC-5 без
  подстановки `planTier`: состояние готовится через `grantPlan`, бейдж читается резолвером.

## 3. Границы

Вне задачи: экран грантов, пагинация и фильтры (T-084); поведение после включения платности
(этап F-01); ночная сверка кэша и планировщик деактивации подписки (`role-derivation.md` п. 3, 9) —
это контур подписок, которого на первом запуске нет (§24.1).

## 4. Порядок работ

1. Новые модули `plan-state.ts`, `plan-cache.ts`; перенос `deriveGrantStatus`.
2. `grantPlan`, `revokePlan`, список грантов.
3. `enableBaseAuthorship`.
4. Бейдж в трёх резолверах.
5. Тесты (unit + PostgreSQL), шаг CI.
6. `pnpm format`, `pnpm lint`, `pnpm test`, `pnpm --filter server run build:ci`, database-тест.
7. Отчёт `docs/reports/`, receipt `docs/reports/tasks/T-128.{json,md}`, PR с автослиянием.

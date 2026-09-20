# План: T-037 — базовое авторство при первом «Создать статью»

- **Задача**: T-037, Multica ALTE-84
- **Источник**: `docs/backlog/tasks/T-037-base-authorship-first-create.md`
- **Baseline**: `4ea27a63d0fac9ccc9eb38cde522d9b17b58799b` (`origin/app`), ветка `server/t037-base-authorship`
- **Зависимости**: T-017 (merge 7a900e02), T-026, T-039 (merge 2f8870505e5e27e128d26a8da0362431b3a98b2a — в `app`)

## 1. Что требуется

Первое нажатие «Создать статью» бессрочно включает базовые авторские возможности без оплаты и
одобрения, создаёт черновик и открывает редактор; пишется событие `author.enabled` (#87);
служебные записи авторство не получают.

Источники правил: `docs/spec/10-flows/become-author.md` шаг 1 и развилки,
`docs/spec/70-plans-and-billing/plan-free.md` п. 6а, `docs/spec/30-account/author/article-new.md`
§1–4, `docs/spec/50-access/permission-checks.md` п. 3 и 6,
`docs/spec/70-plans-and-billing/role-derivation.md` п. 1, 6, 7, 9; журнал §24.1, §25.1–3; ADR-0052.

## 2. Состояние до работы

- T-017 уже создал `PlanGrant` с ограничениями под бессрочную базовую выдачу: `endsAt IS NULL AND
  grantedById IS NULL AND tier = 'standard'` и частичный уникальный индекс «одна бессрочная выдача
  на аккаунт». Миграции менять не требуется.
- T-039 сделал `createArticle` черновиком-первым, но путь читателя закрыт: `ensureActiveAuthor`
  считает активным только план со сроком в будущем, поэтому бессрочная выдача (`planUntil = NULL`)
  не проходит проверку, а включения авторства при первом нажатии нет вовсе.

## 3. Шаги

1. `ensureActiveAuthor` — признать бессрочную выдачу активным планом: вынести проверку в
   `hasActiveAuthorPlan`, где `planTier != free` и `planUntil = NULL` означает выдачу без срока.
2. Новый модуль `server/src/authorship/base-authorship.ts` — `enableBaseAuthorship`: включает
   базовое авторство один раз, синхронизирует кэш плана (`role`, `planTier`, `planUntil`) и пишет
   аудит `author.enabled` с `userId`, `grantId` и временем.
3. `createArticle` — вызвать включение до проверки плана, сохранив порядок проверок
   `permission-checks.md` п. 3; остальной путь черновика не менять.
4. Тесты: включение, отсутствие дубля, служебные роли и записи, архив, истёкшая и отозванная
   выдача, бессрочная выдача в `ensureActiveAuthor`.
5. E2E flow #2 шаг 1: «Создать статью» открывает редактор нового черновика; отказ не открывает.
6. Отчёт по ритуалу проекта.

## 4. Границы

Не входит: выбор плана, оплата и checkout (F-01); `me.limits` с `authorEnabled`; карточка
аккаунта в админке; письма о включении авторства (отложено, §25.13).

## 5. Проверки

`pnpm format`, `pnpm lint`, `pnpm test`, `pnpm codegen --check`,
`pnpm --filter server run build:ci`, `pnpm --filter nuxt-app run typecheck`,
браузерная проверка нового сценария flow #2.

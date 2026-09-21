# Отчёт T-036: подписка `/me/subscription` в режиме первого запуска

- **Задача**: `docs/backlog/tasks/T-036-subscription-page-launch-mode.md`
  (file SHA `ac8c9563012432f56903dcc812430678fec3a780`)
- **Native issue**: ALTE-110 (`01a0c1f0-b80b-75db-8647-14c48f9906fe`)
- **План**: `docs/plans/2026-09-21-t036-subscription-launch.md`
- **Baseline `origin/app`**: `20002d3aa074de2d8c8cfa5f25b283f607be606f`
- **Проверенный SHA**: `3b4ae0cb5b1b3fde30a195259991e72227a20e64`
- **Ветка**: `feat/t036-subscription-launch`, PR [#199](https://github.com/Egoka/Altera/pull/199),
  слит в `app` автослиянием как `a9ac34ab1437aeb94ec99353f646f4ca98d84b65`

## Что сделано

### Сервер

`server/src/graphql/account/` — платёжные мутации страниц «Подписка» и «Оплата»:
`startCheckout(tier, interval, promo)`, `cancelSubscription`, `resumeSubscription`,
`requestRefund(paymentId, reason)`, `confirmPriceChange(decision)`. До включения платности
(журнал §24.1) каждая отвечает `FORBIDDEN` с правом из матрицы доступа (`checkout.start`,
`subscription.cancel`, `subscription.resume`, `refund.request`, `subscription.price.confirm`),
гость — `UNAUTHENTICATED` (`subscription.md` §12 `[ДОПУЩЕНИЕ]`). Ответ `Boolean!` — место под
результат: его форма появится вместе с этапом платности. Состояние плана берётся из уже
существующего `AccountUser.subscription` (T-030), новых полей чтения нет.

### Веб

`web/app/pages/me/subscription.vue` — зоны §5 для первого запуска:

- зона 2 — «Базовый план, без оплаты» и «Платные планы появятся позже.» (текст `[ДОПУЩЕНИЕ]`
  §12), в том числе у аккаунта без выдач; действующая выдача — «{план} до {дата}» и «Выдан
  редакцией, без оплаты»; истёкшая — «План закончился {дата}», «только для чтения» и «Продлить»
  → `/pricing` (checkout на запуске отвечает 404);
- зона 3 `#queue` — очередь периодов с датами, пустая скрыта;
- зона 5 `#payments` — «Платежей нет.» (§4: `me.payments` на первом запуске пуст);
- зона 6 — ссылка «Цены и планы»; страниц оферты платных услуг и политики возвратов нет,
  ссылок на них нет;
- служебная запись — «Служебные учётные записи планы не приобретают.» и ссылка в «Подписки»
  админки (§2, §8.17).

Данные читаются `GetAccountSubscription` через `useAsyncData`: на сервере — до рендера, поэтому
ограниченная сессия получает 302 на `/me/archived`, а «Ошибка данных» — ответ 500 с
`ErrorState`, кодом запроса и повтором; при клиентском переходе загрузка ленивая — скелет
(«Загрузка»). Непризнанная сессия стирается и уходит на `/login?next=/me/subscription`.
`title` «Подписка — Altera», `noindex, nofollow`, `Cache-Control: private, no-store` (§10);
`/me/billing`, `/me/plan` → 301 на `/me/subscription` (`[ДОПУЩЕНИЕ]` §3).

`/me/subscription/checkout` и `/me/subscription/result` страниц не имеют и отвечают 404
(`checkout.md` §3 `[ДОПУЩЕНИЕ]`).

## Критерии

| Критерий | Статус | Доказательство |
|---|---|---|
| AC-1: `/me/subscription/checkout` → 404 (curl) | passed | Локально на собранном `nuxt build` (`node .output/server/index.mjs`, порт 4736): `curl` на `/me/subscription/checkout`, `?plan=pro&interval=year` и `/me/subscription/result?payment=x` — 404; `/me/billing`, `/me/plan` — 301 на `/me/subscription`; `/me/subscription` гостя — 302 на `/login?next=/me/subscription`. В CI `web/tests/e2e/36-account-subscription.spec.ts` проверяет 404 тех же адресов гостю и вошедшему |
| AC-2: строки состояний `subscription.md` для первого запуска воспроизводимы (Playwright) | passed | `web/tests/e2e/36-account-subscription.spec.ts` на живой базе: «Нет доступа» (гость → вход), «Заблокирован» (302 на `/me/archived`), базовый план без оплаты (текст карточки, «Платежей нет», нет ссылок на checkout, `Cache-Control`, `title`, `robots`), действующая выдача с очередью, «Ограничение плана», служебная запись, «Загрузка» (скелет), «Ошибка данных» (код запроса и повтор); плюс платёжные мутации — `UNAUTHENTICATED` гостю и `FORBIDDEN` автору, и 301 старых адресов. CI run 35564210372: браузерный джоб 206 passed / 9 skipped из 215 против 195 / 9 из 204 на baseline (run 35561332480) — все 11 новых сценариев прошли |

Строки «Пусто» и «Не найдено» (`?refund=`) относятся к этапу платности, «Paywall» —
зарезервирована; «провайдер недоступен» на запуске недостижима.

## Как проверено

Локально, Node 24.12.0, pnpm 10.18.3:

| Команда | Ревизия | Результат |
|---|---|---|
| `pnpm format` | `3b4ae0c` (pre-commit) | exit 0 |
| `pnpm lint` | `3b4ae0c` (pre-commit) | exit 0 |
| `pnpm test` | `3b4ae0c` (pre-commit) | exit 0; server 713 passed / 28 skipped, web 512 passed |
| `pnpm --filter server run build:ci` | `02f8c53` | exit 0 |
| `pnpm --filter nuxt-app run typecheck` | `02f8c53` | exit 0 |
| `pnpm --filter nuxt-app run build` | `02f8c53` | exit 0 |
| `pnpm codegen` | `02f8c53` | повторный запуск без дрейфа |
| `curl` по собранному серверу | `02f8c53` | см. AC-1 |
| `pnpm --filter nuxt-app run test:e2e` | — | локально не запускался |

`3b4ae0c` поверх `02f8c53` меняет только `web/app/utils/accountSubscription.ts` и тест страницы;
сборка и типизация веба на `3b4ae0c` прошли в CI. Playwright локально не запускался: демон
Docker не отвечает, Postgres на машине нет. Браузерные результаты — из CI:
<https://github.com/Egoka/Altera/actions/runs/35564210372>, все проверки зелёные.

Предварительное ревью диффа отдельным агентом (не native-ревью) на `02f8c53` нашло дефект:
API отдаёт `me` ограниченной сессии без плана и `FORBIDDEN` поля `subscription` (поле допускает
`null`), поэтому страница отвечала 500 вместо 302 на `/me/archived`; юнит-тест подставлял
`data: null` и дефект скрывал. Исправлено в `3b4ae0c`, тест приведён к реальному ответу API.

## Остаток

- Независимое native-ревью проверенного SHA и запись Done остаются за контроллером.
- Экрана `/me/archived` в репозитории по-прежнему нет (как для T-022, T-025, T-030, T-032).
- Вся платность (F-01) не входит: оплата, платежи и чеки, возвраты, смена цены, промокоды,
  страницы `/legal/paid-services` и `/legal/refunds`; двухколоночная раскладка §9 `[ДОПУЩЕНИЕ]`
  не делалась — на запуске у страницы две-четыре короткие зоны.
- Миграций задача не добавляет, отдельная выкладка не требуется.

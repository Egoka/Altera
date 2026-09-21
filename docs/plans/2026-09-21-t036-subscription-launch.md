# План T-036: подписка `/me/subscription` в режиме первого запуска

- **Задача**: `docs/backlog/tasks/T-036-subscription-page-launch-mode.md`
  (file SHA `ac8c9563012432f56903dcc812430678fec3a780`)
- **Native issue**: ALTE-110 (`01a0c1f0-b80b-75db-8647-14c48f9906fe`)
- **Baseline `origin/app`**: `20002d3aa074de2d8c8cfa5f25b283f607be606f`
- **Ветка**: `feat/t036-subscription-launch`, отдельное рабочее дерево `.worktrees/t036-subscription`

## Источники

`docs/spec/30-account/reader/subscription.md` (§2–§12), `docs/spec/30-account/reader/checkout.md`
(§3), журнал §8.17, §8.22, §24.1. Зависимость T-030 (сводка `/me`, план из выдач) слита в `app`.

## Шаги

1. API: платёжные мутации страниц подписки и оплаты (`startCheckout`, `cancelSubscription`,
   `resumeSubscription`, `requestRefund`, `confirmPriceChange`) до включения платности отвечают
   `FORBIDDEN` (`subscription.md` §4, §12 `[ДОПУЩЕНИЕ]`); гость получает `UNAUTHENTICATED`.
   Состояние плана берётся из уже существующего `AccountUser.subscription` (T-030).
2. Веб: страница `/me/subscription` — зона 2 (базовый план без оплаты и «платные планы появятся
   позже», действующая выдача, истёкший план), очередь периодов `#queue`, «платежей нет»
   `#payments`, справка; служебная запись видит пояснение §8.17 и ссылку в «Подписки» админки.
   Редиректы: гость — вход, ограниченная сессия — `/me/archived`; `/me/billing`, `/me/plan` —
   301 `[ДОПУЩЕНИЕ]`; `title`, `noindex, nofollow`, `Cache-Control: private, no-store` (§10).
3. `/me/subscription/checkout` и `/me/subscription/result` страниц не имеют и отвечают 404
   (`checkout.md` §3 `[ДОПУЩЕНИЕ]`).
4. Проверки: unit (сервер и веб), Playwright на строки §8 и 404 маршрутов оплаты; format, lint,
   test, build, typecheck, codegen; CI.

## Не входит

Вся платность (F-01): оплата, очередь оплаченных периодов, платежи, чеки, возвраты, смена цены,
промокоды. Страниц `/legal/paid-services` и `/legal/refunds` нет, ссылки на них не ставятся.
Двухколоночная раскладка §9 `[ДОПУЩЕНИЕ]` и полноэкранный диалог возврата относятся к этапу
платности.

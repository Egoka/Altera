# T-027 — Модуль видимости, `ARCHIVED` и страница 410

## Контекст

- Issue: ALTE-64 (`01a0afa1-5bf1-7c0d-ab67-76f015609f43`).
- Источник: `docs/backlog/tasks/T-027-visibility-module-410-email.md`, blob
  `4702ade703df50d5897fd931b74fabe30dc81c6d`.
- Baseline `origin/app`: `2979101be6c630d53d6796594253f1765913d0d5`.
- Проверенная кодовая ревизия: `6c21bca8618ca030d572cfdd957b447ccc32bb31`.

## Результат

- Добавлен единый серверный модуль `server/src/visibility/article.ts`: он строит обязательное
  условие `status = published` для публичных выборок и классифицирует одиночный материал как
  `visible`, `not_found` или `archived`.
- Публичные запросы статей, авторов, рубрик и тегов переведены на общий конструктор условия.
- `article(slug)` больше не возвращает гостю черновик: никогда не публиковавшийся материал даёт
  `NOT_FOUND`, архивированный или ранее опубликованный и снятый — `ARCHIVED`.
- Nuxt-маршрут материала разбирает GraphQL envelope на SSR, отдаёт HTTP 410 и нейтральную
  локализованную страницу для `ARCHIVED`, а также `noindex, nofollow`.
- Публичный GraphQL-тип `User` остаётся без `email`; приватный `AccountUser.email` доступен через
  `me` и защищённые операции. Контрактный тест SDL активен и зелёный.

## Как проверено

- TDD RED: `pnpm --filter server exec vitest run tests/article-visibility.test.ts` — 2 ожидаемых
  падения: черновик и архив до исправления возвращались как обычная статья.
- TDD RED: `pnpm --filter nuxt-app exec vitest run tests/article-gone-page.test.ts` — страница до
  исправления не рендерила 410.
- `pnpm format` — exit 0.
- `pnpm lint` — exit 0.
- `pnpm test` — exit 0: server 148 passed / 19 skipped; web 137 passed.
- `pnpm --filter server run build:ci` — exit 0; миграции не применялись.
- `pnpm --filter nuxt-app run typecheck` — exit 0.
- `pnpm --filter nuxt-app run build` — exit 0.
- Компонентный тест 410 подтверждает вызов `setResponseStatus(event, 410)`, нейтральный текст и
  отсутствие утечки серверного сообщения ошибки.

## Ограничения проверки

- Локальная среда использовала Node `24.3.0`, тогда как репозиторий фиксирует `24.12.0`; все
  команды явно сообщили предупреждение engines. CI должен повторить проверки на закреплённой версии.
- `curl` против полного server + Nuxt не запускался: для него нужен разрешённый изолированный
  PostgreSQL/Redis и тестовые записи. HTTP 410 проверен на SSR-границе компонентным тестом; live
  проверка остаётся частью deploy probe контроллера.

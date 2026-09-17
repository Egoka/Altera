# T-027 — Модуль видимости, `ARCHIVED` и страница 410

## Контекст

- Issue: ALTE-64 (`01a0afa1-5bf1-7c0d-ab67-76f015609f43`).
- Источник: `docs/backlog/tasks/T-027-visibility-module-410-email.md`, blob
  `4702ade703df50d5897fd931b74fabe30dc81c6d`.
- Baseline `origin/app`: `2979101be6c630d53d6796594253f1765913d0d5`.
- Проверенная кодовая ревизия: `1c4e42310e4bd783c86102000e90cc0f51cb48fd`.

## Результат

- Добавлен единый серверный модуль `server/src/visibility/article.ts`: он строит обязательное
  условие `status = published` для публичных выборок и классифицирует одиночный материал как
  `visible`, `not_found` или `archived`.
- Публичные запросы статей, авторов, рубрик и тегов переведены на общий конструктор условия.
- `article(slug)` больше не возвращает гостю черновик: никогда не публиковавшийся материал даёт
  `NOT_FOUND`, архивированный или ранее опубликованный и снятый — `ARCHIVED`.
- При первой публикации сохраняется `firstPublishedAt`; архивированный черновик без истории
  публикации остаётся неразличимым с отсутствующим материалом и даёт `NOT_FOUND`.
- Публичные выборки автора используют явную проекцию без `email`, роли, плана и состояния
  аккаунта до помещения результата в общий кеш.
- Добавлен безопасный запрос `gone(locale, sectionSlug, slug)`: он отдаёт только заголовок,
  автора, рубрику и даты, но никогда тело статьи, теги или причину снятия.
- Nuxt-маршрут материала разбирает GraphQL envelope на SSR, отдаёт HTTP 410 и нейтральную
  локализованную страницу с разрешёнными метаданными для `ARCHIVED`, а также `noindex, nofollow`.
- Публичный GraphQL-тип `User` остаётся без `email`; приватный `AccountUser.email` доступен через
  `me` и защищённые операции. Контрактный тест SDL активен и зелёный.

## Как проверено

- TDD RED: `pnpm --filter server exec vitest run tests/article-visibility.test.ts` — 2 ожидаемых
  падения: черновик и архив до исправления возвращались как обычная статья.
- TDD RED: `pnpm --filter nuxt-app exec vitest run tests/article-gone-page.test.ts` — страница до
  исправления не рендерила 410.
- `pnpm format` — exit 0.
- `pnpm lint` — exit 0.
- `pnpm test` — exit 0: server 152 passed / 19 skipped; web 137 passed.
- `pnpm --filter server run build:ci` — exit 0; миграции не применялись.
- `pnpm --filter nuxt-app run typecheck` — exit 0.
- `pnpm --filter nuxt-app run build` — exit 0.
- Компонентный тест 410 подтверждает вызов `setResponseStatus(event, 410)`, разрешённые метаданные,
  нейтральный текст и отсутствие утечки серверного сообщения ошибки.
- HTTP-probe собранного Nitro с локальным mock GraphQL upstream:
  `curl --dump-header - http://127.0.0.1:3100/culture/withdrawn-article --output /dev/null` —
  `HTTP/1.1 410 Gone`, `content-type: text/html;charset=utf-8`.

## Ограничения проверки

- Локальная среда использовала Node `24.3.0`, тогда как репозиторий фиксирует `24.12.0`; все
  команды явно сообщили предупреждение engines. CI должен повторить проверки на закреплённой версии.
- HTTP-probe проверяет собранный Nuxt/Nitro и BFF с детерминированным mock GraphQL upstream; полная
  интеграция с PostgreSQL/Redis остаётся задачей deploy probe контроллера.

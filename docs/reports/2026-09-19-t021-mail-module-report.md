# T-021: модуль почты с транспортами и письмо входа — отчёт

- **Задача**: T-021 / ALTE-55; план — `docs/plans/2026-09-19-t021-mail-module.md`
- **Источник**: `docs/backlog/tasks/T-021-mail-module-transports.md` @ `bb67f06498463bc3375e7ddff8bea4ad35facad3`
- **Базовый коммит**: `1ef2ac5185acaef10073f648272683202508e948`
- **Ветка**: `server/t021-mail-module`; проверенный SHA — head PR (указан в receipt задачи)

## Что сделано

- `server/src/mail/`: интерфейс `MailTransport`; транспорты `smtp` (nodemailer 10), `console`,
  `fake`, `unconfigured`; `createMailConfigFromEnv`; `createMailService`.
- Сервис создаёт `MailMessage` вместе с событием `queued` одной вложенной записью, затем вызывает
  транспорт и записывает `sent` (с `messageId`, `sentAt`, событием `providerEventId`) или `failed`
  (с `deliveryErrorClass` и событием `errorClass`). Логи `mail.queued` / `mail.sent` / `mail.failed`
  содержат `mailId`, `template`, `status`, `provider`, `messageId`/`errorClass` и `requestId`, без
  адреса, темы и содержимого. Класс ошибки берётся из кода ошибки (`ECONNREFUSED`) или имени класса,
  сообщение транспорта не сохраняется.
- Ошибка транспорта возвращается как `PROVIDER_UNAVAILABLE` с `provider: "mail"` и `requestId`.
- `requestMagicLink` строит ссылку из `MAGIC_LINK_BASE_URL` (по умолчанию из `ENV_SETUP.md`) и
  отправляет письмо шаблона `magic_link` на языке запроса. В `sanitizedBody` ссылка заменена
  пометкой `[секрет не показывается]` / `[secret not shown]` `[ДОПУЩЕНИЕ]`.
- Конфигурация: вне production без `MAIL_TRANSPORT` — `console`; в production без значения —
  `unconfigured` (каждая отправка `failed` → `PROVIDER_UNAVAILABLE: mail`), `fake` запрещён,
  для `smtp` обязателен `MAIL_FROM`. Сервер не падает на старте из-за отсутствия почты.
- `GraphQLContext` получил `mail`; сервис создаётся в `server.ts`.
- CI: шаг `mail-history-database.test.ts` в `server-smoke`; сервис Mailpit в `web-smoke`.
  Playwright API получает `MAIL_TRANSPORT=smtp` на Mailpit `127.0.0.1:21025`.
- Документация env: `server/env.example`, `server/ENV_SETUP.md`.

## Критерии

| Критерий | Результат | Проверка |
|---|---|---|
| 1. Письмо входа появляется в истории писем и в локальном приёмнике | passed локально | `web/tests/e2e/21-magic-link-mail.spec.ts`: мутация через BFF → письмо в Mailpit API (тема, ссылка с 64-hex токеном) → `MailMessage` `sent`, `provider: smtp`, `messageId` совпадает с Mailpit, события `queued`+`sent`, `sanitizedBody` без токена |
| 2. При недоступном транспорте `mail.failed` + `PROVIDER_UNAVAILABLE: mail` | passed локально | `tests/mail-service.test.ts`, `tests/magic-link-mail.test.ts` (fake с ошибкой); `tests/mail-history-database.test.ts` — то же на PostgreSQL 17 |

## Как проверено

Локально, Node 24.12.0, pnpm 10.18.3, чистая `pnpm install --frozen-lockfile`. Изолированные
одноразовые контейнеры: PostgreSQL 17 (`127.0.0.1:25433`, миграции `prisma migrate deploy` только
в эту базу), Mailpit v1.30.6 (`21025`/`28025`), Redis 7 (`26380`).

| Команда | Exit | Итог |
|---|---|---|
| RED: `vitest run` трёх новых тестов до реализации | 1 | модули `src/mail/*` не найдены |
| `pnpm format` | 0 | — |
| `pnpm lint` | 0 | — |
| `pnpm test` | 0 | server 170 passed, 22 skipped (DB-тесты без URL); web 155 passed |
| `T021_TEST_DATABASE_URL=… vitest run tests/mail-history-database.test.ts` | 0 | 2 passed |
| `pnpm --filter server run build:ci` | 0 | — |
| `pnpm run smoke` (server) | 0 | HTTP readiness подтвердил зависимости и revision |
| `pnpm --filter nuxt-app run typecheck` | 0 | — |
| `pnpm codegen --check` | 0 | — |
| `playwright test` (весь набор) | 0 | 24 passed, 9 skipped (skip уже были в baseline: сценарии будущих задач) |

Замечание: после `pnpm add` локальный hoisting `node_modules/.pnpm/node_modules/vite` указывал на
другой экземпляр vite, и web typecheck давал `TS2322` в `nuxt.config.ts`. Lockfile меняет только
`nodemailer` и `@types/nodemailer`; после чистой frozen-установки typecheck проходит (как и на baseline).

## Остаток

- Реальный провайдер и домен отправителя — Q-01. До этого production-вход невозможен без явной
  настройки `MAIL_TRANSPORT`.
- `adminMails` / раздел «Письма» — T-080. Тексты и шаблоны писем — F-05.
- Пометка вместо секрета в копии письма — `[ДОПУЩЕНИЕ]` по `docs/spec/40-admin/mail.md` §3.

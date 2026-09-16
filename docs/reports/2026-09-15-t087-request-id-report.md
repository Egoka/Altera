# Отчёт T-087 — сквозной requestId и http.request

- **План:** `docs/plans/2026-09-15-t087-request-id.md`
- **Базовый коммит:** `df5963e`
- **Ветка:** `server/t087-request-id`
- **Задача:** T-087 / ALTE-32

## Результат

- Nuxt middleware создаёт новый UUID на каждом входящем запросе, сохраняет его в event context
  и возвращает заголовком `x-request-id`; внешний клиентский ID перезаписывается.
- BFF подписывает ID через HMAC-SHA-256. API принимает forwarded ID только с корректной
  подписью и UUID v4; прямой либо некорректно подписанный заголовок заменяется новым ID.
- Yoga request instrumentation хранит ID в `AsyncLocalStorage`, поэтому GraphQL context,
  error masker, response header и структурированные логи используют одну корреляцию даже при
  перекрывающихся запросах.
- `http.request` содержит обязательные `route`, `status`, `durationMs`, `userId`, `role` и
  допускает только `requestId`, не `jobId`.
- Публичные extensions сохраняют `requestId` у `INTERNAL_ERROR` и `PROVIDER_UNAVAILABLE`, но
  удаляют его у `NOT_FOUND` и остальных обычных ошибок. Nuxt 4xx также не раскрывает ID, любой
  неожиданный route-level 500 возвращает его в `data`.
- Контракт job-логов допускает `originRequestId` только вместе с `jobId`. Фактической очереди
  и Prisma-модели задания в текущей ревизии нет, поэтому несуществующее хранилище не добавлялось.

## Соответствие критериям

1. **AC-1 — выполнен:** техническая ошибка содержит `requestId`; `NOT_FOUND` не содержит.
   Проверено `server/tests/graphql-error-boundary.test.ts`, `server/tests/request-tracing.test.ts`
   и route mapper в `web/tests/graphql-proxy.test.ts`.
2. **AC-2 — выполнен:** запись `http.request` содержит снимок роли и внутренний `userId`.
   Проверено реальным экземпляром GraphQL Yoga в `server/tests/request-tracing.test.ts` и
   строгим контрактом `server/tests/logger.test.ts`.

## Как проверено

- `pnpm format` — exit 0; оба пакета: `All matched files use Prettier code style!`.
- `pnpm lint` — exit 0, ошибок и предупреждений ESLint нет.
- `pnpm test` — exit 0:
  - server: 12 файлов, 78 passed, 1 todo;
  - web: 11 файлов, 76 passed.
- `pnpm --filter server run build:ci` — exit 0; Prisma generate, TypeScript compile и копирование
  GraphQL-файлов завершены.
- `pnpm --filter nuxt-app run typecheck` — exit 0; Nuxt prepare и `vue-tsc -b --noEmit` завершены.
- `cd web && pnpm exec playwright test tests/e2e/graphql-bff.spec.ts` — exit 0, 3 passed:
  same-origin BFF, безопасный 400 и CORS. E2E также проверяет замену внешнего валидного UUID.
- Независимый code review после двух циклов исправлений: Critical/Important замечаний нет.

Среда сообщала предупреждение: репозиторий требует Node `24.12.0`, локально использован Node
`24.3.0`. Проверки завершились успешно; предупреждение не скрывалось.

## Безопасность и выпуск

- Добавлен env-контракт: значение `REQUEST_ID_FORWARD_SECRET` API должно совпадать со значением
  `NUXT_REQUEST_ID_FORWARD_SECRET` Nuxt. Секрет не коммитится; `server/env.example` содержит
  только placeholder.
- API не стартует без `REQUEST_ID_FORWARD_SECRET`; BFF возвращает безопасный технический 500
  без настроенного Nuxt secret. Release engineer должен установить совпадающие значения до
  smoke/deploy.
- Миграций схемы и изменений GraphQL schema нет.

## Отклонения от плана

После security review внутренний forwarded ID защищён отдельной HMAC-подписью, а Playwright
startup дополнен тестовыми секретами. Это усиливает запланированную границу недоверенного
заголовка и не расширяет продуктовый scope.

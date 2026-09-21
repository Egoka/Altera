# План T-032: смена почты по коду без завершения сессий

- **Задача**: `docs/backlog/tasks/T-032-email-change-by-code.md`
  (file SHA `8703c4476fd6c353f59ba75579e71c18999efe18`)
- **Native issue**: ALTE-101 (`01a0c0a4-0e08-7ec7-a88b-339ee1d32619`)
- **Эпик**: E-06 «Кабинет читателя»
- **Baseline `origin/app`**: `7e09cf964ea802eff339119ba46a7ee696a4e1d9`
- **Ветка**: `feat/t032-email-change`
- **Источники**: журнал §25.8, `docs/spec/30-account/reader/email-change.md`,
  `docs/spec/10-flows/email-change-and-recovery.md`, `docs/spec/50-access/rate-limits.md` §2 п. 3, 8,
  реестры `access-matrix.md` #49, `events-and-logs.md` #17, #51, ADR-0022, ADR-0024, ADR-0032

## Что уже есть и чего нет

Подготовка под задачу лежит в репозитории с T-023 и T-024, но точек применения у неё нет:

- `EmailChangeRequest` в `server/prisma/schema.prisma` (таблица `email_change_requests`,
  уникальный `userId`, `codeHash VARCHAR(64)` с CHECK на hex-SHA256) — миграция
  `20260915090200_sessions_hashed_auth_tokens`. Поля числа попыток в модели нет.
- `hashEmailChangeCode(code, secret)` в `server/src/auth/token-hash.ts` — вызывается только
  из `server/tests/auth-token-hash.test.ts`.
- Корзина лимита `account.email_change.user` (1 запрос в сутки) в
  `server/src/rate-limits/policy.ts` — `rateLimiter.enforce` её нигде не вызывает.
- Audit-код `user.email.change` в `server/src/audit/registry.ts` (зона `ADMIN_ONLY`) — записи
  этим кодом не создаются.

Нет ни резолверов, ни страницы `/me/email`, ни писем смены адреса. Сценарий Playwright
`web/tests/e2e/13-email-change-recovery.spec.ts` целиком помечен `test.skip` и ждёт T-021,
T-032 и T-073.

## Что делаю

### Сервер

1. **Миграция** `20260921120000_email_change_attempts`: `email_change_requests.attempts INT
   NOT NULL DEFAULT 0` и то же поле в Prisma-модели. Счётчик нужен, чтобы §4 спецификации мог
   отдать `attemptsLeft`, а исчерпание попыток закрывало запрос.
2. **`server/src/auth/email-change.ts`** — доменный модуль: генерация шестизначного кода,
   маскирование адреса, чтение состояния, запрос, подтверждение и отмена. Срок кода — общий
   параметр токенов входа `MAGIC_LINK_EXPIRY_MINUTES` (§4: «срок — общий параметр токенов
   входа»). Предел попыток кода берётся из общего числа попыток подтверждения ссылки
   (`rate-limits.md` §2 п. 3 — 10) и помечается `[ДОПУЩЕНИЕ]`: отдельного числа спецификация
   не задаёт, а задача прямо запрещает выдумывать своё.
3. **GraphQL-домен `server/src/graphql/email-change/`** парой `schema.graphql` + `resolver.ts`:
   поле `AccountUser.emailChange` (`currentEmailMasked`, `pending { newEmailMasked, expiresAt,
   attemptsLeft }`) и мутации `requestEmailChange(newEmail)`, `confirmEmailChange(code)`,
   `cancelEmailChange`. Коды отказов — по §4 и разделу 5 flow #13.
4. **Письма** в `server/src/mail/messages.ts`: код на новый адрес (`email_change_code`, копия
   истории без кода) и уведомление на прежний адрес (`email_change_notice`). Тексты — `[ДОПУЩЕНИЕ]`
   по образцу письма входа: состав писем отложен до прохода почты (§25.13, F-05).
5. **Лимит и аудит**: `account.email_change.user` применяется в `requestEmailChange` после
   проверки прав (`permission-checks.md` п. 3); успешная смена пишет `user.email.change`
   с `via: "self"`. Новых кодов логов не добавляется — реестр `LOG_EVENT_CODES` биективен.

### Веб

6. **Страница `web/app/pages/me/email.vue`** по §5 и §8: текущий адрес, форма нового адреса,
   ввод кода в том же окне, повтор, отмена, ссылка на `/contact`.
7. **Компоненты** `web/app/components/me/MaskedValue.vue`, `CodeInput.vue`,
   `EmailChangeForm.vue` — состав §6.
8. **Операции** `web/app/graphql/operations/me/email-change.graphql` и перегенерация
   `pnpm codegen`; словари `account.email.*` в `web/i18n/locales/{ru,en}.json`.

### Границы

- Восстановление доступа (шаги Р1–Р3 flow #13) не входит: `/contact` — T-073/T-059,
  `adminChangeEmail` — заход 7 `40-admin/users.md`. Ссылка зоны 5 ведёт на маршрут `/contact`
  из реестра, страницы за ним пока нет.
- Тексты писем остаются `[ДОПУЩЕНИЕ]` до прохода почты (§25.13).
- Сценарий `13-email-change-recovery.spec.ts` остаётся пропущенным: его шаги Р1–Р3 вне задачи.

## Как проверяю

- Vitest server: резолверы смены адреса на двойнике Prisma — все ветки §4 и раздела 4 flow #13,
  включая сохранность сессий; контракт схемы и словарь писем.
- Vitest web: состояния страницы и компонентов, словари локалей, валидность GraphQL-операций.
- Playwright `web/tests/e2e/32-email-change.spec.ts`: строки состояний `email-change.md` §8
  (AC-2) и прямая проверка AC-1 — после смены адреса сессии остаются активными.
- `pnpm format`, `pnpm lint`, `pnpm test`, `pnpm --filter server run build:ci`,
  `pnpm --filter nuxt-app run build`, `pnpm --filter nuxt-app run typecheck`.

# План реализации T-086: словарь ошибок и структурированный логгер

- **Дата**: 2026-09-15
- **Ветка**: `server/t086-error-dictionary`
- **Задача**: T-086 (`docs/backlog/tasks/T-086-error-dictionary-logger.md`)
- **Authorization**: native issue `01a0a297-e719-78ad-85d8-20a08cc4878c`, делегирование архитектурной стадии в комментарии `01a0a2cb-94f1-76d1-951d-585e2ec0c4bd`
- **Базовый коммит**: `5271880f5ba228f315573219f9106f622ec98653`
- **Исходное дерево**: clean
- **Отчёт**: `docs/reports/2026-09-15-t086-error-dictionary-logger-report.md` (создаётся разработчиком после реализации)
- **Статус**: утверждён

> **Для исполнителя**: выполнять задачи последовательно и через TDD. Перед исполнением использовать
> `superpowers:executing-plans`; отдельные задачи не параллелить, потому что они меняют общий контракт
> ошибок и один серверный boundary.

## Цель

Сделать утверждённые коды #1–11 и #89 единственным публичным контрактом ошибок GraphQL API,
маскировать неизвестные исключения в `INTERNAL_ERROR` без стека на клиенте и писать серверные
события как безопасный структурированный JSON без открытых e-mail, IP, токенов и ссылок входа.

## Источники и глобальные ограничения

- Журнал решений: `docs/decisions/role-review-working-log-2026-09-08.md` §28.2, §28.4, §29.3.
- Спецификации: `docs/spec/80-observability/error-dictionary.md`,
  `docs/spec/80-observability/logging-policy.md`,
  `docs/spec/00-registries/events-and-logs.md`.
- Решение: `docs/decisions/ADR-0032-api-errors-and-logging.md`.
- Установленный стек: Node 24.12.0, TypeScript 5.8, GraphQL 16.11, GraphQL Yoga 5.15.1,
  Vitest 5.0.
- Сообщения GraphQL — английские и фиксированные; пользовательский перевод остаётся на фронте.
- `requestId` показывается в GraphQL extensions; UI выводит его только для технического сбоя по
  §28.4. T-086 не меняет `web/`.
- Реестр событий заморожен. Нельзя добавлять коды ошибок или логов «по месту».
- Не логировать bodies GraphQL, аргументы резолверов, секреты, e-mail, имена, открытые IP, токены,
  magic links, письма и тексты статей.
- Аудит не является логом. Существующий `logAdminOperation` не переносить в новый логгер и не
  придумывать ему event code.
- `[ДОПУЩЕНИЕ]` Для JSON-логгера используется `pino`, прямо предложенный ADR-0032 и политикой.
  Это технический выбор: API приложения зависит от собственного интерфейса `AppLogger`, поэтому
  замену библиотеки можно сделать внутри одного модуля.
- Для хэшей ПД использовать HMAC-SHA-256 с обязательным `LOG_HASH_SECRET`; фиксированная соль,
  секрет из репозитория или бессолевой SHA-256 запрещены. Секрет не выводить в команды/evidence.
- В T-086 входит локальная генерация `requestId`. Приём и передача `x-request-id`, Nuxt propagation,
  spans и сквозная трассировка остаются T-087.
- Доставка логов, внешний error collector, ретенция и админский журнал ошибок остаются T-089.

## Текущее состояние

- `server/src/server.ts:12` создаёт Yoga без единой политики masking/logging.
- `server/src/prisma.ts:14-43` содержит `GraphQLContext`, но не `requestId` и не логгер; ошибка JWT
  пишется через `console.error`.
- `server/src/exceptions/permissions.ts:9-32` кодирует `UNAUTHENTICATED`, но `FORBIDDEN` бросается
  без `extensions.code`.
- В GraphQL-резолверах есть обычные `Error`, `GraphQLError` без кода, а также несуществующие в
  словаре `BAD_REQUEST` и `FOREIGN_KEY_ERROR`.
- В `server/src` есть открытый magic link с e-mail и токеном, cache debug и псевдо-аудит через
  `console.*`. Реестр не содержит event codes для cache debug или старта сервера.
- `eslint.config.mjs` пока разрешает `console.info`, `console.warn`, `console.error` в server source.
- Тесты используют Vitest; HTTP/Yoga integration-теста error boundary пока нет.

## Архитектурное решение

### Рассмотренные варианты

1. **Рекомендуемый: domain dictionary + factory + Yoga boundary + typed logger.** Ожидаемые ошибки
   создаются через один factory, а boundary повторно проверяет code/fields и реконструирует безопасный
   ответ. Неизвестное исключение логируется и превращается в `INTERNAL_ERROR`. Это закрывает оба AC
   и не доверяет произвольным `GraphQLError`.
2. Только заменить `throw new Error` в резолверах. Проще, но любой новый resolver или ошибка Prisma
   снова утечёт за пределы словаря; AC-1 защищён только в известных местах. Вариант отклонён.
3. Оставить стандартный Yoga masker и добавить logger callback. Стандартный masker не гарантирует
   код `INTERNAL_ERROR`, `requestId` и фильтрацию произвольных extensions у явно созданных
   `GraphQLError`. Вариант отклонён.

### Поток ошибки

```text
resolver/helper
  ├─ ожидаемое состояние → createApiError(code, safe fields, requestId)
  └─ неизвестное исключение / неверный GraphQLError
                              ↓
                  createErrorMasker (Yoga maskedErrors)
                    ├─ валидная ApiError → новый GraphQLError только с разрешёнными полями
                    └─ всё остальное → safe error.unhandled JSON log
                                      + INTERNAL_ERROR { requestId }
```

Boundary не возвращает исходный объект ошибки. Даже для известного кода он создаёт новый
`GraphQLError` из фиксированного сообщения и allowlist полей, чтобы произвольные extensions,
stack/cause и ПД не попали клиенту.

### Схема словаря

`ERROR_DEFINITIONS` — `as const`, а `ErrorCode = keyof typeof ERROR_DEFINITIONS`. Для каждого кода
хранятся фиксированное английское сообщение и обязательные extension-поля:

|   № | Код                    | Разрешённые обязательные поля кроме `code`               |
| --: | ---------------------- | -------------------------------------------------------- |
|   1 | `UNAUTHENTICATED`      | `requestId`                                              |
|   2 | `FORBIDDEN`            | `requestId`, `action`                                    |
|   3 | `NOT_FOUND`            | `requestId`, `entity`                                    |
|   4 | `VALIDATION_ERROR`     | `requestId`, `field`, `rule`                             |
|   5 | `CONFLICT`             | `requestId`, `entity`, `expected`, `actual`              |
|   6 | `RATE_LIMITED`         | `requestId`, `retryAfter`                                |
|   7 | `CONTENT_INVALID`      | `requestId`, `path`, `node`                              |
|   8 | `DUPLICATE`            | `requestId`, `entity`, `field`                           |
|   9 | `INTERNAL_ERROR`       | `requestId`                                              |
|  10 | `PLAN_LIMIT`           | `requestId`, `requiredTier`, `limit`, `current`          |
|  11 | `PROVIDER_UNAVAILABLE` | `requestId`, `provider` (`psp \| ai \| mail \| storage`) |
|  89 | `ARCHIVED`             | `requestId`, `entity`                                    |

`ARCHIVED` применяется только к бывшим публичным адресам; админское состояние archived не является
ошибкой. `NOT_FOUND` остаётся для никогда не существовавших и скрываемых политикой объектов.

### Контракт логгера

Одна JSON-строка имеет поля `time`, `level`, `service`, `environment`, `event` и ровно один
correlation key: `requestId` или `jobId`. `service` — `api | web | worker`, но T-086 создаёт только
API instance. `event` проверяется runtime against frozen `LOG_EVENT_CODES`; неизвестный event
вызывает ошибку до записи.

Публичный интерфейс:

```ts
export type LogLevel = "debug" | "info" | "warn" | "error"
export type ServiceName = "api" | "web" | "worker"

export type LogCorrelation = { requestId: string; jobId?: never } | { jobId: string; requestId?: never }

export type LogEntry = LogCorrelation & {
  level: LogLevel
  event: LogEventCode
  message: string
  data?: Readonly<Record<string, unknown>>
  error?: unknown
}

export interface AppLogger {
  log(entry: LogEntry): void
}

export interface PiiHasher {
  email(value: string): string
  ip(value: string, day: string): string
}
```

`PiiHasher.email` нормализует `trim().toLowerCase()` и возвращает HMAC-SHA-256. `ip` включает в
HMAC purpose и календарный день, поэтому дневная соль меняется. В лог передаются только `emailHash`
и `ipHash`; ключи `email`, `ip`, `token`, `authorization`, `cookie`, `password`, `magicLink`,
`body`, `content`, `text`, `name` удаляются/редактируются рекурсивно. Любые string values, включая
`message`, `Error.message` и stack, дополнительно очищаются по шаблонам e-mail, Bearer/JWT и
magic-link token. Sanitization выполняется до вызова pino, поэтому destination никогда не получает
сырую запись. Hash helper — явный: логгер не превращает случайно переданный e-mail в устойчивый ID,
а редактирует его.

Уровни T-086: `error.unhandled` — `error`, `PROVIDER_UNAVAILABLE` — `warn`; обычные ожидаемые
GraphQL-коды не получают отдельной строки и позже входят в `http.request`. Не создавать отдельные
логи для каждого validation/not-found ответа.

### Интеграция с GraphQL Yoga 5

В `createYoga` задаётся `maskedErrors: { maskError: createErrorMasker({ logger }) }`. Это штатная
точка Yoga v5 для custom masking. `createErrorMasker`:

1. принимает `GraphQLError`, проверяет `extensions.code` и все обязательные поля через словарь;
2. для валидной ошибки возвращает новый safe `GraphQLError`;
3. для неизвестной/неполной ошибки создаёт fallback `requestId`, пишет один `error.unhandled`
   с исходным `originalError ?? error` и возвращает `INTERNAL_ERROR`;
4. никогда не добавляет stack, cause, исходное message или неизвестные extensions в ответ.

`GraphQLContext` получает `requestId`, `logger` и `piiHasher`; `createContext` генерирует локальный
UUID. Ожидаемые ошибки и `auth.link.requested` используют этот ID. Fallback ID masker-а совпадает
между клиентским `INTERNAL_ERROR` и записью `error.unhandled`; привязка fallback к входному header
явно отложена до T-087.

Yoga internal logging отключается (`logging: false`): его сообщения не имеют registry event и
correlation ID. Приложение логирует только через `AppLogger`.

## Карта файлов

### Создать

- `server/src/errors/dictionary.ts` — definitions, `ErrorCode`, provider union, code-specific fields,
  runtime validation и allowlist extensions.
- `server/src/errors/graphql-error.ts` — `createApiError`, `isApiError`, `createErrorMasker`.
- `server/src/observability/log-events.ts` — frozen list всех утверждённых `type=log` codes из
  реестра и `LogEventCode`.
- `server/src/observability/privacy.ts` — HMAC hashing и recursive sanitizer.
- `server/src/observability/logger.ts` — `AppLogger`, correlation validation, pino adapter и
  injectable destination.
- `server/tests/error-dictionary.test.ts` — exact dictionary/fields/provider/unknown-code tests.
- `server/tests/logger.test.ts` — JSON contract, registry gate, correlation gate, hashing/redaction.
- `server/tests/graphql-error-boundary.test.ts` — Yoga integration для unknown, known и malformed
  `GraphQLError`.
- `server/tests/error-contract.test.ts` — source contract: no direct resolver `GraphQLError`, no
  unknown code literals, no `console.*` в `server/src` кроме generated.

### Изменить

- `server/package.json`, `pnpm-lock.yaml` — добавить `pino`.
- `server/env.example` — добавить `LOG_HASH_SECRET` как обязательный placeholder без реального секрета.
- `eslint.config.mjs` — `no-console: "error"` для всего `server/src`, без allowlist.
- `server/src/server.ts` — создать logger/hasher, передать их в context, подключить masker, отключить
  Yoga internal logging, убрать startup console.
- `server/src/prisma.ts` — расширить `GraphQLContext`; создать локальный `requestId`; заменить JWT
  console на `error.unhandled` без логирования token/header.
- `server/src/exceptions/permissions.ts` — использовать `createApiError`; сделать `action` явным
  параметром `ensureHasRole`.
- `server/src/utils/admin.ts` — типизировать unknown; заменить Prisma mapping на словарь; убрать
  cache console и `logAdminOperation`.
- `server/src/graphql/auth/resolver.ts` — типизированный context, dictionary errors, удалить открытый
  magic link; писать только `auth.link.requested { emailHash }`.
- `server/src/graphql/article/resolver.ts`, `contentType/resolver.ts`, `user/resolver.ts`,
  `sectionTag/resolver.ts` — заменить direct/bare/unknown errors на factory, передать обязательные
  поля и убрать unregistered cache/pseudo-audit console calls.
- `server/tests/permissions.test.ts`, `server/tests/admin.test.ts`,
  `server/tests/cache-resolvers.test.ts` — обновить сигнатуры/context fixtures и проверять codes/fields.
- `docs/reports/2026-09-15-t086-error-dictionary-logger-report.md` — фактический отчёт разработчика.

`web/` и `packages/` не изменяются. Миграций БД нет.

## Задачи реализации

### Задача 1. Зафиксировать executable dictionary

**Файлы:** создать `server/src/errors/dictionary.ts`,
`server/tests/error-dictionary.test.ts`.

**Производит:**

```ts
export const ERROR_DEFINITIONS: Readonly<Record<ErrorCode, ErrorDefinition>>
export type ErrorCode = keyof typeof ERROR_DEFINITIONS
export type ProviderName = "psp" | "ai" | "mail" | "storage"
export type ApiErrorFields<C extends ErrorCode> = /* mapped type by code */
export function isErrorCode(value: unknown): value is ErrorCode
export function pickValidExtensions(error: GraphQLError): ApiErrorExtensions | null
```

- [ ] Написать failing test, который ожидает ровно 12 кодов в порядке
      `UNAUTHENTICATED` … `PROVIDER_UNAVAILABLE`, `ARCHIVED`, exact required fields из таблицы и provider
      `storage`; `BAD_REQUEST`/`FOREIGN_KEY_ERROR` должны отклоняться.
- [ ] Выполнить `pnpm --dir server test -- error-dictionary.test.ts`; ожидается FAIL из-за
      отсутствующего модуля.
- [ ] Реализовать const definitions и mapped fields без `any`; `pickValidExtensions` должен
      возвращать только `code`, `requestId` и allowlisted поля, отклонять пустые/missing values и
      неизвестный code.
- [ ] Повторить targeted test; ожидается PASS.
- [ ] Commit: `feat(errors): add canonical API error dictionary`.

### Задача 2. Реализовать privacy boundary и logger

**Файлы:** создать `server/src/observability/log-events.ts`, `privacy.ts`, `logger.ts`,
`server/tests/logger.test.ts`; изменить `server/package.json`, `pnpm-lock.yaml`, `server/env.example`.

**Потребляет:** frozen registry `docs/spec/00-registries/events-and-logs.md`.

**Производит:** интерфейсы `AppLogger`, `LogEntry`, `PiiHasher`, функции
`createAppLogger(options)`, `createPiiHasher(secret)`, `sanitizeLogValue(value)`.

- [ ] Добавить test matrix для всех exact non-cancelled `type=log` codes #41–54, #78, #80–82,
      #86, #88; unknown event должен бросать до `destination.write`.
- [ ] Добавить failing contract tests: output — одна JSON line; обязательны ISO `time`, string
      `level`, `service`, `environment`, `event` и ровно один из `requestId`/`jobId`.
- [ ] Добавить AC-2 test: передать `person@example.com` одновременно в message, nested data и
      `Error`; output не содержит e-mail, token/JWT, Authorization и magic-link URL, но содержит
      `[REDACTED]` и безопасный stack.
- [ ] Добавить hashing tests: нормализованные варианты e-mail дают одинаковый `emailHash`, разные
      secrets — разные hashes; `ipHash` меняется при смене day.
- [ ] Запустить `pnpm --dir server test -- logger.test.ts`; ожидается FAIL.
- [ ] Добавить `pino`, реализовать logger поверх injectable `DestinationStream`, ISO timestamp и
      string level; sanitizer применить ко всему entry до pino.
- [ ] Реализовать HMAC через `node:crypto`; отсутствие/пустой `LOG_HASH_SECRET` должно останавливать
      создание hasher без вывода значения секрета.
- [ ] Повторить targeted test; ожидается PASS.
- [ ] Commit: `feat(logging): add privacy-safe structured logger`.

### Задача 3. Создать безопасную GraphQL error boundary

**Файлы:** создать `server/src/errors/graphql-error.ts`,
`server/tests/graphql-error-boundary.test.ts`; изменить `server/src/server.ts`, `server/src/prisma.ts`.

**Потребляет:** `ERROR_DEFINITIONS`, `pickValidExtensions`, `AppLogger`.

**Производит:**

```ts
export function createApiError<C extends ErrorCode>(
  code: C,
  fields: ApiErrorFields<C> & { requestId: string }
): GraphQLError

export function createErrorMasker(options: {
  logger: AppLogger
  requestIdFactory?: () => string
}): (error: GraphQLError, message: string, isDev: boolean) => GraphQLError
```

- [ ] Создать minimal Yoga schema in test с полями `unknown`, `known`, `malformed`; injected
      destination собирает JSON lines.
- [ ] AC-1 failing test: resolver `unknown` бросает `new Error("boom person@example.com")`; GraphQL
      response имеет `extensions.code === "INTERNAL_ERROR"` и non-empty `requestId`, но не содержит
      `boom`, e-mail, stack/cause; ровно один `error.unhandled` log имеет тот же `requestId` и безопасный
      stack.
- [ ] Добавить tests: валидный `NOT_FOUND {entity, requestId}` сохраняется с фиксированным message;
      `GraphQLError` без code, с неизвестным code или missing required field маскируется как internal.
- [ ] Запустить `pnpm --dir server test -- graphql-error-boundary.test.ts`; ожидается FAIL.
- [ ] Реализовать factory/masker. Для unknown log использовать `error.originalError ?? error`, но
      только через sanitizer. Никогда не ветвиться по `NODE_ENV`: stack не отдаётся клиенту и в dev.
- [ ] Расширить `GraphQLContext` полями `requestId`, `logger`, `piiHasher`; `createContext` генерирует
      UUID и не принимает caller-supplied ID в T-086.
- [ ] В `server.ts` создать dependencies один раз, задать `logging: false` и
      `maskedErrors.maskError`; не менять CSRF/CORS/blockFieldSuggestions.
- [ ] Повторить boundary test; ожидается PASS.
- [ ] Commit: `feat(graphql): mask resolver errors at Yoga boundary`.

### Задача 4. Перевести существующие resolver/helpers на контракт

**Файлы:** изменить перечисленные helpers/resolvers/tests и `eslint.config.mjs`; создать
`server/tests/error-contract.test.ts`.

**Потребляет:** `createApiError`, context logger/hasher.

- [ ] Написать failing source-contract test, который сканирует только tracked
      `server/src/**/*.{ts,js}` без `server/src/generated`: запрещены `console.*`; direct import/
      construction `GraphQLError` разрешены только в `server/src/errors/graphql-error.ts`; code literals
      в error factory calls должны проходить `isErrorCode`.
- [ ] Обновить permissions tests: `ensureHasRole(user, role, action, requestId)` возвращает
      `FORBIDDEN` с `action` и `requestId`; unauthenticated содержит `requestId`.
- [ ] Обновить admin tests для mapping: Prisma `P2002` → `DUPLICATE`, `P2025` → `NOT_FOUND`,
      `P2003` → `CONFLICT`; unknown исключение не превращать в доверенный `INTERNAL_ERROR` в helper —
      повторно бросить, чтобы Yoga boundary залогировал исходную причину.
- [ ] Запустить `pnpm --dir server test -- permissions.test.ts admin.test.ts error-contract.test.ts`;
      ожидается FAIL до миграции production files.
- [ ] Перевести `auth/resolver.ts`: удалить формирование/console output magic link; после записи token
      логировать `auth.link.requested` с `requestId` и `emailHash`, без email/token/link. Ожидаемые
      invalid/used/expired состояния кодировать утверждёнными codes и полями.
- [ ] Перевести article/contentType/user/sectionTag resolvers и `utils/admin.ts`: заменить bare
      `Error`, прямые `GraphQLError`, `BAD_REQUEST`, `FOREIGN_KEY_ERROR`; для каждого code передать exact
      required fields. Удалить cache console lines — реестр не содержит cache event.
- [ ] Удалить `logAdminOperation` и все calls. Не заменять его обычным логом: audit persistence не
      входит в T-086.
- [ ] Обновить cache resolver fixtures полями `requestId`, logger/hasher fakes, не ослабляя проверки
      cache behaviour.
- [ ] Установить `no-console: "error"` без allowlist для server source.
- [ ] Повторить targeted tests; ожидается PASS.
- [ ] Выполнить `pnpm --dir server test`; ожидается PASS всех server tests и отсутствие todo,
      относящихся к T-086.
- [ ] Commit: `refactor(graphql): adopt canonical errors and logging`.

### Задача 5. Полный gate и отчёт разработчика

**Файлы:** создать `docs/reports/2026-09-15-t086-error-dictionary-logger-report.md`.

- [ ] Выполнить `pnpm format`; ожидается exit 0.
- [ ] Выполнить `pnpm lint`; ожидается exit 0 и отсутствие `console.*` в `server/src`.
- [ ] Выполнить `pnpm test`; ожидается exit 0; зафиксировать фактическое число tests из вывода.
- [ ] Выполнить `pnpm --dir server run build:ci`; ожидается exit 0; не запускать migrations.
- [ ] Если local env позволяет, выполнить `pnpm --dir server run smoke`; smoke не выдавать за Redis
      check. Если env не позволяет — записать `not_run` и точную причину.
- [ ] Создать отчёт по `docs/reports/README.md`: для AC-1 и AC-2 указать actor/run, стабильный
      `check_id`, полный commit, dirty fingerprint, cwd, command, exit code, число scenarios, значимый
      output, trace_ref и ограничения.
- [ ] Commit: `docs(server): report T-086 verification`.

## Критерии готовности и check IDs

| AC   | Наблюдаемый результат                                                                                                      | Основная проверка                                                           | `check_id`                       |
| ---- | -------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- | -------------------------------- |
| AC-1 | Unknown resolver error → `INTERNAL_ERROR` + `requestId`; response без исходного message/stack; safe log содержит тот же ID | `pnpm --dir server test -- graphql-error-boundary.test.ts`                  | `t086-ac1-yoga-error-mask`       |
| AC-2 | Ни message, nested data, error stack, token, ни magic link не оставляют открытый e-mail в JSON output                      | `pnpm --dir server test -- logger.test.ts`                                  | `t086-ac2-log-pii-redaction`     |
| AC-3 | Dictionary содержит ровно #1–11 + #89 и provider `storage`; неизвестные codes отклоняются                                  | `pnpm --dir server test -- error-dictionary.test.ts error-contract.test.ts` | `t086-error-dictionary-contract` |
| AC-4 | Вся серверная проверка и TypeScript build проходят; `console.*` запрещён                                                   | `pnpm lint && pnpm test && pnpm --dir server run build:ci`                  | `t086-server-gate`               |

Две подряд неуспешные попытки одного `check_id` останавливают соответствующую проверку. В отчёте
сохраняются обе попытки, изменения между ними и причина.

## Security invariants

- Caller не может пометить произвольный error как безопасный одним `extensions.code`: boundary
  проверяет code и полный набор разрешённых полей, затем пересобирает объект.
- Error message не берётся из пользовательского input; factory использует фиксированное сообщение.
- Исходный stack доступен только logger pipeline и санитизируется до destination.
- `requestId`/internal IDs допустимы; email/IP попадают только через purpose-separated HMAC helper.
- `LOG_HASH_SECRET` не попадает в Git, error messages, snapshots, CI output или Multica evidence.
- GraphQL request/response bodies и resolver args не логируются.
- `ARCHIVED` не раскрывает служебный/непубличный объект: его применение ограничено бывшими
  публичными адресами.

## Риски и снятие

- **Yoga может иначе обрабатывать явно созданный `GraphQLError`.** Снимается integration tests на
  реальном `graphql-yoga@5.15.1`, а не unit-вызовом masker. Проверена официальная точка расширения
  `maskedErrors.maskError`: <https://the-guild.dev/graphql/yoga-server/docs/features/error-masking>.
- **Sanitizer можно обойти строкой внутри Error/cause.** Рекурсивно очищаются data, message,
  `Error.message`, stack и cause; AC-2 проверяет все эти пути.
- **Сломать существующие resolver fixtures расширением context.** Обновить fakes минимальными
  зависимостями и выполнить весь server suite.
- **Придумать event для существующего cache/startup/pseudo-audit output.** Такие строки удаляются;
  новый event возможен только отдельным решением и обновлением замороженного реестра.
- **Render не запустится без нового hash secret.** До backend deploy release engineer добавляет
  `LOG_HASH_SECRET` в разрешённое окружение Render, не раскрывая значение, затем проверяет deploy
  того же merge SHA. Без доступа release status — `blocked_access`, не accepted.

## Сознательно не входит

- T-087: propagation `requestId` между Nuxt/API, входные headers, spans и трассировка.
- T-089: внешний collector, доставка/ретенция логов, `/admin/errors` и incident workflow.
- Health endpoint, DB/Redis readiness и provider monitoring.
- Реализация `audit_log`; удаляемый псевдо-аудит не заменяется обычным логом.
- Пользовательские тексты/страницы ошибок в `web/` и общие packages.
- Любые schema migrations.

## Стадии и handoff

- **Архитектура**: вход — baseline `5271880f5ba228f315573219f9106f622ec98653`, issue и источники;
  выход — этот зафиксированный техплан. Проверка стадии — форматирование plan и clean diff после
  commit.
- **Разработка**: следующий владелец реализует задачи 1–5 в этой же ветке/worktree, создаёт парный
  отчёт и передаёт полный source SHA + evidence по AC.
- **Тестирование**: независимый tester исполняет AC-1/AC-2 и полный gate на source SHA; не принимает
  unit-only masker test вместо Yoga integration.
- **Review**: сверяет exact dictionary/fields, отсутствие открытых ПД и unknown code, scope T-086 и
  актуальность evidence.
- **Документация/релиз**: после принятого source result обновляет task metadata. Изменение backend
  требует отдельного CI/merge/Render deploy/API health evidence; DB/Redis checks фиксируются отдельно,
  а отсутствие миграций не доказывает их здоровье.

## Дополнение 2026-09-15: перепланирование AC-1 после остановки

### Причина перепланирования

Проверка `t086-ac1-yoga-error-mask` остановлена после двух неуспешных попыток. В integration test на
Yoga 5.15.1 factory-created `NOT_FOUND` проходит через `locatedError`: внешний `GraphQLError`
содержит исходную ошибку в `originalError`, но текущая номинальная проверка через
`instanceof GraphQLError` не даёт устойчивого распознавания в тестовом runtime. Прямая проверка
`extensions` у внешней или исходной ошибки также не является допустимым исправлением: caller может
сформировать такие же `extensions` у произвольной ошибки.

Установленный GraphQL.js 16.11.0 при добавлении location/path создаёт новый `GraphQLError` и сохраняет
исходный объект в `originalError`. Следовательно, инвариантом должен быть не constructor identity и не
содержимое публичных полей, а object identity ошибки, которую создал наш factory. Локальная проверка
в plain Node с теми же Yoga/GraphQL версиями сохраняет известную ошибку, поэтому она не опровергает
integration failure и не служит AC evidence; расхождение подтверждает, что `instanceof` нельзя делать
частью security boundary.

### Надёжная идентификация known error

В `server/src/errors/graphql-error.ts` вводится закрытый реестр:

```ts
const knownErrors = new WeakMap<object, Readonly<PublicErrorSnapshot>>()
```

`createApiError` сначала валидирует поля по словарю, создаёт новый `GraphQLError`, сохраняет по его
identity замороженный snapshot `{ message, extensions }` и возвращает этот же объект. Реестр, тип
snapshot и операция регистрации не экспортируются. Snapshot содержит новый объект `extensions`, а не
ссылку на публичный mutable объект ошибки. Symbol-brand, `Symbol.for`, `name`, `extensions.code` и
`instanceof` не используются как доказательство происхождения: каждый из этих признаков можно
подделать или потерять на границе модулей, кроме module-private WeakMap membership.

Masker ищет зарегистрированный объект по следующему алгоритму:

```text
queue := [receivedError]
visited := WeakSet()
while queue not empty:
  current := queue.shift()
  if current is not object/function or current is visited: continue
  visited.add(current)
  if knownErrors has current: return stored snapshot
  safely enqueue current.originalError
  safely enqueue current.cause
return unknown
```

Обход breadth-first выбирает ближайшую к Yoga wrapper известную ошибку; при одинаковой глубине
`originalError` имеет приоритет над `cause`. Доступ к обоим полям выполняется в `try/catch`, потому что
неизвестный объект может иметь throwing getter. `WeakSet` разрывает циклы. Искусственный limit глубины
не нужен: число посещений ограничено конечным object graph, достижимым только по двум ссылкам.

Критерий **known error**: в достижимой цепочке есть object identity, зарегистрированный именно текущим
экземпляром `createApiError`, и для него существует сохранённый factory snapshot. Критерий **unknown
error**: traversal завершился без такого membership, даже если любой узел выглядит как `GraphQLError`
и содержит полностью корректные `extensions.code`, `requestId` и обязательные поля. Для known error
ответ пересобирается из сохранённого snapshot. Для unknown error исходная причина проходит только в
privacy-safe logger, а клиент получает новый factory-created `INTERNAL_ERROR`; stack/message/cause
исходной ошибки в response не копируются.

### Точные изменения для восстановления разработки

`server/src/errors/graphql-error.ts`:

- добавить приватные `knownErrors`, immutable `PublicErrorSnapshot` и helper безопасного обхода;
- в `createApiError` после создания ошибки сохранить deep-enough copy: новый frozen объект
  `extensions` из scalar/list fields контракта и фиксированный message словаря;
- заменить `isApiError` на проверку registry traversal без `instanceof`; не экспортировать brand или
  registry;
- в `createErrorMasker` сначала искать snapshot traversal helper-ом и возвращать новый
  `GraphQLError(snapshot.message, { extensions: { ...snapshot.extensions } })`;
- только при отсутствии snapshot создавать `requestId`, логировать `error.unhandled` и возвращать
  `createApiError("INTERNAL_ERROR", { requestId })`. Для log cause допустим исходный received object;
  logger обязан санитизировать его и не сериализовать response extensions.

`server/src/server.ts`:

- импортировать `createErrorMasker` из единственного канонического пути
  `./errors/graphql-error.js`, создать masker один раз рядом с logger и передать
  `maskedErrors: { isDev: false, maskError }` в `createYoga`;
- сохранить `logging: false`: application logger остаётся единственным контролируемым sink;
- не добавлять fallback, доверяющий `extensions`, и не копировать factory/registry в другой модуль.
  Factory и masker должны загружать один module instance; production build не должен импортировать
  их через разные сгенерированные копии или разные entrypoints.

### Regression matrix для следующего разрешённого цикла

В `server/tests/graphql-error-boundary.test.ts` на реальном Yoga добавить/сохранить проверки:

1. неизвестный resolver `Error` → только `INTERNAL_ERROR`, новый `requestId`, без исходных
   message/stack, ровно один sanitized log;
2. factory-created `NOT_FOUND` через Yoga located wrapper сохраняет code/поля и не создаёт
   `error.unhandled`;
3. вручную созданный `GraphQLError` с полностью корректными `extensions` → `INTERNAL_ERROR` и log;
4. известная ошибка за двумя `originalError` wrappers и отдельно за `cause` распознаётся;
5. циклические `originalError`/`cause` не зацикливают masker и остаются unknown;
6. мутация публичных `extensions` после `createApiError` не меняет response: используется сохранённый
   snapshot.

История `t086-ac1-yoga-error-mask` остаётся `2/2 failed` и не обнуляется переименованием check.
Архитектурная стадия не запускает третью попытку AC-1. Оркестратор должен явно открыть ограниченный
recovery cycle разработчику; после реализации тот повторяет тот же semantic check и сохраняет связь с
двумя предыдущими попытками. Задачи 4–5 продолжаются только после подтверждённого AC-1 recovery.

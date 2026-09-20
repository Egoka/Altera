# T-023: отчёт о ротации сессий, выходе и httpOnly-cookie через BFF

- **Дата**: 2026-09-20
- **Задача**: T-023 / Multica ALTE-97 (`01a0be48-795c-7a86-8591-ff6f422dc8ec`)
- **План**: `docs/plans/2026-09-20-t023-session-rotation-logout-cookie.md`
- **Источник задачи**: `docs/backlog/tasks/T-023-session-rotation-logout-cookie.md`
- **Базовый коммит**: `4ea27a63d0fac9ccc9eb38cde522d9b17b58799b` (`origin/app`)
- **Ветка**: `feat/t023-sessions`, проверенный коммит `f79c78af2a2b690f32407816ea27ee08988efa83`
- **PR**: https://github.com/Egoka/Altera/pull/168
- **Статус**: реализация завершена, передаётся на независимое ревью

## Что сделано

- `server/src/auth/session.ts` — выпуск непрозрачного refresh-токена (32 случайных байта,
  в базе только sha256-хэш), срок 30 дней от последней ротации, старт сессии, ротация,
  обнаружение повторного предъявления, отзыв одной и всех сессий. Модуль работает через узкий
  интерфейс Prisma, поэтому логика проверяется без живой базы.
- `verifyMagicLink` создаёт запись `Session` и выдаёт access-JWT с `sid`. Клейм `role` из токена
  убран: роль читается из базы на каждый запрос (ADR-0003 п. 4, ADR-0009 п. 6).
- `createContext` авторизует запрос только через живую запись сессии: одно чтение по `sid`
  вместе с пользователем и его действующими исключениями прав. Отозванная, истёкшая и чужая
  сессия, а также токен без `sid`, дают запрос посетителя (ADR-0009 п. 2).
- `refreshSession` ротирует токен: новый хэш в `tokenHash`, прежний — в `previousTokenHash`,
  срок сдвигается. Предъявление уже ротированного токена отзывает **все** сессии пользователя
  и пишет `session.reuse_detected` и `session.revoked` (ADR-0009 п. 3,
  `session-lifecycle.md` §2.4).
- `logout` закрывает текущую сессию (по `sid` access-токена, иначе по refresh из cookie),
  `logoutAll` — все сессии пользователя, включая текущую (ADR-0009 п. 4).
- `AuthPayload.refreshToken` стал nullable: через BFF браузер всегда получает `null`.
- BFF `POST /api/graphql` разбирает документ мутации и: подставляет refresh из httpOnly-cookie
  вместо значения клиента, снимает выданный refresh из ответа в cookie
  (`httpOnly`, `Secure`, `SameSite=Lax`, срок 30 дней), стирает cookie после `logout`/`logoutAll`
  и после отказа обновления (ADR-0023 п. 2, 5).
- Маршрут проверяет `Origin` и `Sec-Fetch-Site` для мутаций (ADR-0023 п. 4): cookie-аутентификация
  делает мутации уязвимыми к CSRF. Внутренний SSR-вызов без обоих заголовков разрешён.
- Прокси передаёт в API `user-agent` и адрес клиента: оба поля пишутся в запись сессии
  (ADR-0009 п. 1).
- Добавлены операции `RefreshSession`, `Logout`, `LogoutAll`; `web/app/graphql/generated`
  обновлён `pnpm codegen`.
- Refresh перестал быть JWT, поэтому `JWT_REFRESH_SECRET` и `JWT_REFRESH_TOKEN_EXPIRY` больше
  не читаются и убраны из `.github/workflows/pull_request.yml`, `web/playwright.config.ts`,
  `server/env.example`, `server/ENV_SETUP.md` и `docs/development/project-rules.md`.

Миграций задача не добавляет: таблица `Session` пришла с T-012 и уже содержит все нужные поля.

## Как проверено

Среда: Node 24.12.0, pnpm 10.18.3, macOS (darwin 25.5.0). Все команды выполнены в worktree
`/Users/egorbondarenko/WebstormProjects/Altera/.worktrees/t023-sessions` на коммите
`f79c78af2a2b690f32407816ea27ee08988efa83`.

| Команда | Exit | Наблюдаемый результат |
| --- | --- | --- |
| `python3 scripts/autonomy/preflight.py --runtime-id … --run-id …` | 0 | семь проверок passed, `ok: true`, baseline `4ea27a6` — предок HEAD |
| `pnpm install --frozen-lockfile` | 0 | установка в новом worktree |
| `pnpm format` | 0 | `All matched files use Prettier code style!` |
| `pnpm lint` | 0 | пустой вывод ESLint |
| `pnpm test` | 0 | server 284 passed / 24 skipped (52 файла), web 203 passed (27 файлов) |
| `pnpm --filter server run build:ci` | 0 | `prisma generate` + `tsc` + копирование SDL |
| `pnpm --filter nuxt-app run typecheck` | 0 | `nuxt prepare && vue-tsc -b --noEmit` без диагностик |
| `pnpm --filter nuxt-app run build` | 0 | Nitro-сборка, 13.1 MB |

На baseline (`origin/app`, измерено отдельным запуском `pnpm test`) было server 259 passed /
24 skipped и web 180 passed; прирост дают новые файлы
`session-rotation.test.ts` (8), `session-mutations.test.ts` (10), расширенный
`prisma-context.test.ts` (11 вместо 4), `session-cookie.test.ts` (22) и новый случай в
`graphql-proxy.test.ts`.

### AC-1 — повторное предъявление старого refresh отзывает все сессии

- `server/tests/session-rotation.test.ts`: после ротации первой сессии повторное предъявление
  её прежнего токена даёт `reuse_detected`; обе сессии пользователя получают `revokedAt`,
  сессия другого пользователя остаётся активной.
- `server/tests/session-mutations.test.ts`: `refreshSession` отвечает `UNAUTHENTICATED`,
  активных сессий не остаётся, журнал содержит ровно
  `session.refresh → session.reuse_detected → session.revoked`.
- Playwright `web/tests/e2e/23-session-cookie.spec.ts` повторяет сценарий в браузере и
  подтверждает отзыв прямым запросом к базе.

### AC-2 — cookie недоступна из JavaScript

Playwright `23-session-cookie.spec.ts`: после входа `document.cookie` не содержит ни имени
`altera_refresh`, ни значения cookie, а cookie в джаре контекста имеет `httpOnly: true` и
`sameSite: "Lax"`. Ответ мутации отдаёт `refreshToken: null`.

Ограничение: локально сценарий не выполнялся. Playwright поднимает API и Nitro и требует
PostgreSQL и Mailpit из `docker-compose.yml`, а Docker-демон в рабочей среде не поднялся
(`docker info` возвращал ошибку инициализации всё время работы). Браузерные сценарии выполняет
job `web-smoke` в CI на том же коммите; результат приложен к задаче ссылкой на запуск.

### AC-3 — `logoutAll` не оставляет активных сессий

`server/tests/session-mutations.test.ts`: после `logoutAll` у пользователя не остаётся активных
сессий, включая текущую; сессия другого пользователя не затронута. Playwright-сценарий
подтверждает то же двумя параллельными браузерными контекстами и запросом к базе.

### Окончание плана не отзывает сессию (журнал #55)

`session-mutations.test.ts` выполняет `refreshSession` для читателя с истёкшим `planUntil`:
ротация проходит, сессия остаётся активной.

## Решения и ограничения

- **Строгая ротация без окна благодати.** Два параллельных обновления одной сессии дают
  предъявление уже ротированного токена и отзыв всех сессий. Это прямое следствие ADR-0009 п. 3
  («предъявление старого токена означает утечку»); окно повторного использования не вводилось,
  потому что журнал и спецификация его не задают.
- **`logoutAll` закрывает и текущую сессию.** Критерий задачи допускал оба поведения; выбран
  вариант ADR-0009 п. 4 («все сессии пользователя»).
- **IP сессии** берётся из `x-forwarded-for`, который проставляет BFF по адресу соединения
  браузера. Поле информационное, на решения доступа не влияет.
- **Не входит и остаётся открытым**: страница `/me/sessions` и запрос `mySessions` (T-025),
  страницы `/login`, `/auth/verify` и клиентское хранение access-токена с обновлением по 401
  (T-022), ограниченная сессия самостоятельно архивированного аккаунта и отзыв сессий при
  архивировании, лимиты частоты (T-024).
- `docs/vision/00-reality-check.md` и раздел «Что сломано» в `CLAUDE.md` этой задачей не
  правились: срез реальности ведётся отдельной задачей T-111.

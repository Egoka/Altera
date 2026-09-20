# T-023: сессии — ротация refresh, выход, выход везде, обнаружение повторного предъявления, httpOnly-cookie через BFF

- **Дата**: 2026-09-20
- **Ветка**: `feat/t023-sessions`
- **Worktree**: `/Users/egorbondarenko/WebstormProjects/Altera/.worktrees/t023-sessions`
- **Задача**: T-023 / ALTE-97 (`01a0be48-795c-7a86-8591-ff6f422dc8ec`)
- **Источник**: `docs/backlog/tasks/T-023-session-rotation-logout-cookie.md`
- **Базовый коммит**: `4ea27a63d0fac9ccc9eb38cde522d9b17b58799b` (`origin/app`)
- **Отчёт**: `docs/reports/2026-09-20-t023-session-rotation-logout-cookie-report.md`

**Цель:** закрыть дыру реальность-чека §С2.7 — refresh-токен выдаётся, но обновления, отзыва,
выхода и хранения сессии нет. После задачи сессия живёт записью в таблице, refresh ротируется,
предъявление старого токена отзывает все сессии пользователя, есть `logout` и `logoutAll`,
а refresh хранится в httpOnly-cookie, выставляемой BFF-маршрутом Nuxt.

## 1. Контракт и границы

Старшинство источников: журнал решений (#55, §25.9) → `docs/spec/50-access/session-lifecycle.md`
и `docs/spec/00-registries/routes.md` → ADR-0009 и ADR-0023.

Инварианты:

1. `Session` — уже существующая таблица (T-012): `tokenHash`, `previousTokenHash`, `expiresAt`,
   `revokedAt`, `userAgent`, `ip`, `lastUsedAt`. Миграции схемы задача не добавляет.
2. Refresh — непрозрачный случайный токен (32 байта), в базе только sha256-хэш (ADR-0009 п. 1).
   Refresh-JWT из `verifyMagicLink` перестаёт существовать; `JWT_REFRESH_SECRET` больше не нужен.
3. Access-JWT живёт 15 минут и несёт `userId` и `sid`; контекст запроса одним чтением по `sid`
   проверяет `revokedAt IS NULL` и срок (ADR-0009 п. 2) — отзыв действует мгновенно.
4. Ротация: `tokenHash` меняется, старый уходит в `previousTokenHash`, срок — 30 дней от
   ротации (`session-lifecycle.md` §2.5, ADR-0009 п. 1).
5. Предъявление уже ротированного токена — признак кражи: отзываются **все** сессии
   пользователя, пишется `session.reuse_detected` (§2.4, критерий AC-1).
6. `logout` отзывает текущую сессию, `logoutAll` — все сессии пользователя, включая текущую
   (ADR-0009 п. 4; критерий AC-3 — «ни одной по спецификации»).
7. Браузер не получает refresh: BFF `POST /api/graphql` снимает его из ответа и кладёт в
   httpOnly-cookie своего домена, а в запросы `refreshSession`/`logout` подставляет из cookie
   (ADR-0023 п. 2, 5; критерий AC-2).
8. Cookie делает мутации уязвимыми к CSRF, поэтому маршрут Nuxt проверяет `Origin` и
   `Sec-Fetch-Site` для мутаций (ADR-0023 п. 4).
9. Окончание плана сессию не отзывает (журнал #55, `session-lifecycle.md` §2.13).

Не входит: страница `/me/sessions` и запрос `mySessions` (T-025), страницы `/login` и
`/auth/verify` (T-022), ограниченная сессия архивированного аккаунта и отзыв сессий при
архивировании (отдельные задачи эпика), лимиты частоты (T-024).

## 2. Шаги

1. `server/src/auth/session.ts` — выпуск непрозрачного токена, срок, старт сессии, ротация с
   обнаружением повторного предъявления, отзыв одной и всех сессий. Узкий интерфейс клиента
   Prisma, чтобы логика проверялась без базы.
2. `server/src/graphql/auth/schema.graphql` — `refreshSession`, `logout`, `logoutAll`;
   `AuthPayload.refreshToken` становится nullable: через BFF браузер видит `null`.
3. `server/src/graphql/auth/resolver.ts` — `verifyMagicLink` создаёт сессию и выдаёт `sid`
   в access-JWT; новые мутации; журналирование `auth.login`, `session.refresh`,
   `session.revoked`, `session.reuse_detected`.
4. `server/src/prisma.ts` — проверка `sid` в контексте, `sessionId` и метаданные запроса
   (`user-agent`, `x-forwarded-for`) в `GraphQLContext`.
5. `web/server/utils/sessionCookie.ts` — разбор мутаций документа, подстановка refresh из
   cookie, снятие refresh из ответа, признак очистки cookie, проверка Origin/Sec-Fetch-Site.
6. `web/server/api/graphql.post.ts` и `web/server/utils/graphqlProxy.ts` — применение
   cookie-логики и передача `user-agent`/IP клиента в API.
7. `pnpm codegen` — обновление `web/app/graphql/generated/schema.graphql`.

## 3. Проверки

- Unit (server): ротация, повторное предъявление, истёкшая и отозванная сессия, `logout`,
  `logoutAll`, контекст по `sid`, сессия при истёкшем плане.
- Unit (web): подстановка cookie в переменные, снятие refresh из ответа, очистка cookie,
  отказ кросс-доменной мутации.
- Playwright: полный вход через Mailpit, `document.cookie` не содержит refresh, обновление
  работает по cookie, повторное предъявление отклоняется, `logout` стирает cookie.
- `pnpm format`, `pnpm lint`, `pnpm test`, `pnpm --filter server run build:ci`,
  `pnpm --filter nuxt-app run typecheck`, `pnpm --filter nuxt-app run build`.

# T-124: обновление сессии на клиенте и безопасная ротация refresh — план

- **Дата**: 2026-09-27
- **Задача**: T-124 / ALTE-131 (native issue `01a0e314-4642-7763-a99d-6e14e9e381df`)
- **Authorization**: прямое поручение владельца 2026-09-26 «заведи задачи на доработку возвращённых 16»; решение владельца 2026-09-27 при разборе blocked
- **Источник**: `docs/backlog/tasks/T-124-session-refresh-client.md` (ревизия чтения `587ba320fc976ac1e0bf8843b8673d58fc5e1937`)
- **Baseline**: `db57fc6f4a327ed9c6b811f56e71a67f3ff7517c` (`origin/app`, свежий fetch 2026-09-27)
- **Ветка**: `server/t124-session-refresh`, рабочее дерево `.worktrees/t124-session-refresh`
- **Исходное дерево**: clean
- **Отчёт**: `docs/reports/2026-09-27-t124-session-refresh-report.md` (после зелёного CI)

**Цель:** закрыть два дефекта, найденные независимым ревью 2026-09-26 у возвращённой T-023:
`refreshSession` не вызывается ни клиентом, ни BFF (сессия живёт 15 минут), а ротация меняет
`tokenHash` без условия на прежнее значение.

## 1. Контракт и границы

Старшинство источников: журнал §25.7 → `docs/spec/50-access/session-lifecycle.md` §2.4–2.5 и
`docs/spec/30-account/reader/sessions.md` → ADR-0009 п. 3, ADR-0023 п. 2–3 → находки ревью.

Сохраняемый контракт: мутации `refreshSession`, `logout`, `logoutAll`; refresh хранится только
хэшем; отзыв по `sid` на каждом запросе; браузерный JS токенов не видит.

Не входит: лимит «до 10 устройств» `[ДОПУЩЕНИЕ]`; перенос access-токена из тела ответа в cookie
целиком (только по признанию архитектора частью ADR-0023).

## 2. Наблюдаемое исходное состояние

1. `web/app/graphql/operations/common/auth.graphql:53` — операция `RefreshSession` объявлена, но
   нигде не вызывается: ни `web/app` (кроме генерации типов), ни `web/server`.
2. `web/app/middleware/auth.global.ts:14-17` — закрытая страница пускает только при наличии
   access-cookie. Её `maxAge` — 15 минут (`web/server/utils/sessionCookie.ts:8`), поэтому через
   16 минут браузер её не присылает и SSR уводит вошедшего на `/login`, хотя refresh-cookie
   жива 30 дней.
3. `server/src/auth/session.ts:127-144` — ротация читает строку по `tokenHash` и обновляет её по
   `id` без условия на прежний `tokenHash`: два параллельных обмена одним токеном оба проходят,
   и каждый считает себя победителем.
4. `web/server/api/graphql.post.ts:49-66` — ответ `UNAUTHENTICATED` отдаётся странице как есть,
   обмена и повтора запроса нет.

## 3. Шаги

### Шаг 1 (AC-2) — сравнение и замена при ротации

`server/src/auth/session.ts`: `rotateSession` заменяет `update({where:{id}})` условным
`updateMany({where:{id, tokenHash, revokedAt: null}})` и смотрит на `count`. `count > 0` —
ротация, строка собирается из прочитанной и новых полей. `count === 0` — гонка проиграна:
исход считается как у повторного предъявления (отозванная сессия → `revoked`, найденный по
`previousTokenHash` победитель → `reuse_detected`), но не `unknown`. `SessionClient` получает
`tokenHash` в `where` у `updateMany` и `SessionWriteData` в `data`; неиспользуемый `update`
убирается. Двойники в `server/tests/session-rotation.test.ts` и
`server/tests/session-mutations.test.ts` поддерживают условие.

### Шаг 2 (AC-3) — один общий обмен в BFF

Новый `web/server/utils/sessionRefresh.ts`: мутация обмена, разбор ответа
(`refreshed` / `rejected` / `unavailable`), признак `UNAUTHENTICATED` в конверте, реестр
обменов «один на предъявленный токен» с временем жизни результата и повтор запроса
(`sendWithSessionRefresh`) один раз. Реестр нужен потому, что вкладки просыпаются вместе: без
него вторая предъявила бы уже ротированный токен и сервер прочитал бы это как кражу
(`session-lifecycle.md` §2.4). Недоступный апстрим не кэшируется.

### Шаг 3 (AC-1, AC-3) — вызов обмена из BFF

`web/server/api/graphql.post.ts` после ответа `UNAUTHENTICATED` обменивает refresh и повторяет
исходный запрос один раз; отказ обмена стирает обе cookie. Новый
`web/server/middleware/session-refresh.ts` делает то же до рендера страницы, когда навигация
пришла без access-cookie, но с refresh: обновлённая пара пишется и в ответ, и в заголовки
запроса — иначе `auth.global` уводит на вход, а BFF идёт к API без токена.

### Шаг 4 — проверки

- `server/tests/session-rotation.test.ts` — условная замена на двойнике.
- `server/tests/session-rotation-database.test.ts` (новый, `T124_TEST_DATABASE_URL`) — AC-2 на
  настоящем PostgreSQL: два параллельных `refreshSession` одним токеном.
- `web/tests/session-refresh.test.ts` (новый) — AC-3: один обмен на две вкладки, кэш результата,
  повтор запроса один раз, разбор ответов, подстановка cookie в заголовки запроса.
- `web/tests/e2e/24-session-refresh.spec.ts` (новый) — AC-1 на реальном сервере: вход по ссылке,
  затем состояние «прошло 16 минут» (браузер без access-cookie и с истёкшим access-токеном) и
  открытие `/me` без повторного входа.
- CI: шаг с `T124_TEST_DATABASE_URL` в джобе `server-smoke`.

## 4. Риски

- Реестр обменов живёт в памяти процесса: при нескольких экземплярах Nitro защита от ложного
  reuse работает в пределах одного. Фиксируется в остатке.
- Подмена `event.node.req.headers.cookie` — приём для SSR: проверяется e2e (страница кабинета
  открывается) и unit-тестом самой подстановки.

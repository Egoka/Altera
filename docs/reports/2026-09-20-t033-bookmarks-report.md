# Отчёт T-033: закладки — страница `/me/bookmarks` и кнопка на материале

- **Задача**: ALTE-89 / T-033, источник `docs/backlog/tasks/T-033-bookmarks.md`
- **План**: `docs/plans/2026-09-20-t033-bookmarks.md`
- **Baseline**: `origin/app` = `4ea27a63d0fac9ccc9eb38cde522d9b17b58799b`
- **Ветка**: `feat/t033-bookmarks` в отдельном worktree
- **Спецификации**: `docs/spec/30-account/reader/bookmarks.md`,
  `docs/spec/10-flows/bookmark-and-follow.md`, `docs/spec/20-public/article.md`,
  реестр событий `docs/spec/00-registries/events-and-logs.md` #56

## 1. Что сделано

### Сервер

Новый домен `server/src/graphql/bookmark/` (`schema.graphql` + `resolver.ts`) поверх сервиса
`server/src/bookmarks/service.ts`:

| Операция | Поведение |
| --- | --- |
| `myBookmarks(cursor, limit, unavailable)` | курсорная выдача по `createdAt DESC`, `counts { total, unavailable }`, `pageInfo { endCursor, hasNextPage }`; неизвестный курсор и лимит вне 1…100 дают `VALIDATION_ERROR` |
| `myBookmark(articleId)` | состояние кнопки на материале |
| `addBookmark(articleId)` | идемпотентный `upsert`; несуществующий или снятый материал — `NOT_FOUND` |
| `removeBookmark(articleId)` | удаление; отсутствующая закладка — `NOT_FOUND` |

Доступ закрывает `ensureBookmarkOwner`: гость получает `UNAUTHENTICATED`, служебный аккаунт,
служебная роль и архивированный аккаунт — `FORBIDDEN` с `action` `bookmark.list` / `bookmark.add` /
`bookmark.remove` (журнал #58). База уже ограничивала владельца закладки в T-017 (CHECK
`bookmarks_personal_account_check` и триггер `bookmarks_sync_owner_eligibility`), поэтому проверка
в резолвере закрывает тот же контракт на уровне API. **Схема и миграции не менялись.**

`available` в выдаче — это `status = published`. Снятый или архивированный материал остаётся в
списке со значением `false` и не исчезает из закладок.

### События #56

`bookmark.add` / `bookmark.remove` в реестре имеют тип `metric`, а не `log`, поэтому они не
попадают в `LOG_EVENT_CODES`. Добавлен отдельный реестр
`server/src/observability/metric-events.ts` (20 утверждённых кодов типа `metric`) и необязательный
метод `AppLogger.metric()`, который пишет счётчик в тот же поток с полем `kind: "metric"`.
Метод необязателен намеренно: существующие тестовые двойники журнала остаются парой `{ log }`.
Агрегаты и использование закладки как сигнала рейтинга — это F-02, в объём задачи не входят.

### Веб

- `web/app/pages/me/bookmarks/index.vue` — заголовок «Закладки · N», переключатель
  «все / недоступные» (`?unavailable=1`), список, «показать ещё» по курсору, состояния
  загрузки / ошибки / пусто, `noindex, nofollow`, возврат убранной закладки в течение 5 секунд.
- `web/app/components/me/BookmarkCard.vue` — карточка с датой добавления и крестиком; недоступная
  приглушена (`opacity-60 grayscale`), её заголовок не ссылка, показана отметка «Недоступна»
  (журнал §25.10).
- `web/app/components/reading/ArticleBookmark.vue` + `web/app/utils/bookmarkState.ts` — кнопка на
  странице материала. Сессии в вебе пока нет, поэтому состояние кнопки решает сервер по коду
  ошибки: `UNAUTHENTICATED` → приглашение войти, `FORBIDDEN` → кнопки нет вовсе.
- Операции `web/app/graphql/operations/me/bookmarks.graphql`, перегенерированный codegen,
  экспорт в `web/app/query/index.ts`, ключи `bookmarks.*` в `ru.json` и `en.json`.

## 2. Критерии готовности

| # | Критерий | Как проверено |
| --- | --- | --- |
| 1 | Архивированный материал остаётся в закладках «недоступным» | `server/tests/bookmarks.test.ts` → «оставляет архивированный материал в списке недоступным» (`available: false`, `counts.unavailable = 1`); `web/tests/e2e/22-bookmarks.spec.ts` → «keeps an archived article in bookmarks as unavailable» (`data-available="false"`, `filter: grayscale(1)`, `opacity: 0.6`, заголовок не ссылка, крестик на месте) |
| 2 | Служебная роль получает `FORBIDDEN` на `bookmark.add` | `server/tests/bookmarks.test.ts` → «возвращает FORBIDDEN служебной роли на bookmark.add» для `editor`, `moderator`, `analyst`, `admin`, `owner`, плюс служебный аккаунт с ролью читателя; счётчик `bookmark.add` при отказе не пишется |

## 3. Как проверено

Node `v24.12.0`, pnpm `10.18.3`, рабочее дерево `.worktrees/t033-bookmarks` на ветке
`feat/t033-bookmarks`.

| Команда | Exit | Результат |
| --- | --- | --- |
| `pnpm install --frozen-lockfile` | 0 | установка завершена |
| `pnpm format` | 0 | All matched files use Prettier code style |
| `pnpm lint` | 0 | без замечаний |
| `pnpm test` | 0 | server 272 passed, 24 skipped (51 файл); web 187 passed (27 файлов) |
| `pnpm --filter nuxt-app run typecheck` | 0 | диагностик нет |
| `pnpm --filter server run build:ci` | 0 | сборка и копирование схемы прошли |
| `pnpm --filter nuxt-app run build` | 0 | Nitro-сборка прошла |
| `playwright test tests/e2e/22-bookmarks.spec.ts` | 0 | 3 passed (27.9s) |

Новые тесты: `server/tests/bookmarks.test.ts` (11 тестов), `web/tests/bookmark-components.nuxt.test.ts`
(6 тестов), `web/tests/e2e/22-bookmarks.spec.ts` (3 сценария), плюс проверка кодов `metric` в
`server/tests/event-code-registry.test.ts`.

## 4. Границы доказательства

- Полный `pnpm --filter nuxt-app run test:e2e` на этой машине не запускался: локальный
  PostgreSQL и Mailpit недоступны (docker daemon отвечает ошибкой 500 на запрос API). Из
  сценариев, не требующих базы, проверены `22-bookmarks`, `17-my-articles`, `navigation`,
  `homepage.smoke` — прошли; `noindex-meta` упал на подключении Prisma к отсутствующей базе, это
  ограничение среды, а не следствие изменений. Зелёный агрегат CI подтверждается на PR.
- Сценарий закладок подменяет ответы `/api/graphql` маршрутом Playwright, как это уже сделано в
  `17-my-articles.spec.ts`; сквозной путь через реальную базу не проверялся.
- Счётчики `bookmark.add` / `bookmark.remove` пишутся в поток логов. Хранилища агрегатов и
  сигнала рейтинга нет — это F-02, вне объёма.

## 5. Не входило в объём

Подписка на автора (F-10), закладки как сигнал рейтинга и их агрегаты (F-02), редиректы
`/bookmarks` и `/saved`, письма о закладках, языковая версия закладки по языку интерфейса
(используется `sourceLocale` материала — старые локализованные поля `Article` остаются до T-020).

# T-072: раздел `/admin/articles` по языковым версиям

**Цель:** заменить демонстрационные данные реальным служебным списком и карточкой `ArticleTranslation`, сохранив авторский архив T-045 и решения очереди T-050.

**Архитектура:** чтение раздела оформляется отдельным модулем `server/src/admin/articles.ts` и GraphQL-модулем `admin-articles`. Архив и восстановление расширяют существующие `archiveArticle` / `restoreArticle`: авторский путь остаётся прежним, сотрудник обязан указать причину, а восстановить чужой архив может только `owner`. Веб использует отдельный composable, URL-фильтры и две read-only страницы.

**Стек:** Prisma 6, GraphQL Yoga, Nuxt 4/Vue 3, Vitest, Playwright.

**Источник:** `docs/backlog/tasks/T-072-admin-articles.md` и `docs/spec/40-admin/articles.md` на `e39875221f7ba4368262852719767c3e46fecd9f`.

## Ограничения

- Текст, рубрика, теги и слаг из раздела не редактируются.
- `moderator`, `admin`, `owner` читают все версии; `editor` читает только редакционные материалы.
- `moderator`, `admin`, `owner` архивируют с непустой причиной; восстановление сотрудником доступно только `owner`.
- Окончательный отказ остаётся единственной мутацией T-050 `rejectReviewFinal`; `admin` её не получает.
- Точное число чтений берётся из `ArticleTranslation.readCount` без округления.
- Архив по умолчанию скрыт и открывается отдельным URL-фильтром.

## Проверяемые риски

- Поиск короче трёх символов должен вернуть `VALIDATION_ERROR`, а не широкий запрос.
- `editor` не должен получить чужую пользовательскую версию по прямому ID.
- Повторный архив должен вернуть `CONFLICT` и не переписать актора.
- `admin` и `moderator` не должны восстановить архивированную статью даже прямой GraphQL-мутацией.
- Ошибка/конфликт мутации не должны очищать введённую причину в карточке.

## Этапы

### 1. Серверный read-model (RED → GREEN)

- Добавить `server/tests/admin-articles.test.ts`: роль и редакционное сужение, фильтры/поиск/сортировка/пагинация, точный `readCount`, карточка с ревизиями, решениями, сестринскими версиями и архивным актором.
- Запустить `pnpm --filter server exec vitest run tests/admin-articles.test.ts` и получить ожидаемый RED из-за отсутствующего модуля.
- Реализовать `server/src/admin/articles.ts`, `server/src/graphql/admin-articles/schema.graphql` и `resolver.ts`.
- Повторить тест до GREEN.

### 2. Архив и восстановление (RED → GREEN)

- Расширить `server/tests/article-archive-restore.test.ts` сценариями архива сотрудником с причиной, сохранением роли в аудите, восстановлением владельцем и запретом для `admin`.
- Получить RED на текущем `archiveArticle(id)` / авторском `restoreArticle(id)`.
- Добавить nullable `reason` в схему и развести авторский/служебный путь в resolver без изменения принятого поведения T-045.
- Прогнать оба серверных набора до GREEN.

### 3. Веб-контракт и страницы (RED → GREEN)

- Добавить `web/tests/admin-articles-page.nuxt.test.ts`: состояния loading/empty/error, точные чтения, URL-фильтры, read-only карточка, видимость архив/restore/final-reject по ролям, сохранение причины при ошибке.
- Обновить `web/tests/admin-shell.test.ts`: `/admin/articles` доступен `moderator` и `admin`, `analyst` не получает раздел.
- Получить RED на моковой странице и отсутствующем composable.
- Добавить GraphQL operations, `useAdminArticles.ts`, middleware, helpers, реальный список и карточку; дополнить русскую/английскую локализацию.
- Выполнить `pnpm codegen` и повторить веб-тесты до GREEN.

### 4. Playwright и итоговая проверка

- Добавить `web/tests/e2e/72-admin-articles.spec.ts` с собственной БД-фикстурой: состояния строк, поиск/архив, карточка и запрет восстановления для `admin`; тест не содержит `skip`.
- Запустить целевой Playwright на разрешённой одноразовой БД, если `T069_TEST_DATABASE_URL` доступен; иначе явно зафиксировать инфраструктурный gap, не выдавая его за PASS.
- Проверить `pnpm format`, `pnpm lint`, `pnpm test`, `pnpm --filter server run build:ci`, `pnpm --filter nuxt-app run typecheck`, `pnpm --filter nuxt-app run build`.
- Зафиксировать полный tested SHA, создать PR в `app`, дождаться required CI, получить независимый review того же SHA и оформить канонический receipt/отчёт.

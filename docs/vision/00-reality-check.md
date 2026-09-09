# Срез реальности: что в Altera существует на самом деле

> **Расхождения с журналом решений Г1–Г9 (2026-09-08/09).** Документ стоит на ревизии 2 (2026-09-06) и не синхронизирован с рабочим журналом `docs/decisions/role-review-working-log-2026-09-08.md`; при расхождении главнее журнал и действующие спецификации `docs/spec/`. Полная ревизия — задача T-109 (`docs/backlog/`); номера строк ниже — по тексту ревизии 2 до этой врезки. Не действуют:
- срез от 2026-09-05 (коммит `8cb987c`); обновление — задача T-111 после эпиков E-01–E-05.


- **Коммит**: `8cb987c` (ветка `server/api`), дата среза 2026-09-05.
- **Назначение**: зафиксировать фактическое состояние кода как основание для целевой
  архитектуры и дорожной карты. Документация в `docs/` здесь используется только как объект
  проверки, а не как источник.
- **Пометки**: `[ФАКТ: файл:строка]` — проверено чтением кода или командой; `[ДОПУЩЕНИЕ]` —
  вывод из известного поведения библиотек, не проверенный запуском; `[НЕ ПРОВЕРЕНО]` — принято
  со слов документа или отчёта; `[ПО ОТЧЁТУ]` — утверждение предыдущего среза
  `altera-project-summary-2026-09-05.md`.

---

## 0. Итог в трёх абзацах

Сервер — это работающий GraphQL API поверх пяти таблиц PostgreSQL с magic-link входом,
резолверами публичных страниц, личного кабинета и админских таблиц, кешированием в Redis и
проверкой прав в резолверах. Код сервера не менялся с 2025-08-02
[ФАКТ: `git log -1 -- server/src`], схема данных — с 2025-07-27. В нём есть три дыры доступа,
незавершённый цикл сессий, отсутствие почты, тяжёлая инвалидация кеша и жёсткая зависимость от
Redis, но это код, на который можно опираться.

Веб — это визуальная оболочка: шапка с мега-меню, футер, тёмная тема, четыре кастомные
гарнитуры, карточки материалов, страницы главной, автора, тега, типа контента и админские
таблицы на FishtVue. **Ни одна страница не получает данные из API**: нет GraphQL-клиента, нет
адреса API, все данные — константы внутри компонентов. Из 35 GraphQL-операций фронта против
серверной схемы валидны 10. Защита маршрутов закомментирована, страниц входа не существует,
i18n применён только на демонстрационной странице.

Инженерная база отсутствует: тестов нет, `pnpm test` успешно ничего не запускает, `pnpm lint`
сейчас падает, CI маскирует падение старта сервера, сид-скрипт указывает на несуществующий файл,
собранный `web/.output` под локальным Node 24 отдаёт 500 на каждом маршруте. Большая часть
`docs/` описывает намерения и местами прямо противоречит коду.

---

## 1. Как проверялось

### Проверено лично (чтение кода и команды)

| Что | Как |
|---|---|
| Схема данных и миграции | Прочитаны `server/prisma/schema.prisma` и все четыре `migration.sql` |
| Контракт API и права | Прочитаны все `schema.graphql` и резолверы (`article`, `auth`, `user`, `contentType`, `sectionTag`), `server.ts`, `redis.ts`, `prisma.ts`, `exceptions/permissions.ts`, `utils/admin.ts` |
| Соответствие операций фронта схеме | Скрипт на `graphql-js`: собрать схему из `server/src/graphql/**/*.graphql` через `@graphql-tools/merge`, извлечь все `export const X = \`…\`` из `web/app/query/**`, прогнать `validate()`. То же для `docs/queries/**/*.graphql` по каждой операции |
| Веб: страницы, компоненты, middleware, конфиг, токены | Прочитаны `nuxt.config.ts`, `main.css`, оба middleware, `app.vue`, layouts, `pages/*`, ключевые компоненты; поиск по дереву на `useFetch`, `useAsyncData`, `$fetch`, `~/query`, `$t(`, `useHead`, `useSeoMeta`, `useColorMode`, `#fishtvue`, `NuxtImg`, `mock`, `TODO` |
| Сборка и проверки | `cd server && npx tsc --noEmit` (exit 0); `pnpm lint` (падает); `pnpm test` (exit 0, тестов нет); `pnpm format` (падает на 4 файлах) |
| Прод-сборка веба | Запуск `node web/.output/server/index.mjs` (сборка от 2026-09-05 19:36) и HTTP-пробы 16 маршрутов, включая `/_ipx/...` |
| CI и хуки | `.github/workflows/pull_request.yml`, `.husky/pre-commit`, `.husky/commit-msg` |
| Документация | Прочитаны все файлы `docs/` кроме исторических отчётов, `README.md`, `server/ENV_SETUP.md`, `web/README.md` |
| История | `git log` по `server/src`, `server/prisma`, `web/app` |

### Принято со слов документов, не проверялось

- Падение `nuxi typecheck` из-за отсутствия `vue-tsc` [ПО ОТЧЁТУ].
- Рендер главной в dev-режиме и переход на `/popular` в Playwright [ПО ОТЧЁТУ]; здесь
  проверялась только прод-сборка, и она не работает (см. §6.9).
- Содержимое базы Neon (есть ли реальные пользователи и материалы) [НЕ ПРОВЕРЕНО]: к базе не
  подключался. `CLAUDE.md` утверждает, что данные есть; для миграций считаем это допущением.
- Поведение Nuxt при `middleware: ["auth"]` без файла `middleware/auth.ts` (ожидаемая ошибка
  «Unknown route middleware») [ДОПУЩЕНИЕ]: воспроизвести не удалось, потому что SSR-сборка
  падает раньше.

---

## 2. Данные (Prisma + PostgreSQL)

**Существует** [ФАКТ: `server/prisma/schema.prisma`]:

| Модель | Строки | Поля | Замечания |
|---|---|---|---|
| `User` | 12–27 | `id` uuid, `name`, `email` @unique, `bio`, `photoUrl`, `role` (default `reader`), `slug` @unique, `socialLinks` Json, даты | Нет ни блокировки, ни удаления, ни подтверждения почты |
| `MagicLinkToken` | 29–40 | `token` @unique, `userId` @unique (один токен на пользователя), `expiresAt`, `usedAt` | Повторный запрос ссылки перезаписывает предыдущую |
| `ContentType` | 42–54 | `name`, `slug` @unique, `description`, `order`, `status` active/archived | Это и «рубрика», и префикс URL материала |
| `SectionTag` | 56–66 | `name`, `slug` @unique, `description` | |
| `Article` | 68–87 | `title`, `slug` @unique, `dek`, `body` **String**, `excerpt`, `featuredImage` String, `status`, `publishedAt`, `authorId`, `typeId`, M:N `sectionTags` | Одна языковая версия, одна редакция, тело — произвольная строка |
| enum `Role` | 89–94 | `reader`, `author`, `editor`, `admin` | |
| enum `ArticleStatus` | 101–106 | `draft`, `review`, `published`, `archived` | |

Миграции [ФАКТ: `server/prisma/migrations/`]: четыре, все июль 2025. Вторая
(`20250726211815_update_roles`) удаляет значение `user` из enum `Role` с предупреждением Prisma,
что при наличии таких строк миграция упадёт [ФАКТ: `migration.sql:4`]. Индексов кроме unique
нет: по `status`, `publishedAt`, `authorId`, `typeId` — ни одного [ФАКТ: `20250720172223_db/migration.sql:79-95`].

**Отсутствует в модели полностью**: медиа-библиотека, версии материалов, языковые версии и
переводы, подборки, SEO-поля, комментарии, реакции, жалобы, подписки, тарифы, платежи,
промокоды, аудит-лог, сессии/refresh-токены, счётчики просмотров, признак «избранного»,
блокировка пользователя. [ФАКТ: полный список моделей выше]

`prisma:seed` ссылается на `seed/seed.ts` [ФАКТ: `server/package.json:16`]; папки `server/seed`
нет [ФАКТ: дерево `server/`]. Скрипт `build` выполняет `prisma migrate deploy` внутри сборки
[ФАКТ: `server/package.json:8`], то есть миграции применяются при каждой сборке образа.

---

## 3. API (GraphQL Yoga)

### 3.1. Транспорт и контекст

- Yoga поверх `node:http`, эндпоинт `/`, CORS только на `FRONTEND_URL` с `credentials: true` и
  методом `POST`, плагины `useCSRFPrevention` всегда и `blockFieldSuggestions` только в
  production [ФАКТ: `server/src/server.ts:11-21`].
- Схема собирается автоматически из всех `*.graphql` и `**/resolver.*` в `src/graphql`
  [ФАКТ: `server/src/graphql/schema.ts:7-12`].
- Контекст `{ prisma, currentUser, redis }`; пользователь восстанавливается из
  `Authorization: Bearer`, невалидный или просроченный токен даёт `null` без ошибки
  [ФАКТ: `server/src/prisma.ts:20-43`]. Роль берётся из базы на каждый запрос, а не из клейма
  токена [ФАКТ: `prisma.ts:29-31`].
- `JWT_ACCESS_SECRET` и `REDIS_URL` обязательны на этапе импорта модулей: без них процесс
  падает [ФАКТ: `prisma.ts:7-9`, `redis.ts:3-8`, `auth/resolver.ts:6-8`].

### 3.2. Контракт: что есть

| Операция | Доступ | Кеш | Файл |
|---|---|---|---|
| `article(slug)` | публичный, **без фильтра по статусу** | `article:{slug}`, 6 ч | `article/resolver.ts:38-58` |
| `articleDetail(slug)` | публичный, только `published` | `article_detail:{slug}` | `:60-128` |
| `recommendedArticles`, `relatedArticles`, `articleStats` | публичные | по слагу | `:130-244` |
| `featuredArticles(limit)` | публичный | `featured_articles:{limit}` | `:246-268` |
| `latestArticles(limit, excludeFeatured)` | публичный | `latest_articles:…` | `:270-308` |
| `popularArticles(timeRange, limit)` | публичный | `popular_articles:…` | `:310-357` |
| `articles(pagination, sort, filters, search)` | **admin** | `admin:admin_articles:{md5}` | `:360-503` |
| `user(slug)` | публичный, отдаёт всю запись | `user:slug:{slug}` | `user/resolver.ts:28-47` |
| `author(slug)` | публичный, только `role = author` | тот же ключ, что и `user` | `:49-68` |
| `articlesByAuthor`, `authorStats` | публичные, только `published` | по слагу | `:70-168` |
| `me`, `myArticlesStats` | аутентифицированный | `user:{id}`, `user_stats:{id}` | `:170-229` |
| `users(...)` | **admin** | `admin:admin_users:{md5}` | `:232-340` |
| `contentType(slug)`, `articlesByContentType`, `contentTypeStats` | публичные | по слагу | `contentType/resolver.ts:30-206` |
| `contentTypes(...)` | **admin** | `admin:…` | `:209-317` |
| `tag(slug)`, `articlesByTag`, `tagStats` | публичные | по слагу | `sectionTag/resolver.ts:31-183` |
| `sectionTags(...)` | **admin** | `admin:…` | `:186-288` |
| `requestMagicLink(email)`, `verifyMagicLink(token)` | публичные | — | `auth/resolver.ts:19-99` |
| `createArticle`, `updateArticle`, `archiveArticle`, `requestReview`, `revertToDraft` | любой аутентифицированный; правки — только своих | — | `article/resolver.ts:506-630` |
| `setArticleStatus`, `bulkDeleteArticles`, `bulkUpdateArticleStatus` | **admin** | — | `:632-768` |
| `createContentType`, `updateContentType`, `deleteContentType`, `reorderContentTypes`, `archiveContentType` | **admin** | — | `contentType/resolver.ts:322-533` |
| `createTag`, `updateTag`, `deleteTag`, `mergeTags` | **admin** | — | `sectionTag/resolver.ts:293-512` |

### 3.3. Контракт: чего нет

Нет ни одной операции для: выхода и обновления токена, редактирования профиля, удаления
своей статьи, списка своих статей (`myArticles`), статьи для редактирования, **публичного
списка рубрик для навигации** (единственный `contentTypes` требует `admin`
[ФАКТ: `contentType/schema.graphql:69-75`]), популярных тегов, поиска, подсказок поиска,
загрузки медиа, изменения ролей, блокировки пользователей. Все эти операции при этом
существуют на фронте как строки (см. §6.2).

### 3.4. Дефекты доступа и данных

1. **Черновики и архив доступны всем.** `article(slug)` ищет по слагу без условия на статус
   [ФАКТ: `article/resolver.ts:49-52`], и результат кешируется на 6 часов.
2. **E-mail в публичном типе.** `User.email: String!` [ФАКТ: `user/schema.graphql:12`],
   `user(slug)` возвращает запись целиком [ФАКТ: `user/resolver.ts:38-46`]; операция фронта
   `GET_AUTHOR_PAGE` его и запрашивает [ФАКТ: `web/app/query/pages/authors/detail.ts:8`].
3. **Роль `editor` не имеет ни одного права.** Строка `editor` встречается только в enum
   схемы, в сгенерированном клиенте и в типах фронта; все проверки — `ensureHasRole(..., "admin")`
   [ФАКТ: поиск по дереву; `article/resolver.ts:377,633,663,710`; `user/resolver.ts:244`].
4. **`reader` может создавать статьи.** `createArticle` проверяет только аутентификацию
   [ФАКТ: `article/resolver.ts:507`]; роль `author` нигде не требуется.
5. **Автор правит опубликованное без модерации.** `updateArticle` не смотрит на статус
   [ФАКТ: `:531-562`]; инвалидируется только `article:{slug}`, но не `article_detail:*` и не
   списки [ФАКТ: `:557-559`].
6. **Админ не может править чужой текст**: проверка `authorId !== user.id` без исключения для
   ролей [ФАКТ: `:538-540`, `:571-573`].
7. **Страница автора есть только у `role = author`** [ФАКТ: `user/resolver.ts:60`]; у
   `editor`/`admin`, написавших материал, публичной страницы не будет, хотя `articlesByAuthor`
   ищет без фильтра роли [ФАКТ: `:85`].
8. **Слаг пользователя = локальная часть e-mail** [ФАКТ: `auth/resolver.ts:23-31`]; второй
   `ivan@…` с другого домена упадёт на unique-ограничении `users.slug` необработанной ошибкой
   Prisma. Слаг статьи приходит с клиента и тоже не обрабатывается на коллизии
   [ФАКТ: `article/schema.graphql:105`, `article/resolver.ts:506-529` без `try/catch`].
9. **`CreateContentTypeInput.status = ACTIVE`** при значениях enum в нижнем регистре
   [ФАКТ: `contentType/schema.graphql:84`]; значение по умолчанию невалидно и фактически не
   применяется [ДОПУЩЕНИЕ: поведение `graphql-js` для невалидного default].
10. Публичные резолверы бросают `new Error("Author not found")` [ФАКТ: `user/resolver.ts:87`],
    что Yoga маскирует в «Unexpected error» [ДОПУЩЕНИЕ: маскирование ошибок включено по умолчанию].
11. `featuredArticles` — это просто последние опубликованные (комментарий в коде это
    признаёт) [ФАКТ: `article/resolver.ts:257-258`]; `popularArticles` — последние за период
    [ФАКТ: `:333-334`]; `viewCount`/`shareCount` всегда 0 [ФАКТ: `:114-116`].

### 3.5. Аутентификация и сессии

- Magic link: 32 случайных байта, срок 15 минут, одноразовость через `usedAt`, один токен на
  пользователя (upsert) [ФАКТ: `auth/resolver.ts:36-51`, `:60-82`]. Пользователь создаётся при
  первом запросе ссылки — регистрация и вход не различаются [ФАКТ: `:20-34`].
- Ссылка **печатается в консоль** [ФАКТ: `:56`]; сервиса писем и зависимости для отправки нет
  [ФАКТ: `server/package.json:23-36`].
- Выдаются access (15 мин, с клеймом `role`) и refresh (7 дней) JWT [ФАКТ: `:86-92`]. Мутаций
  `refreshToken`/`logout` нет, refresh нигде не хранится и не отзывается: через 15 минут
  клиент может только заново пройти magic link [ФАКТ: `auth/schema.graphql:7-10`].
- Ограничений частоты нет ни на запрос ссылки, ни на проверку токена, ни на API в целом
  [ФАКТ: `server.ts:20`, `auth/resolver.ts`].

### 3.6. Кеш и Redis

- Все публичные запросы сначала ходят в Redis; клиент создан с `maxRetriesPerRequest: null`
  [ФАКТ: `redis.ts:10-12`]. При недоступном Redis команды остаются в очереди до переподключения,
  то есть API не деградирует, а зависает [ДОПУЩЕНИЕ: семантика ioredis].
- TTL везде 6 часов: `CACHE_TTL` по умолчанию `21600` и захардкоженный `ADMIN_CACHE_TTL = 21600`
  [ФАКТ: `utils/admin.ts:7`, `article/resolver.ts:34`]; гайд обещает 2 минуты для админки
  [ФАКТ: `docs/guides/admin_query_standards.md`, раздел «Кеширование»].
- **Ключ админского кеша не включает `search`**: `getCacheKey("admin_articles", { pagination,
  sort, filters })` [ФАКТ: `article/resolver.ts:439`; аналогично `user/resolver.ts:289`,
  `contentType/resolver.ts:260`]. Два разных поисковых запроса с одинаковыми фильтрами получат
  один и тот же ответ на 6 часов.
- Инвалидация через блокирующий `KEYS pattern` в 13 местах [ФАКТ: `article/resolver.ts:581-583,
  649-651, 685-688, 749-752`; `contentType/resolver.ts:337-338, 371-372, 426-427, 483-484, 517-518`;
  `sectionTag/resolver.ts:308-309, 342-343, 397-398, 495-496`].
- Публикация статьи (`setArticleStatus`) сбрасывает главную и `article:{slug}`, но не
  `article_detail:*`, `author_articles:*`, `content_type_articles:*`, `tag_articles:*`,
  `*_stats:*` [ФАКТ: `article/resolver.ts:646-655`]: новая публикация до 6 часов не появится на
  страницах автора, рубрики и тега.

### 3.7. Наблюдаемость и обработка ошибок

Логирование — `console.log` в каждом резолвере (более 50 вызовов) [ФАКТ: поиск по дереву];
«аудит» админских операций — тот же `console.log` [ФАКТ: `utils/admin.ts:224-230`].
Структурированного логгера, метрик, трассировки и health-check нет.

---

## 4. Роли: три несовместимых словаря

| Где | Значения | Файл |
|---|---|---|
| Prisma и GraphQL | `reader`, `author`, `editor`, `admin` | `schema.prisma:89-94`, `user/schema.graphql:2-7` |
| Типы страниц фронта | `"user" \| "admin"` | `web/app/types/user.ts:1` |
| Типы GraphQL-ответов фронта | `reader \| author \| editor \| admin` | `web/app/query/types.ts:56` |
| Фикстуры админки | `"ADMIN"`, `"AUTHOR"`, `"READER"` | `web/app/pages/admin/users/[slug].vue:16-46` |

Аналогично статусы статей: в схеме `published`, в фикстурах админки `"PUBLISHED"`/`"DRAFT"`
[ФАКТ: `web/app/pages/admin/articles/index.vue:15,63`], в `docs/queries` — `PUBLISHED`
[ФАКТ: результат валидации, §6.2].

---

## 5. Веб: оболочка без данных

### 5.1. Соединение с API

- В `web/package.json` нет ни одной GraphQL-зависимости [ФАКТ: `:12-30`], в `nuxt.config.ts`
  нет `runtimeConfig` и адреса API [ФАКТ: весь файл], плагинов нет [ФАКТ: папки `plugins/` нет].
- Ни `useFetch`, ни `useAsyncData`, ни `$fetch` в `web/app` не используются; единственное
  упоминание запроса — закомментированный `useAsyncQuery` с пометкой TODO
  [ФАКТ: `web/app/components/pages/start/Popular.vue:147-152`].
- Операции из `web/app/query/**` никуда не импортируются, кроме импорта типов
  [ФАКТ: поиск `~/query`: только `query/types` в `pages/authors/[slug].vue:2`].

### 5.2. Операции фронта против схемы (проверено скриптом)

Итог: **35 операций, валидны 10, невалидны 25**. Тестовые запросы в `docs/queries`:
**85 операций, валидны 56, невалидны 29**.

Валидные: `GET_HOME_PAGE_ARTICLES`, `GET_MY_PROFILE`, `GET_USER_MENU`, `CREATE_ARTICLE`,
`UPDATE_ARTICLE`, `CREATE_TAG`, `UPDATE_TAG`, `CREATE_CONTENT_TYPE`, `UPDATE_CONTENT_TYPE`,
`ARCHIVE_CONTENT_TYPE`.

Классы расхождений (полный вывод скрипта — в отчёте по плану):

| Класс | Операции |
|---|---|
| Поле `Query`/`Mutation` не существует | `adminArticles`, `articlesStats`, `changeArticleStatus`, `adminSectionTags`, `adminContentTypes`, `logout`, `updateProfile`, `refreshToken`, `popularTags`, `searchArticles`, `searchSuggestions`, `advancedSearch`, `myArticles`, `articleForEdit`, `deleteArticle`, `authorArticles`, `sectionTag`, `tagArticles`, `contentTypeArticles` |
| Другие аргументы | `relatedArticles(slug:)` вместо `articleSlug`; `mergeTags(sourceTagId, targetTagId)` вместо `input`; `reorderContentTypes(orders:)` вместо `input`; `contentTypes(status:)` вместо `pagination/sort/filters` |
| Другая форма ответа | `requestMagicLink { success message }` при `Boolean!`; `verifyMagicLink { token }` при `accessToken/refreshToken`; `deleteTag/deleteContentType/bulkDeleteArticles { success / deletedCount }` при возврате сущности; `authorStats { popularTags }` без подполей |

В `docs/queries` основная причина — регистр enum (`PUBLISHED`, `ACTIVE`, `AUTHOR`) и поля
`status`/`search` в `BaseFiltersInput`, которых в схеме нет [ФАКТ: `root/schema.graphql:28-34`];
`docs/queries/README.md` при этом утверждает, что «все запросы протестированы и работают».

### 5.3. Страницы: что отрисовано

| Маршрут | Файл | Состояние |
|---|---|---|
| `/` | `pages/index.vue` (7 строк) | Три секции на фикстурах: `Featured.vue`, `Latest.vue`, `Popular.vue` [ФАКТ: `Featured.vue:2-3`, `Latest.vue:2-3`, `Popular.vue:13-14`] |
| `/{type}` | `pages/[slugTypeContent]/index.vue` | Мок рубрики «National Security» и 30 сгенерированных статей [ФАКТ: `:9-44`] |
| `/{type}/{article}` | `pages/[slugTypeContent]/[slugArticle].vue` (12 строк) | Выводит параметр маршрута в `HeaderTag`; тела статьи нет [ФАКТ: `:6-10`] |
| `/authors` | `pages/authors/index.vue` (3 строки) | Пустая страница |
| `/authors/{slug}` | `pages/authors/[slug].vue` | Мок пользователя с `role: "user"` и три мок-статьи [ФАКТ: `:12-108`] |
| `/tags`, `/tags/{slug}` | `pages/tags/*` | Моки [ФАКТ: `tags/[slug].vue:8-38`] |
| `/types` | `pages/types/index.vue` | Моки, неиспользуемая `mockStats` ломает lint [ФАКТ: `:105`] |
| `/popular`, `/latest` | ссылки в шапке [ФАКТ: `components/app/header.vue:64-69`] | Страниц нет |
| «Log in» в шапке | `header.vue:88` | Ведёт на `/` |
| `/login`, `/auth/verify` | — | Не существуют; `MAGIC_LINK_BASE_URL` по умолчанию указывает на `/auth/verify` [ФАКТ: `auth/resolver.ts:15`] |
| `/me`, `/me/articles/*` | `pages/me/**` (по 12 строк) | Заглушки `<div>/me</div>`; объявляют `middleware: ["auth"]`, которого нет как именованного [ФАКТ: `pages/me/index.vue:2-5`] |
| `/admin` | `pages/admin/index.vue` | Надпись «В разработке» [ФАКТ: `:9`] |
| `/admin/articles`, `/tags`, `/types`, `/users` | `pages/admin/*/index.vue` | Таблицы FishtVue на локальных массивах [ФАКТ: `admin/articles/index.vue:9-10`, `admin/users/index.vue:29`] |
| `/admin/users/{slug}` | `pages/admin/users/[slug].vue` | Форма меняет объект в памяти и пишет `console.log` [ФАКТ: `:220-242`] |
| `/admin/articles/new`, `/{slug}`, `/{slug}/edit`, `/admin/me` | по 12 строк | Заглушки |
| `/components-showcase`, `/fonts-showcase`, `/test-error` | публичные демо-страницы | Доступны в проде |

### 5.4. Навигация, i18n, тема, ошибки

- Мега-меню: 16 захардкоженных «топиков» (частично из The Atlantic) и 20 тегов
  [ФАКТ: `components/visual/MegaMenu.vue:111-248`]; к рубрикам из базы не привязано.
- i18n настроен (`en` по умолчанию, `ru` с префиксом, словари по 102 строки)
  [ФАКТ: `nuxt.config.ts:65-87`], но `$t(...)` используется только в `components-showcase.vue`
  [ФАКТ: поиск по дереву, 30 вхождений в одном файле]; реальные тексты захардкожены и смешаны
  («Topics», «Log in», «Популярное») [ФАКТ: `header.vue:46,88`, `Popular.vue:159`].
- Тема: `@nuxtjs/color-mode` подключён (класс `dark` на `html`) [ФАКТ: `nuxt.config.ts:57-62`],
  и параллельно собственный `useTheme` пишет `localStorage.theme` и тот же класс
  [ФАКТ: `composables/useTheme.ts:1-46`]; `useColorMode` нигде не вызывается [ФАКТ: поиск].
  Тёмная палитра в `main.css` объявлена для `body.dark` [ФАКТ: `main.css:364`], класс ставится
  на `html` — переопределение мёртвое.
- Middleware `auth.global.ts` и `admin.ts` — пустые функции с закомментированным телом
  [ФАКТ: оба файла целиком].
- Пользовательская страница ошибки названа `error-t.vue` [ФАКТ: `web/app/error-t.vue`] и потому
  Nuxt её не использует [ДОПУЩЕНИЕ: соглашение Nuxt об `error.vue`].
- SEO: `useHead` только на `fonts-showcase.vue:264`, `useSeoMeta` нигде; sitemap, RSS, OG,
  canonical, hreflang отсутствуют [ФАКТ: поиск; `nuxt.config.ts`]; `robots.txt` разрешает всё
  [ФАКТ: `web/public/robots.txt`].

### 5.5. Дизайн-система: что реально есть

- Четыре локальные гарнитуры в `assets/fonts` с `@font-face`: Bergamasco (10 начертаний),
  Cormorant SC (5), Garamond Libre (3), Waterway (1) [ФАКТ: `main.css:4-187`, дерево `assets/fonts`].
- Токены `@theme`: палитры `primary` и `secondary` **идентичны** (оба оранжевые), `accent`,
  `success` (с чужеродным `#22d3ee` на 500), `warning`, `error`, `neutral`; шрифтовые токены
  `--font-inter/poppins/roboto/open-sans` без подключённых шрифтов [ФАКТ: `main.css:189-284`].
  Автозагрузку Google-шрифтов через `@nuxt/fonts` из CSS-переменных считаю неподтверждённой
  [ДОПУЩЕНИЕ].
- Базовая типографика закомментирована целиком [ФАКТ: `main.css:286-359`]. Компоненты используют
  утилиты `zinc-*` напрямую, а не токены палитры [ФАКТ: `app.vue:5`, `header.vue:29-36`,
  `MegaMenu.vue`].
- FishtVue используется только в админке (таблицы, формы, split, меню) [ФАКТ: поиск
  `#fishtvue`: 8 вхождений, все в `pages/admin/**` и `components/admin/header.vue`]; публичный
  сайт собран на голом Tailwind.
- `NuxtImg` в 10 компонентах [ФАКТ: поиск]; для внешних картинок — `picsum.photos`,
  `unsplash`, `cdn.theatlantic.com`.

### 5.6. Прод-сборка и изображения (проверено запуском)

Сборка `web/.output` от 2026-09-05 19:36 на локальном Node `v24.12.0`:

| Проба | Результат |
|---|---|
| `/`, `/ru`, `/tags`, `/authors`, `/me`, `/admin`, `/components-showcase`, `/popular` | **500** на всех: `SyntaxError: The requested module 'vue' does not provide an export named 'default'` в `.output/server/chunks/build/server.mjs:1` |
| `/_ipx/_/images/Art.png`, `/_ipx/_/images/Sport.png`, `/_ipx/w_200/images/Art.png` | **500** `[IPX_ERROR] Something went wrong installing the "sharp" module … Cannot find module '../build/Release/sharp-darwin-arm64v8.node'` |
| `/images/Art.png` | **200** — статический файл цел |

То есть «дефект IPX» из предыдущего среза — это отсутствующий нативный бинарник `sharp` в
собранном `.output/server/node_modules`, а не проблема статики. Причина падения SSR (ESM-интероп
`vue` под Node 24) требует отдельной диагностики: возможно, сборка сделана с другой версией
Node или пакетов [ДОПУЩЕНИЕ]. Dev-режим здесь не запускался.

---

## 6. Инженерная база

- **Тестов нет**: ни файлов `*.test.*`/`*.spec.*`, ни конфигов Vitest/Playwright
  [ФАКТ: `git ls-files | grep -iE 'vitest|playwright|\.test\.|\.spec\.'` пуст]; `pnpm test`
  выполняет `pnpm -r test`, у пакетов скрипта `test` нет, результат — exit 0
  [ФАКТ: лог `pnpm test`: «Scope: 2 of 3 workspace projects»].
- **`pnpm lint` падает**: ESLint веба сканирует `web/.output` (в `ignores` есть `dist` и
  `.nuxt`, но нет `.output`) и находит 1754 «ошибки» в сборке плюс одну настоящую
  (`pages/types/index.vue:105`) [ФАКТ: `web/eslint.config.mjs:8`, лог `pnpm lint`].
- **`pnpm format` падает** на четырёх файлах веба [ФАКТ: лог: `admin/header.vue`,
  `article/text.vue`, `layouts/admin.vue`, `pages/authors/index.vue`].
- **`tsc --noEmit` сервера проходит** [ФАКТ: exit 0].
- **Pre-commit** выполняет `npm run format && npm run lint && npm run test`
  [ФАКТ: `.husky/pre-commit`], где `format` — проверка, а не форматирование; при текущем
  состоянии хук не пропустит ни один коммит без `--no-verify`.
- **CI** [ФАКТ: `.github/workflows/pull_request.yml`]: только PR в `app`; Node 20 при локальном
  24; pnpm `10.13.1` при `packageManager` `10.18.3` в корне и `10.12.4` в `server`
  [ФАКТ: `package.json:35`, `server/package.json:22`]; веб не собирается и не типизируется;
  сервер собирается с фиктивными `DATABASE_URL`/`REDIS_URL`, а старт проверяется как
  `timeout 2s pnpm start || true` [ФАКТ: `:64-65`].
- **Деплой**: манифестов нет (`git ls-files | grep -iE 'vercel|render|docker|fly|Procfile'`
  пуст) при том, что README обещает Vercel и Render; health-check, процедуры миграции с
  данными, отката и восстановления отсутствуют.
- **Окружения**: `server/.env` и `web/.env` игнорируются [ФАКТ: `git check-ignore`];
  `env.example` и `ENV_SETUP.md` актуальны [ФАКТ: сверены с кодом].
- **Лицензия**: `LICENSE` — MIT, `package.json` — `"license": "ISC"` [ФАКТ: `LICENSE:1`,
  `package.json:34`].

---

## 7. Документация: что устарело

| Документ | Вердикт | Почему |
|---|---|---|
| `README.md` | Устарел по позиционированию и по стеку | Описывает только открытый контур; обещает MDC-редактор, Vitest, Vercel/Render — ничего из этого в коде нет |
| `docs/architecture/database_architecture.md` | Устарел полностью | Целочисленные `id`, `password_hash`, `published: bool`, поле `content` — ни одного совпадения со схемой |
| `docs/status/api_implementation_status.md` | Вводит в заблуждение | «100%» по всем разделам при дефектах §3.4; ссылки на `test_*.graphql`, которых нет; раздел «Аутентификация 0%» при существующих резолверах |
| `docs/status/web_implementation_status.md` | Противоречив | В шапке 0% по всем разделам, внутри — отмеченные пункты; описывает планы как статус |
| `docs/status/graphql_queries_structure.md` | Устарел | Описывает `GET_FEATURED_ARTICLES`, `GET_ARTICLE_PAGE`, `GET_AUTHOR` и др., которых нет в `web/app/query`; пример `$fetch('/api/graphql')` — такого эндпоинта нет |
| `docs/status/README.md` | Противоречив | Api 100% и web 0% в одном файле |
| `docs/guides/admin_query_standards.md` | Частично актуален | Поля `status`/`search` в `BaseFiltersInput` и TTL 2 минуты не совпадают с кодом; имена `adminArticles` вместо `articles` |
| `docs/guides/fonts-guide.md` | Устарел | Google-шрифты через `nuxt.config` не настроены; «Georgia временно» при подключённых локальных гарнитурах; классов `text-inter` не существует |
| `docs/guides/article_workflow.md` | В основном актуален | Неверно утверждение, что черновики видны только автору и админам; `permanentlyDeleteArticle` не существует |
| `docs/guides/authentication_guide.md` | Актуален | Совпадает с кодом, включая magic link в консоли |
| `docs/queries/**` | Частично | 29 из 85 операций невалидны; README утверждает обратное |
| `docs/reports/*` (6 файлов) | Исторические | Оставить как есть |
| `server/ENV_SETUP.md`, `server/env.example` | Актуальны | |
| `web/README.md` | Шаблон Nuxt | Не относится к проекту |
| `altera-project-summary-2026-09-05.md` | В основном подтверждён | См. §8 |

---

## 8. Проверка предыдущего среза

Подтверждено лично: отсутствие клиента и запросов, «10 из 35» валидных операций (совпало
точно), утечка черновиков и e-mail, закомментированные middleware, отсутствие refresh/logout,
magic link в логе, отсутствие rate limit, отсутствие тестов, `timeout 2s … || true` в CI,
`prisma:seed` на несуществующий файл, ключ админского кеша без поискового запроса, `KEYS` при
инвалидации, `viewCount = 0`, `CreateContentTypeInput.status = ACTIVE`, дефолт `Role` в
миграции.

Уточнения:

- «Admin WIP (current branch, uncommitted)» — уже закоммичено (`6d985b7`, `e757364`, `e1b9a97`).
- «`/_ipx/...` возвращает 500 из-за дефекта IPX/статики» — причина конкретнее: отсутствует
  бинарник `sharp` в сборке; статика отдаётся.
- Не упомянуто в срезе: прод-сборка веба не работает под Node 24 целиком; роль `editor` без
  прав; `reader` создаёт статьи; `author(slug)` только для `role = author`; слаг пользователя из
  e-mail; TTL админского кеша 6 часов; `pnpm lint` падает из-за `.output`; три словаря ролей.
- «Web typecheck fails — vue-tsc not installed» — не перепроверялось [НЕ ПРОВЕРЕНО].

---

## 9. Сводная таблица

| Подсистема | Работает | Заглушка | Нет вообще |
|---|---|---|---|
| Схема данных | 5 моделей, 3 enum, 4 миграции | — | медиа, версии, переводы, подборки, SEO, комментарии, подписки, платежи, аудит, сессии, просмотры |
| API: публичное чтение | материал, автор, рубрика, тег, главная (кроме смысла «избранного/популярного») | «избранное» = последние, «популярное» = свежие | публичный список рубрик, поиск, теги для навигации |
| API: авторский цикл | create/update/archive/requestReview/revertToDraft, `me`, статистика | — | список своих статей, удаление, профиль, медиа |
| API: админка | списки с фильтрами, статусы, bulk, CRUD рубрик и тегов, merge тегов | — | роли, блокировки, аудит, модерация |
| Аутентификация | magic link + JWT | письмо в консоль | refresh, logout, отзыв, rate limit, сессии |
| Права | `ensureAuthenticated`/`ensureHasRole` в резолверах | — | права `editor`, разграничение `reader`/`author`, защита черновиков и e-mail |
| Кеш | Redis, TTL 6 ч | инвалидация частичная, `KEYS` | деградация без Redis |
| Веб: оболочка | шапка, мега-меню, футер, тема, шрифты, карточки, админские таблицы | все данные — фикстуры | GraphQL-клиент, адрес API, страницы входа, кабинет, редактор, страница материала |
| Веб: защита | — | middleware пустые | — |
| i18n | конфиг и словари | применён на демо-странице | переводы интерфейса и контента |
| SEO | `robots.txt` | — | meta, canonical, sitemap, RSS, OG, hreflang |
| Инженерия | `tsc` сервера, ESLint-конфиг, Prettier, commitlint, husky | CI «зелёный» ни о чём | тесты, честный CI, сиды, деплой, откат, бэкапы, логи, метрики |
| Документация | `authentication_guide`, `ENV_SETUP`, `article_workflow` (почти) | `admin_query_standards` | остальное устарело или противоречиво |

---

## 10. Дополнение по итогам осмотра компонентов веба

Добавлено 2026-09-05 после детального осмотра `web/app/components/**`, `web/app/pages/**`,
`web/node_modules/fishtvue` и папок `.cursor/`, `.qoder/`.

- **FishtVue 0.2.11 — собственная библиотека владельца** [ФАКТ: `web/node_modules/fishtvue/package.json`,
  автор совпадает с автором проекта]: 23 виджета (Accordion, Alert, Badge, Button, Calendar,
  Dialog, Form, Input, Menu, Pagination, Select, Split, Switch, Table, TextEditor и др.), три
  темы, режимы `filled/outlined/underlined`; типографических и «редакционных» компонентов
  нет. В `web/app` импортируются только типы (`#fishtvue/table|form|split`) в четырёх
  админских страницах. `TextEditor` — обёртка над Quill 2 (`@vueup/vue-quill`) с выводом
  Delta/HTML/text в диалоге [ФАКТ: `fishtvue/texteditor/TextEditor.d.ts`].
- **Фактические роли гарнитур**: Bergamasco — только логотип [ФАКТ: `components/visual/Logo.vue:27`];
  Waterway — H1 страниц и H2 секций [ФАКТ: `components/header/tag.vue:15`, `pages/start/Popular.vue:158`];
  Garamond Libre — заголовки и деки всех карточек; Cormorant SC — подпись автора
  [ФАКТ: `components/show/Author.vue:12`]; `font-sans` — кикер типа, дата, навигация;
  `font-serif` — кнопки «read more» и «Follow»; `font-mono` — только отладочные компоненты.
- **Шесть несовместимых схем горизонтальных отступов** при одном контейнере `max-w-7xl`:
  `px-3 lg:px-10` (шапка), `px-6 lg:px-8` (футер), `px-8` (секции главной), `px-8 sm:px-10`
  (шапки страниц), `px-4 sm:px-6 lg:px-8` (теги), `container px-4` (демо) — секции не
  выравниваются ни на одном breakpoint.
- **Мёртвый код**: `components/article/featured.vue` (0 использований), вся папка
  `components/demo/` (4 файла, 0 использований); `article/type.vue` и `article/author.vue` —
  почти дубликаты с разными типами пропсов; `ref="bottomRef"` без объявления в `base.vue:29`,
  `small.vue:23`; `{{ $t("test") }}` в `pages/components-showcase.vue:172`.
- **Устаревший API Nuxt**: `process.client` в `composables/useBreakpoint.ts` и других
  composables (8 вхождений) вместо `import.meta.client` — в Nuxt 4 удалён, поэтому
  `getBreakpoint()` может всегда возвращать SSR-значение `"lg"` [ДОПУЩЕНИЕ по поведению].
- **Два механизма темы**: `nuxt.config.ts:44` задаёт FishtVue `darkModeSelector: "html.dark"`,
  `main.css:364` переопределяет палитру для `body.dark`, `useTheme` пишет свой ключ в
  `localStorage`.
- **Футер** [ФАКТ: `components/app/footer.vue`]: статичный шаблон — колонки «Solutions /
  Support / Company / Legal» со ссылками на `#`, соцсети на `#`, «© 2024 Your Company, Inc.»,
  ссылки «Fonts» → `/fonts-showcase` и «Admin» → `/admin` в разделе Legal; без i18n.
- **Фикстуры с чужим контентом**: дословная биография автора The Atlantic (~2 700 знаков) в
  `pages/authors/[slug].vue:17` и `pages/[slugTypeContent]/index.vue:15`; hotlink на
  `cdn.theatlantic.com` в `components/visual/MegaMenu.vue:117` и `pages/[slugTypeContent]/index.vue:19`.
- **`.cursor/`** содержит правила для AI-ассистента, описывающие продукт как MDC-платформу;
  `settings.json` объявляет `api: RESTful`, `rules` — GraphQL: файлы противоречат друг другу и
  коду. `.qoder/` — пустая папка `quests/`. Упоминаний The Atlantic в них нет; «вдохновлена
  The Atlantic» — комментарий в `main.css:286` и записи в `docs/status/*`.

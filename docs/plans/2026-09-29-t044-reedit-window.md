# T-044: перередактирование после автопубликации — одноразовое окно

**Цель:** автор (и `editor` по редакционным статьям) в течение часа после автопубликации может
один раз самостоятельно снять свою версию с публикации и вернуться в черновик; повторная подача
снова идёт через AI. После первого использования кнопка недоступна навсегда, даже если версия
опубликуется заново; по истечении часа — тоже недоступна.

**Источник:** `docs/backlog/tasks/T-044-reedit-window.md`, `docs/spec/10-flows/write-and-publish.md`
§4, `docs/spec/00-registries/access-matrix.md` #100, `docs/spec/00-registries/events-and-logs.md`
#45, #72, `docs/spec/30-account/author/articles.md` §4, журнал #9.

**Стек:** обвязка редактора T-040 (`server/src/translation/editor.ts`) — тот же модуль, что и
`submitTranslation`/`withdrawTranslation`; окно и разовость уже подготовлены T-049 (поля
`ArticleTranslation.reeditUntil`/`reeditedAt`, `server/src/ai/service.ts` ставит `reeditUntil` на
`publishedAt + 1ч` при автопубликации) и аудит-реестр (`translation.reedit` уже в
`server/src/audit/registry.ts` зоной `ADMIN_ONLY`).

## Границы

- Входит: мутация `reeditTranslation`, проверка часового окна и разовости (`reeditedAt`),
  переход `published → draft`, аудит `translation.reedit` с `withinWindowSec`, лог
  `translation.reedit`, сброс кеша публичной страницы.
- Не входит: кнопка на `/me/articles` и на странице материала (мутации в API не было — блокировал
  весь фронтенд-показ, см. `web/app/components/me/AttentionList.vue`; фронтенд — отдельная задача
  эпика E-07), письмо-уведомление сверх уже отправляемого T-051 (`article_published` не упоминает
  окно текстом — продуктовый текст писем целиком `[ДОПУЩЕНИЕ]` до прохода почты, журнал §25.13, и
  вне критериев этой задачи), токен-ссылка `edit?token=` — она нужна только письмам о доработке и
  снятии ревьюером (T-051), а не самостоятельному нажатию залогиненного автора на `/me/articles`.

## Архитектура

- `server/src/translation/editor.ts` — новая экспортируемая `reeditTranslation(ctx, id, now?)` в
  ряду `submitTranslation`/`withdrawTranslation`: та же авторизация (`ensureEditorActor` +
  `ensureOwnTranslationMutation` — автор с активным планом по своим, `editor` по редакционным,
  ровно как в access-matrix #100), та же блокировка строки (`lockTranslation`), тот же паттерн
  `updateMany` с проверкой `count === 1` под `CONFLICT` при гонке.
- Предикат `canReedit` — `status === "published" && !rejected && reeditedAt === null &&
reeditUntil !== null && now <= reeditUntil`; отказ — `FORBIDDEN` (двух исходов «окно закрыто» и
  «уже использовано» текст ошибки не различает — как в access-matrix #100/articles.md §4).
- Переход пишет `status: draft`, `publishedAt: null`, `reeditUntil: null`, `reeditedAt: now`;
  `reeditedAt` не сбрасывается никогда — повторная автопубликация той же версии новое окно не
  открывает (журнал #9: «доступно только один раз»).
- Зеркало `articles` (`mirrorLegacyArticle`) и `Article.publishedAt` обновляются той же
  транзакцией для версии исходной локали — тем же способом, что `withdrawTranslation` и
  `unpublishReview` (`server/src/review/queue.ts`).
- Аудит `translation.reedit` пишется в той же транзакции с `diff: { translationId,
withinWindowSec }` — поля ровно по реестру событий #72; зона аудита не меняется (уже
  `ADMIN_ONLY` в `server/src/audit/registry.ts`, добавлена заранее).
- Кеш публичной страницы сбрасывается `buildArticleCacheTags(current.article)` после транзакции —
  как в `ai/index.ts` (`onPublished`) и `unpublishReview`.
- GraphQL: `reeditTranslation(id: ID!): EditorTranslation!` в
  `server/src/graphql/translation/schema.graphql` и тонкая обвязка в `resolver.ts`, по образцу
  `submitTranslation`/`withdrawTranslation`.

## Проверяемые риски

- Второй вызов той же мутации после первого успешного — `FORBIDDEN` (критерий 1).
- Вызов после истечения часа — `FORBIDDEN`, даже если `reeditedAt` ещё не установлен (критерий 2).
- Чужая версия — `FORBIDDEN` до перехода (как во всех мутациях редактора).
- Версия не в статусе `published` (черновик, на проверке, снята ревьюером, в архиве) — `FORBIDDEN`,
  а не тихий проход.
- Гонка двух параллельных вызовов — `CONFLICT` внутри транзакции (`updateMany` не находит строку).

## Проверка

`pnpm format`, `pnpm lint`, `pnpm --filter server exec tsc --noEmit`, `pnpm --filter server test`,
`pnpm --filter nuxt-app exec vitest run tests/graphql-operations.test.ts` (веб-операции остаются
валидны против расширенной серверной схемы).

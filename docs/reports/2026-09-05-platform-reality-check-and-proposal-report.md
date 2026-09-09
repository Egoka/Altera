# Отчёт: Срез реальности и предложение целевой архитектуры Altera

- **Дата**: 2026-09-05
- **План**: docs/plans/2026-09-05-platform-reality-check-and-proposal.md
- **Ветка**: server/api
- **Коммиты**: не создавались — результат ожидает подтверждения владельца, файлы лежат в
  рабочем дереве поверх `8cb987c`
- **Результат**: выполнено полностью

## Что сделано

1. **Срез реальности** — `docs/vision/00-reality-check.md`. Прочитаны схема Prisma и четыре
   миграции, все `schema.graphql` и пять резолверов, `server.ts`, `redis.ts`, `prisma.ts`,
   `permissions.ts`, `utils/admin.ts`, `nuxt.config.ts`, `main.css`, оба middleware, layouts,
   все страницы, ключевые компоненты, CI, хуки, вся `docs/`, `README.md`, предыдущий срез.
   Каждое утверждение снабжено ссылкой `файл:строка` или пометкой допущения. Отдельно
   перечислено, что проверено лично, а что принято со слов документов.
2. **Вопросы владельцу** — `docs/vision/99-open-questions.md`: семь вопросов, меняющих
   архитектуру (хостинг данных и 152-ФЗ; режим публикации в открытом контуре; модель
   контента; языки и URL; права редактора и удаление автора; таксономия и адреса; первый
   платный продукт и провайдер), каждый с вариантами, рекомендацией и ценой промедления;
   плюс 17 решений по умолчанию, требующих только возражения.
3. **Предложение целевой архитектуры** — черновик `docs/vision/02-target-architecture.md`:
   принципы, схема системы, двенадцать дорогих в изменении решений (будущие ADR), целевое
   устройство восьми контуров, семь этапов-состояний с оценками, граф зависимостей, точки
   решений владельца, сценарий деградации, список сознательных отказов, чек-лист подтверждения.
4. **Остановка** перед детализацией роадмапа и ADR, как требует шаг 4 промта.

## Что не сделано и почему

- `docs/vision/01, 03–08`, `docs/issues/*`, `docs/decisions/*` — по плану создаются только
  после подтверждения архитектуры и состава этапов.
- Не проверялись: работа веба в dev-режиме (`nuxt dev`), `nuxi typecheck`, содержимое базы
  Neon. Первые два — потому что прод-сборка упала раньше и тратить время на dev-режим для
  среза не требовалось; база — принципиально не подключался.
- Код приложения, миграции и задачи не создавались (запрет промта).

## Отклонения от плана

- Файл плана сохранён в той же сессии, что и начало чтения кода, а не заранее: срез реальности
  начался до записи плана. По содержанию отклонений нет.
- Первый прогон скрипта валидации исключал файл `web/app/query/admin/types.ts` из-за
  неточного фильтра имён (`types.ts$`), результат был 29/7. Фильтр исправлен, итог 35/10 —
  он и попал в документы.
- Хук trace-mcp блокировал чтение фрагментов резолверов через `sed`; фрагменты прочитаны
  инструментом Read по диапазонам строк из `get_outline`.

## Затронутые файлы

- `docs/plans/2026-09-05-platform-reality-check-and-proposal.md` — новый (статус обновлён на
  «завершён»).
- `docs/vision/00-reality-check.md` — новый.
- `docs/vision/99-open-questions.md` — новый.
- `docs/vision/02-target-architecture.md` — новый, черновик.
- `docs/reports/2026-09-05-platform-reality-check-and-proposal-report.md` — этот отчёт.
- Пустые каталоги `docs/issues/`, `docs/decisions/` созданы, в git не попадают до появления
  файлов.

## Как проверено

Окружение: `node v24.12.0`, `pnpm 10.18.3`, macOS arm64.

### Валидация операций фронта и тестовых запросов

Скрипт (запуск из `server/`, чтобы разрешились `graphql` и `@graphql-tools/*`):

```bash
NODE_PATH=$PWD/node_modules node validate-ops.js /Users/egorbondarenko/WebstormProjects/Altera
```

```js
// validate-ops.js
const fs = require("fs"), path = require("path")
const { parse, validate, buildASTSchema } = require("graphql")
const { mergeTypeDefs } = require("@graphql-tools/merge")
const { loadFilesSync } = require("@graphql-tools/load-files")
const root = process.argv[2]
const schema = buildASTSchema(mergeTypeDefs(loadFilesSync(path.join(root, "server/src/graphql"), { extensions: ["graphql"] })))
const walk = (d, o = []) => (fs.readdirSync(d).forEach((i) => (fs.statSync(path.join(d, i)).isDirectory() ? walk(path.join(d, i), o) : o.push(path.join(d, i)))), o)
const result = { web: { total: 0, ok: 0, rows: [] }, docs: { total: 0, ok: 0, rows: [] } }
for (const f of walk(path.join(root, "web/app/query")).filter((f) => f.endsWith(".ts") && !/query\/index\.ts$|query\/types\.ts$/.test(f))) {
  const re = /export const (\w+) = `([\s\S]*?)`/g; let m
  while ((m = re.exec(fs.readFileSync(f, "utf8")))) {
    result.web.total++; let errors
    try { errors = validate(schema, parse(m[2])).map((e) => e.message) } catch (e) { errors = ["PARSE: " + e.message] }
    if (!errors.length) result.web.ok++
    result.web.rows.push({ file: path.relative(root, f), name: m[1], errors })
  }
}
for (const f of walk(path.join(root, "docs/queries")).filter((f) => f.endsWith(".graphql"))) {
  const doc = parse(fs.readFileSync(f, "utf8"))
  for (const def of doc.definitions.filter((d) => d.kind === "OperationDefinition")) {
    result.docs.total++
    const errors = validate(schema, { kind: "Document", definitions: [def, ...doc.definitions.filter((d) => d.kind === "FragmentDefinition")] }).map((e) => e.message)
    if (!errors.length) result.docs.ok++
    result.docs.rows.push({ file: path.relative(root, f), name: def.name?.value, errors })
  }
}
console.log(JSON.stringify(result, null, 2))
```

Результат: `web_total 35, web_ok 10, docs_total 85, docs_ok 56`.

Валидные операции фронта: `GET_HOME_PAGE_ARTICLES`, `GET_MY_PROFILE`, `GET_USER_MENU`,
`CREATE_ARTICLE`, `UPDATE_ARTICLE`, `CREATE_TAG`, `UPDATE_TAG`, `CREATE_CONTENT_TYPE`,
`UPDATE_CONTENT_TYPE`, `ARCHIVE_CONTENT_TYPE`.

Невалидные операции фронта (файлы относительно `web/app/query/`):

| Файл | Операция | Ошибки валидации |
|---|---|---|
| `admin/articles.ts` | `GET_ADMIN_ARTICLES` | Cannot query field 'adminArticles' on type 'Query'; Cannot query field 'articlesStats' on type 'Query' |
| `admin/articles.ts` | `CHANGE_ARTICLE_STATUS` | Cannot query field 'changeArticleStatus' on type 'Mutation'. Did you mean 'setArticleStatus'? |
| `admin/articles.ts` | `BULK_DELETE_ARTICLES` | Cannot query field 'deletedCount' on type 'Article' |
| `admin/tags.ts` | `GET_ADMIN_TAGS` | Cannot query field 'adminSectionTags' on type 'Query'. Did you mean 'sectionTags'? |
| `admin/tags.ts` | `DELETE_TAG` | Cannot query field 'success' on type 'SectionTag' |
| `admin/tags.ts` | `MERGE_TAGS` | Unknown arguments 'sourceTagId', 'targetTagId'; fields 'success', 'articlesUpdated' don't exist on 'SectionTag'; argument 'input: MergeTagsInput!' is required |
| `admin/types.ts` | `GET_ADMIN_CONTENT_TYPES` | Cannot query field 'adminContentTypes' on type 'Query' |
| `admin/types.ts` | `DELETE_CONTENT_TYPE` | Cannot query field 'success' on type 'ContentType' |
| `admin/types.ts` | `REORDER_CONTENT_TYPES` | Unknown type 'ContentTypeOrderInput'; unknown argument 'orders'; field 'success' doesn't exist; argument 'input: ReorderContentTypesInput!' is required |
| `common/auth.ts` | `REQUEST_MAGIC_LINK` | Field 'requestMagicLink' must not have a selection since type 'Boolean!' has no subfields |
| `common/auth.ts` | `VERIFY_MAGIC_LINK` | Cannot query field 'token' on type 'AuthPayload' |
| `common/auth.ts` | `LOGOUT` | Cannot query field 'logout' on type 'Mutation' |
| `common/auth.ts` | `UPDATE_PROFILE` | Unknown type 'UpdateProfileInput'; Cannot query field 'updateProfile' on type 'Mutation' |
| `common/auth.ts` | `REFRESH_TOKEN` | Cannot query field 'refreshToken' on type 'Mutation' |
| `common/navigation.ts` | `GET_NAVIGATION` | Unknown argument 'status' on 'Query.contentTypes'; fields 'id/name/slug/order' don't exist on 'ContentTypesResponse'; required arguments 'pagination', 'sort', 'filters' not provided; Cannot query field 'popularTags' on type 'Query' |
| `common/search.ts` | `SEARCH_ARTICLES` | Cannot query field 'searchArticles' on type 'Query' |
| `common/search.ts` | `SEARCH_SUGGESTIONS` | Cannot query field 'searchSuggestions' on type 'Query' |
| `common/search.ts` | `ADVANCED_SEARCH` | Cannot query field 'advancedSearch' on type 'Query' |
| `me/articles.ts` | `GET_MY_ARTICLES` | Cannot query field 'myArticles' on type 'Query' |
| `me/articles.ts` | `GET_ARTICLE_FOR_EDIT` | Cannot query field 'articleForEdit' on type 'Query'; `contentTypes`/`sectionTags` queried как списки без обязательных `pagination/sort/filters` и с полями, которых нет на `ContentTypesResponse`/`TagsResponse` |
| `me/articles.ts` | `DELETE_ARTICLE` | Cannot query field 'deleteArticle' on type 'Mutation' |
| `pages/articles/detail.ts` | `GET_ARTICLE` | Unknown argument 'slug' on 'Query.relatedArticles'; argument 'articleSlug: String!' is required |
| `pages/authors/detail.ts` | `GET_AUTHOR_PAGE` | Cannot query field 'authorArticles' on type 'Query'; Field 'popularTags' of type '[SectionTag!]' must have a selection of subfields |
| `pages/tags/detail.ts` | `GET_TAG_PAGE` | Cannot query field 'sectionTag' on type 'Query'; Cannot query field 'tagArticles' on type 'Query' |
| `pages/types/detail.ts` | `GET_CONTENT_TYPE_PAGE` | Cannot query field 'contentTypeArticles' on type 'Query' |

Тестовые запросы `docs/queries` (операций / валидных / невалидные по имени):

| Файл | Всего | Валидно | Невалидные |
|---|---|---|---|
| `docs/queries/admin/article.graphql` | 17 | 4 | GetAdminArticlesBasic, GetAdminArticlesByStatus, GetAdminArticlesSearch, GetAdminArticlesByAuthor, GetAdminArticlesByContentType, GetAdminArticlesByTags, GetAdminArticlesByPublishDate, GetAdminArticlesComplex, SetArticleStatus, BulkUpdateArticleStatus, ArchiveArticle, SetArticleToDraft, SetArticleToReview |
| `docs/queries/admin/content_type.graphql` | 18 | 11 | GetAdminContentTypesBasic, GetAdminContentTypesByStatus, GetAdminContentTypesSearch, GetAdminContentTypesComplex, CreateContentType, UpdateContentTypeStatus, GetAdminArchivedContentTypes |
| `docs/queries/admin/tag.graphql` | 16 | 13 | GetAdminTagsBasic, GetAdminTagsSearch, GetAdminTagsComplex |
| `docs/queries/admin/user.graphql` | 10 | 5 | GetAdminUsersBasic, GetAdminUsersByRole, GetAdminUsersSearch, GetAdminUsersComplex, GetAdminReaders |
| `docs/queries/author/author.graphql` | 4 | 4 | — |
| `docs/queries/common/article.graphql` | 6 | 6 | — |
| `docs/queries/common/content_type.graphql` | 4 | 4 | — |
| `docs/queries/common/main.graphql` | 6 | 5 | getAllArticles |
| `docs/queries/common/tag.graphql` | 4 | 4 | — |

Типовые причины в `docs/queries`: enum в верхнем регистре (`PUBLISHED`, `ACTIVE`, `AUTHOR`),
поля `status`/`search` в `BaseFiltersInput`/`BaseFiltersInfo`, которых нет в схеме.

### Сборка и проверки

| Команда | Результат |
|---|---|
| `cd server && npx tsc --noEmit` | exit 0 |
| `pnpm lint` | падает: ESLint веба сканирует `web/.output` (1754 проблемы) плюс `web/app/pages/types/index.vue:105` `'mockStats' is assigned a value but never used`; `ERR_PNPM_RECURSIVE_EXEC_FIRST_FAIL … web: eslint .` |
| `pnpm test` | exit 0, «Scope: 2 of 3 workspace projects», ни одного теста |
| `pnpm format` | падает: `app/components/admin/header.vue`, `app/components/article/text.vue`, `app/layouts/admin.vue`, `app/pages/authors/index.vue` |

### Прод-сборка веба

Запуск `PORT=3101 node web/.output/server/index.mjs` (сборка от 2026-09-05 19:36) и
`curl -s -o /dev/null -w '%{http_code}'` по маршрутам:

| Маршрут | Код | Причина |
|---|---|---|
| `/`, `/ru`, `/popular`, `/latest`, `/login`, `/auth/verify`, `/me`, `/admin`, `/authors`, `/tags`, `/types`, `/components-showcase` | 500 | `SyntaxError: The requested module 'vue' does not provide an export named 'default'` в `.output/server/chunks/build/server.mjs:1` |
| `/_ipx/_/images/Art.png`, `/_ipx/_/images/Sport.png`, `/_ipx/w_200/images/Art.png` | 500 | `[IPX_ERROR] Something went wrong installing the "sharp" module … Cannot find module '../build/Release/sharp-darwin-arm64v8.node'` |
| `/images/Art.png` | 200 | статический файл цел |

### Прочее

- `git ls-files | grep -iE 'vercel|render\.ya?ml|docker|fly\.toml|Procfile|\.nvmrc|vitest|playwright|\.test\.|\.spec\.'` — пусто.
- `git check-ignore -v server/.env web/.env server/dist web/.output` — все четыре игнорируются.
- `git log -1 --date=short -- server/src` → `de14a2a 2025-08-02`; `-- server/prisma/schema.prisma`
  → `f3e53bc 2025-07-27`; `-- web/app` → `6d985b7 2026-09-05`; всего коммитов 57.

## Что осталось

1. Ответы владельца на A1–A7 и возражения по B1–B17 в `docs/vision/99-open-questions.md`.
2. Подтверждение состава этапов 0–6 и списка решений D1–D12 в
   `docs/vision/02-target-architecture.md`.
3. После этого — новый план в `docs/plans/` на детализацию: `docs/vision/01, 03–08`,
   `docs/issues/00-roadmap.md` и файлы этапов, ADR в `docs/decisions/`, финальная версия
   `02-target-architecture.md`.

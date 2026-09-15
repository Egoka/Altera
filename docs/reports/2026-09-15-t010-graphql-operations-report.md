# T-010: отчёт о переносе GraphQL-операций фронта

- **Задача:** T-010 / ALTE-21
- **План:** `docs/plans/2026-09-15-t010-graphql-operations.md`
- **Базовый коммит:** `53ee9b4b5e2f4436ff03774fbd1cbcc000ded466`
- **Ветка:** `web/t010-graphql-operations`
- **Worktree:** `/Users/egorbondarenko/WebstormProjects/Altera/.worktrees/t010-graphql-operations`

## Результат

- 28 операций, которые можно выразить текущей SDL, перенесены из TypeScript-строк в 12 файлов
  `web/app/graphql/operations/**/*.graphql`.
- Невалидные имена полей, аргументы и payload-и переписаны под текущие `articles`, `sectionTags`,
  `contentTypes`, `articlesByAuthor`, `articlesByTag`, `articlesByContentType`,
  `setArticleStatus`, `MergeTagsInput` и `ReorderContentTypesInput`.
- `DELETE_ARTICLE` вызывает обратимое `archiveArticle` через GraphQL alias.
- Семь операций без соответствующего поля в SDL удалены: `LOGOUT`, `UPDATE_PROFILE`,
  `REFRESH_TOKEN`, `SEARCH_ARTICLES`, `SEARCH_SUGGESTIONS`, `ADVANCED_SEARCH`,
  `GET_MY_ARTICLES`. По данным семантического поиска и точечного поиска имён потребителей у
  этих экспортов не было. Новые серверные поля не добавлялись согласно границам T-010.
- Удалены 13 файлов с ручными строками из `web/app/query/**`. `web/app/query/index.ts` теперь
  реэкспортирует generated `TypedDocumentNode` под прежними именами 28 оставшихся операций.
- `pnpm codegen` обновил только generated GraphQL-артефакты.
- Добавлен Vitest-контракт: он рекурсивно читает `web/**/*.graphql`, исключает generated-копию
  SDL `web/app/graphql/generated/schema.graphql`, объединяет executable definitions и валидирует
  их против `server/src/graphql/**/*.graphql` полным стандартным набором правил GraphQL.
  Fragments T-008 используются новыми операциями и также проходят эту проверку.

## TDD evidence

1. Первый запуск до установки зависимостей завершился ошибкой среды `vitest: command not found`;
   он не засчитан как RED. `pnpm install --frozen-lockfile` завершился exit 0.
2. После установки `pnpm --filter nuxt-app test -- graphql-operations.test.ts` завершился exit 1:
   `no GraphQL operations found under web/**/*.graphql`, найдено 0 операций. Отрицательная проба
   неизвестного поля при этом прошла.
3. После переноса та же команда завершилась exit 0: 11 test files, 75 tests passed.
4. Временный `web/app/graphql/operations/invalid-probe.graphql` с полем
   `fieldThatDoesNotExist` дал exit 1 и точную ошибку `Cannot query field ... on type "Query"`.
   После удаления probe повторный прогон завершился exit 0: 75 tests passed.

## Как проверено

Все команды выполнены в указанном worktree. Локально доступен Node `v24.3.0`, тогда как
`package.json` требует `24.12.0`; pnpm `10.18.3` при каждом запуске печатал engine warning.

| Проверка | Фактический результат |
| --- | --- |
| `pnpm codegen --check` | exit 0; обе generated targets собраны без drift |
| `pnpm format` | первая попытка нашла 2 новых файла; после scoped `prettier --write` повтор — exit 0, оба workspace без замечаний |
| `pnpm lint` | первая попытка: 1 неиспользуемый import в новом тесте; после удаления повтор — exit 0 |
| `pnpm test` | exit 0; server: 10 файлов, 69 passed + 1 todo; web: 11 файлов, 75 passed |
| `pnpm --filter nuxt-app run typecheck` | exit 0; Nuxt prepare и `vue-tsc -b --noEmit` прошли |
| `pnpm --filter nuxt-app run build` | exit 0; client, SSR и Nitro server собраны |
| `git diff --check` | exit 0, ошибок whitespace нет |
| `git grep -n 'export const' -- web/app/query` | exit 1 и пустой stdout: строковых экспортов нет |
| `git grep --untracked -h -E '^(query\|mutation) ' -- web/app/graphql/operations` | exit 0; выведены 28 именованных операций |

Nuxt build напечатал не блокирующие предупреждения: устаревшие данные Browserslist, sourcemap
Tailwind-плагина и отсутствие `sharp` binary для darwin-arm64. Сборка завершилась успешно.

## Соответствие критериям

- **t010-ac1 — PASS локально:** 28 операций валидны против текущей серверной SDL; встроенная и
  файловая отрицательные пробы доказывают падение при неизвестном поле. Тест входит в `pnpm test`
  и, следовательно, в CI job `checks`.
- **t010-ac2 — PASS локально:** `web/app/query/index.ts` содержит только алиасы generated
  документов; ручные строковые файлы удалены, `git grep` не нашёл `export const` в каталоге.

## Отклонение от плана

План предварительно говорил о 13 новых operation-файлах по старой структуре. Создано 12:
`common/search.graphql` не создавался, потому что все три legacy search-операции не имеют полей
в текущей SDL, а пустой GraphQL-файл не является полезным артефактом. Scope и критерии задачи
не изменились.

## Ограничения и следующий этап

- CI ещё не запускался; локальный PASS не заменяет PR checks.
- Реальные HTTP, DB и Redis не проверялись: T-010 меняет только web-документы/generated build input,
  а не серверный runtime.
- Следующая стадия — независимое тестирование commit этой реализации, затем независимое ревью.

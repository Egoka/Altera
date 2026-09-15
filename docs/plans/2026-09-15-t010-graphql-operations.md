# T-010: операции фронта в `.graphql` — план реализации

- **Задача:** T-010 / ALTE-21
- **Базовый коммит:** `53ee9b4`
- **Ветка:** `web/t010-graphql-operations`
- **Источник требований:** `docs/backlog/tasks/T-010-frontend-operations-graphql-files.md`
- **Отчёт:** `docs/reports/2026-09-15-t010-graphql-operations-report.md`

## Цель

Перенести поддерживаемые серверной SDL операции из строковых TypeScript-констант в
`web/app/graphql/operations/**/*.graphql`, переписать их под актуальную схему, сгенерировать
`TypedDocumentNode` и добавить CI-тест, который валидирует весь executable GraphQL-контур веба.

## Архитектура и границы

Единственным источником API-контракта остаются `server/src/graphql/**/*.graphql`, а единственным
источником клиентских документов — `web/app/graphql/**/*.graphql`. Существующий client preset
GraphQL Code Generator создаёт типы и документы в `web/app/graphql/generated/`; вручную generated-файлы
не редактируются. `web/app/query/index.ts` сохраняет прежние публичные имена поддерживаемых операций
как алиасы generated `*Document`, но строк не содержит.

Операции, для которых в SDL нет поля, удаляются, а не маскируются операцией с другой семантикой:
`LOGOUT`, `UPDATE_PROFILE`, `REFRESH_TOKEN`, `SEARCH_ARTICLES`, `SEARCH_SUGGESTIONS`,
`ADVANCED_SEARCH`, `GET_MY_ARTICLES`. Добавлять серверные поля запрещает scope T-010.

## Технологии

TypeScript 5.8, Vitest 5, GraphQL 16, GraphQL Code Generator 7 с client preset 6.

## Задача 1. Контрактный тест GraphQL-документов

**Файлы:**

- создать `web/tests/graphql-operations.test.ts`;
- использовать SDL из `server/src/graphql/**/*.graphql`;
- использовать документы из `web/**/*.graphql`, исключая generated-копию SDL
  `web/app/graphql/generated/schema.graphql`.

- [ ] Написать helper, который рекурсивно и детерминированно собирает `.graphql`-файлы,
  объединяет серверную SDL через `buildSchema`, парсит клиентские документы и вызывает `validate`.
- [ ] Добавить проверку текущих документов с ожидаемым пустым списком ошибок.
- [ ] Добавить отрицательную пробу с `query InvalidOperation { fieldThatDoesNotExist }`, которая
  ожидает ошибку `Cannot query field` и доказывает, что тест падает на невалидной операции.
- [ ] Запустить `pnpm --filter nuxt-app test -- graphql-operations.test.ts` и сохранить RED:
  тест текущих документов обязан упасть после добавления legacy-операций в `.graphql` без исправлений.

## Задача 2. Перенос и исправление операций

**Файлы:**

- создать 13 файлов под `web/app/graphql/operations/`, повторяющих доменную группировку
  `admin`, `common`, `me`, `pages`;
- изменить `web/app/query/index.ts`;
- удалить 13 файлов строковых операций под `web/app/query/{admin,common,me,pages}`;
- перегенерировать `web/app/graphql/generated/*` только командой `pnpm codegen`.

- [ ] Перенести операции, уже валидные против SDL, без изменения выбранных полей.
- [ ] Исправить legacy-имена полей и форму аргументов/ответов: `articles`, `setArticleStatus`,
  `sectionTags`, `contentTypes`, `articlesByAuthor`, `articlesByTag`, `articlesByContentType`,
  `MergeTagsInput`, `ReorderContentTypesInput` и payload-и сущностей вместо `success`.
- [ ] Удалить семь неподдерживаемых операций, не добавляя полей в серверную SDL.
- [ ] Выполнить `pnpm codegen`; реэкспортировать generated-документы из
  `web/app/query/index.ts` с прежними именами оставшихся операций.
- [ ] Запустить targeted Vitest и получить GREEN.
- [ ] Проверить отрицательную мутацию теста временным невалидным fixture-документом: тест должен
  упасть; после удаления fixture targeted Vitest должен снова пройти.

## Задача 3. Полная проверка и отчёт

- [ ] Запустить `pnpm codegen --check`.
- [ ] Запустить `pnpm format`, `pnpm lint`, `pnpm test`.
- [ ] Запустить `pnpm --filter nuxt-app run typecheck` и `pnpm --filter nuxt-app run build`.
- [ ] Проверить отсутствие строковых операций в `web/app/query/index.ts` и отсутствие шаблонных
  GraphQL-строк в `web/app/query/**` через `git grep`.
- [ ] Записать фактические команды, exit code и число тестов в
  `docs/reports/2026-09-15-t010-graphql-operations-report.md`.
- [ ] Перечитать diff, закоммитить Conventional Commit и передать точный SHA тестировщику.

## Самопроверка плана

- AC-1 покрывают задачи 1–3: реальный validator, положительный прогон и отрицательная проба.
- AC-2 покрывает задача 2 и отдельный `git grep` в задаче 3.
- Новые поля API, runtime BFF и ручное редактирование generated output в план не входят.
- Имена входов и ответов берутся только из SDL baseline `53ee9b4`.

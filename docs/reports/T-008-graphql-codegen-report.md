# T-008: отчёт о GraphQL Code Generator

- **Задача**: T-008 / ALTE-16 / `01a0a189-0e9a-7422-bada-d6469e52b08f`
- **План**: `docs/plans/T-008-graphql-codegen.md`
- **Baseline**: `fac84c9c802839efcc8685a86431b9c06b058e0c`
- **Ветка**: `web/t008-graphql-codegen`
- **Implementation commits**: `2590ca3bb4d1e2963a51d140c56908950c85c464`,
  `c706406aaeca445654f14bd9d60ab12fc6db6cfb`
- **Intentional-red commit**: `1d2dced0654667870abaa1331aa39d915bbc8b1b`
- **Финальный source SHA до отчёта**: `dae97849f611c45b9e4a597d4d22a021adb6a7cd`
- **Dirty fingerprint до отчёта**: `git status --porcelain=v1` — пусто
- **PR**: [#39](https://github.com/Egoka/Altera/pull/39)

## Результат

В корне монорепозитория добавлен GraphQL Code Generator 7.4.1. Client preset 6.2.0 генерирует
fragment types и `TypedDocumentNode` из SDL сервера и документов в `web/app/graphql/**/*.graphql`.
Generated output коммитится в `web/app/graphql/generated/` и проверяется командой
`pnpm codegen --check` в CI job `checks`.

Пять файлов ручных schema types удалены. Их потребители переведены на
`ArticleCardFragment`, `PopularArticleFragment`, `AuthorSummaryFragment`,
`ContentTypeSummaryFragment` и `SectionTagSummaryFragment`. Nullable поля SDL обработаны через
guards или явный fallback; fixture role исправлена с несуществующего `user` на generated `reader`.
UI-only `iconUrl` представлен только как пересечение `ContentTypeNavItem` с generated fragment,
без копирования GraphQL-полей.

## Отклонения от исходного эталона плана

### Полный SDL snapshot

Первая disposable проба на commit `2590ca3bb4d1e2963a51d140c56908950c85c464` добавила валидное
nullable поле `_codegenDriftProbe: Boolean` в `type Query`, но `pnpm codegen --check` вернулся с
exit 0. Причина подтверждена исходным кодом client preset 6.2.0: он генерирует operation/fragment
types и typed documents, поэтому неиспользуемое поле SDL не меняет его output.

Для выполнения буквального AC добавлен прямой tool dependency `@graphql-codegen/schema-ast@6.1.0`
и дополнительный committed output `web/app/graphql/generated/schema.graphql`. После этого та же
проба на clean commit `c706406aaeca445654f14bd9d60ab12fc6db6cfb` дала exit 1 и указала stale
`web/app/graphql/generated/schema.graphql`. Client preset и единый web import boundary сохранены.

### Ignore generated output

Корневой `.prettierignore` не применяется ко второму вызову Prettier, который `pnpm -r exec`
запускает с cwd `web`. Первый `pnpm format` поэтому завершился exit 1 на трёх generated `.ts`.
Добавлен соответствующий путь `app/graphql/generated/` в существующий `web/.prettierignore`;
повторный `pnpm format` завершился exit 0. ESLint исключает тот же каталог через
`web/eslint.config.mjs`.

### Generated ArticleStatus

Client preset 6 генерирует только schema types, достижимые из документов. Добавлен узкий fragment
`ArticleStatusValue`, чтобы `ArticleStatus` оставался generated union после удаления ручного
`web/app/types/article.ts`. Этот fragment не переносит legacy operation и не выполняется runtime.

## Generated artifacts

- `web/app/graphql/generated/graphql.ts`
- `web/app/graphql/generated/gql.ts`
- `web/app/graphql/generated/index.ts`
- `web/app/graphql/generated/schema.graphql`

Повторная генерация до schema snapshot дала одинаковые SHA-256 для `graphql.ts`, `gql.ts` и
`index.ts` до и после запуска. После добавления snapshot итоговый `pnpm codegen --check` также
завершился exit 0 на clean source.

## Как проверено локально

Рабочий каталог всех обычных проверок:
`/Users/egorbondarenko/WebstormProjects/Altera/.worktrees/t008-graphql-codegen`.
Локальная среда: Node `v24.3.0`, pnpm `10.18.3`; package manifest требует Node `24.12.0`, поэтому
pnpm печатал engine warning. CI использовал закреплённую версию из `.nvmrc`.

| Проверка                                                     | Результат                                                                                                     |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------- |
| `pnpm codegen --check` до изменений                          | exit 254, `Command "codegen" not found` — RED команды                                                         |
| `pnpm codegen --check` после script, до config               | exit 1, `ENOENT ... codegen.ts`                                                                               |
| `pnpm codegen --check` после config, до generation           | exit 1, stale `index.ts`, `gql.ts`, `graphql.ts`                                                              |
| `pnpm codegen`                                               | exit 0, четыре generated artifacts созданы                                                                    |
| `pnpm codegen --check` на финальном source                   | exit 0                                                                                                        |
| `pnpm --filter nuxt-app run typecheck` после первой миграции | exit 2, 10 ожидаемых nullability diagnostics                                                                  |
| `pnpm --filter nuxt-app run typecheck` после guards          | exit 0                                                                                                        |
| `pnpm format` после добавления обоих ignore paths            | exit 0, оба workspace сообщают `All matched files use Prettier code style!`                                   |
| `pnpm lint`                                                  | exit 0                                                                                                        |
| `pnpm test`                                                  | exit 0; server: 5 files, 35 passed и 1 todo; web: 8 files, 59 passed                                          |
| `pnpm --filter nuxt-app run build`                           | exit 0; Nuxt/Nitro build создан; warnings только о старом caniuse-lite и отсутствующем локальном sharp binary |
| `git diff --check`                                           | exit 0                                                                                                        |

### Disposable negative probes

Обе финальные пробы выполнены в отдельных clean detached worktrees от
`c706406aaeca445654f14bd9d60ab12fc6db6cfb`, после `pnpm install --frozen-lockfile`:

1. В `server/src/graphql/root/schema.graphql` добавлено `_codegenDriftProbe: Boolean`, generation не
   запускалась. `pnpm codegen --check` — exit 1, stale
   `web/app/graphql/generated/schema.graphql`.
2. Добавлен `web/app/graphql/codegen-invalid-probe.graphql` с полем
   `fieldThatDoesNotExist`. `pnpm codegen --check` — exit 1, GraphQL validation error:
   `Cannot query field "fieldThatDoesNotExist" on type "Query"`.

Обе пробы удалены, disposable worktrees перед удалением имели пустой `git status --short`.

### AC-2: удаление ручных типов

Все команды `test ! -e` для следующих путей завершились exit 0:

- `web/app/query/types.ts`
- `web/app/types/article.ts`
- `web/app/types/contentType.ts`
- `web/app/types/sectionTag.ts`
- `web/app/types/user.ts`

Проверка старых imports:

```bash
grep -R -n -E '~/query/types|~/types/(article|contentType|sectionTag|user)' web/app \
  --include='*.ts' --include='*.vue'
```

завершилась exit 1 без вывода, то есть совпадений нет. Такая же проверка ручных
`Role|ArticleStatus|ContentTypeStatus` unions вне `generated` завершилась exit 1 без вывода.
Проверка generated файла нашла `ArticleStatus`, `ContentTypeStatus`, `Role` и соответствующие
fragment types; `ArticleCardFragment` содержит SDL-nullability для `dek`, `excerpt`,
`featuredImage`, `publishedAt` и `author.photoUrl`.

## CI evidence для AC-1

- **Intentional red**: commit `1d2dced0654667870abaa1331aa39d915bbc8b1b`,
  [Checks run 34913796198](https://github.com/Egoka/Altera/actions/runs/34913796198) — conclusion
  `failure`. Job `GraphQL codegen drift` выполнил `pnpm codegen --check`, нашёл stale
  `generated/schema.graphql` и завершился exit 1. Web build/typecheck, browser smoke и server smoke
  в этом run прошли; aggregate `test` корректно завершился failure из-за `checks`.
- **Final green**: revert commit `dae97849f611c45b9e4a597d4d22a021adb6a7cd`,
  [Checks run 34913939659](https://github.com/Egoka/Altera/actions/runs/34913939659) — conclusion
  `success`. Jobs `Формат, линт и тесты`, `Сборка и типизация веба`, `Браузерная проверка веба`,
  `Сборка сервера и дымовая проверка старта` и aggregate `test` завершились success.

## Ограничения и остаток

- Legacy operations в `web/app/query/**/*.ts` сохранены строками; их перенос и исправление относится
  к T-010.
- GraphQL transport/client, BFF и auth/session flow не менялись и не проверялись.
- БД и Redis не требовались для локальных acceptance probes; миграции не запускались. CI server smoke
  использовал штатный Redis service и тестовые URL из workflow, но это не DB/Redis acceptance T-008.
- Deployment не требуется: итоговый diff меняет codegen/frontend/CI и не меняет backend runtime build
  inputs после отмены disposable SDL commit.

## Передача

Тестировщику передаются PR #39, финальный source SHA
`dae97849f611c45b9e4a597d4d22a021adb6a7cd`, этот отчёт, оба CI run и команды AC-2.
После тестового verdict требуется независимое ревью актуальной ревизии; merge выполняет release engineer.

Независимое code review implementation commits не нашло Critical/Important дефектов в коде. По его
minor замечанию nullable `Article.dek` теперь выводится только при наличии значения; обязательный отчёт
добавлен этой ревизией. После этих двух изменений полный набор проверок запущен повторно.

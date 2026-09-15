# T-009: отчёт о реализации BFF-прокси GraphQL

- **Дата**: 2026-09-15
- **Задача**: T-009 / ALTE-18
- **Ветка**: `web/t009-bff-proxy`
- **Baseline**: `741470846a5db8b28e8a77a70160a32b6fda4f1c`
- **Архитектурный коммит**: `a160b1d9e2d3700c9808a66b7c2dd9d31cf8efc8`
- **Коммит реализации**: `7785a60490aeb03793b7e4a7be655834232fc3c5`
- **Техплан**: `docs/plans/2026-09-15-t009-bff-proxy.md`
- **Статус стадии**: реализация завершена, независимое тестирование и review ещё не выполнены

## Что сделано

- В `web/nuxt.config.ts` добавлен только приватный `runtimeConfig.graphqlApiUrl` с runtime override
  `NUXT_GRAPHQL_API_URL`; ключ не добавлялся в `runtimeConfig.public`.
- Добавлен Nitro-маршрут `POST /api/graphql`. Он принимает буферизованный JSON GraphQL request, валидирует
  body и конфигурационный URL, отправляет запрос фиксированному upstream и сохраняет HTTP status и GraphQL
  envelope.
- Request allowlist состоит из `authorization`, JSON `content-type`, совместимого `accept` и обязательного
  `x-graphql-yoga-csrf: bff`. Cookie, Origin, forwarded headers и произвольные входные заголовки не копируются;
  upstream `set-cookie` и CORS headers не возвращаются.
- Ошибочный body получает безопасный 400, некорректный private config — 500, сетевой отказ upstream — 502;
  тексты ошибок не содержат upstream URL.
- Добавлен `useGraphQL<TResult, TVariables>` для generated `TypedDocumentNode`: operation печатается через
  `graphql/print`, отправляется только на относительный `/api/graphql`, возвращается полный `ExecutionResult`.
- Playwright теперь поднимает реальный Yoga API и Nuxt с согласованным `FRONTEND_URL`; новый сценарий проверяет
  browser fetch `{ __typename }`, ошибочный body и точный CORS origin.

## TDD evidence

- Первоначальный targeted Vitest не был запущен по существу: новый worktree не имел package-level dependency
  links (`vitest: command not found`, exit 254). Выполнен `pnpm install --frozen-lockfile`; lockfile не изменился.
- RED `pnpm --filter nuxt-app exec vitest run tests/graphql-proxy.test.ts tests/useGraphQL.test.ts`: exit 1,
  обе новые точки входа отсутствовали (`Cannot find module`), 2 failed suites.
- Playwright setup сначала потребовал добавить второй тестовый JWT secret и дождаться окончания client
  navigation. После исправления только тестовой конфигурации содержательный RED был assertion mismatch:
  `/api/graphql` попадал в динамическую Nuxt-страницу и возвращал HTML вместо GraphQL envelope.
- GREEN targeted Vitest: 2 files, 14 tests passed. GREEN targeted Playwright: 3 tests passed.
- Первый typecheck после реализации: exit 2, `FetchResponse._data` оказался опциональным в установленном ofetch.
  Контракт helper был уточнён без assertion-обхода; повторный typecheck — exit 0.

## Как проверено

Все команды выполнены в
`/Users/egorbondarenko/WebstormProjects/Altera/.worktrees/t009-bff-proxy` на дереве коммита реализации либо на
тождественном предкоммитном snapshot. Commit hook повторно выполнил format, lint и test на создаваемом коммите.

| Check ID                     | Команда                                                                                                                                        | Фактический результат                                                                               |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| `t009-bff-boundary`          | `pnpm --filter nuxt-app exec vitest run tests/graphql-proxy.test.ts tests/useGraphQL.test.ts`                                                  | exit 0; 2 files, 14 tests passed                                                                    |
| `t009-bff-playwright`        | `pnpm --filter nuxt-app exec playwright test tests/e2e/graphql-bff.spec.ts`                                                                    | exit 0; 3 tests passed; browser BFF, safe 400 и CORS                                                |
| `t009-codegen`               | `pnpm codegen --check`                                                                                                                         | exit 0; schema и generated client outputs согласованы                                               |
| `t009-format`                | `pnpm format`                                                                                                                                  | exit 0; оба workspace package набора соответствуют Prettier                                         |
| `t009-lint`                  | `pnpm lint`                                                                                                                                    | exit 0                                                                                              |
| `t009-unit-regression`       | `pnpm test`                                                                                                                                    | exit 0; web 73 passed, server 35 passed и 1 todo                                                    |
| `t009-typecheck`             | `pnpm --filter nuxt-app run typecheck`                                                                                                         | exit 0; `nuxt prepare` и `vue-tsc -b --noEmit`                                                      |
| `t009-web-build`             | `NUXT_GRAPHQL_API_URL=https://t009-private-marker.invalid/graphql pnpm --filter nuxt-app run build`                                            | exit 0; Nuxt 4.0.0 / Nitro 2.12.0 node-server build                                                 |
| `t009-public-bundle-api-url` | fixed-string recursive `grep` marker и private default `http://127.0.0.1:4000/` только в `web/.output/public` после указанной production build | exit 0 assert; обе строки отсутствуют в public; private default присутствует только в server bundle |
| `t009-full-playwright`       | `pnpm --filter nuxt-app run test:e2e`                                                                                                          | exit 0; 4 passed, 9 существующих flow-specs явно skipped                                            |
| `t009-precommit`             | hook команды `pnpm format`, `pnpm lint`, `pnpm test` при `git commit -m "feat(web): add GraphQL BFF proxy"`                                    | exit 0; создан `7785a60490aeb03793b7e4a7be655834232fc3c5`                                           |

Сборка выводит существующие предупреждения об устаревшем `caniuse-lite` и отсутствующем локальном binary
`sharp` для `darwin-arm64`, но завершается exit 0. Runtime Node был `v24.3.0`, тогда как repository engine
фиксирует `24.12.0`; все команды сопровождались соответствующим warning. Это ограничение среды должно быть
учтено независимым тестировщиком, но оно не маскировало ни один exit code.

## Проверка критериев

| AC        | Evidence                                                                                                                             | Вердикт разработчика |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------ | -------------------- |
| AC-T009-1 | Playwright browser context получил HTTP 200 и `{ "data": { "__typename": "Query" } }` через относительный `/api/graphql`             | PASS                 |
| AC-T009-2 | Production build + fixed-string grep: marker и private default отсутствуют в `web/.output/public`                                    | PASS                 |
| AC-T009-3 | Прямой запрос к Yoga с Nuxt Origin получил точный ACAO; посторонний Origin не отражён и wildcard отсутствует                         | PASS                 |
| AC-T009-4 | Unit boundary tests проверили CSRF header, allowlist, mixed data/errors, статусы 400/500/502 и отсутствие response cookie forwarding | PASS                 |
| AC-T009-5 | Generated `TypedDocumentNode` прошёл composable test; полный Nuxt `vue-tsc` завершился exit 0                                        | PASS                 |

## Отклонение от техплана

Шаг 4 техплана предлагал менять `.github/workflows/pull_request.yml`. Прямое поручение разработчику ограничило
код каталогом `web/`, поэтому workflow не изменён. Сам обязательный grep-assert выполнен после production build
и зафиксирован выше. Если независимое review потребует постоянного CI gate вне `web/`, это отдельная запись в
том же parent с явным расширением scope, а не скрытая часть этого коммита.

## Security review и границы

- Upstream URL берётся только из private runtime config; пользователь не выбирает destination.
- Разрешены только `http:`/`https:` URL без credentials; ошибки не отражают URL или authorization.
- Browser cookie и upstream `set-cookie` сознательно не поддерживаются: session lifecycle остаётся T-023.
- GraphQL batching, multipart, subscriptions, retries, caching и mutation-specific Origin policy не добавлялись.
- `server/`, schema, resolver authorization, Render и Neon не изменялись.

## Следующий шаг

Тестировщику нужно независимо проверить коммит реализации `7785a60490aeb03793b7e4a7be655834232fc3c5` и
последующий commit отчёта из handoff-комментария: повторить Playwright browser smoke, public-bundle grep, CORS и
negative boundary checks. Ветка и worktree сохраняются; PR/merge выполняются следующими стадиями после
независимой приёмки.

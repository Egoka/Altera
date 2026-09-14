# Отчёт проверки CI для T-001

**Базовый коммит:** `6cc011d`

## Результат

Проверена актуальная конфигурация T-001. `.nvmrc`, `engines.node` и workflow используют
Node `24.12.0`; `packageManager` закреплён как `pnpm@10.18.3`. Workflow выполняет `pnpm lint`,
`pnpm test`, сборку и typecheck `nuxt-app`, а также `server build:ci`. Добавлены шаги `node -v`
после настройки Node во все выполняющие проверки job, чтобы в логе CI было проверяемое значение
версии.

## Как проверено

Конфигурация:

- `.nvmrc`: `24.12.0`.
- `package.json`: `engines.node: "24.12.0"`, `packageManager: "pnpm@10.18.3"`.
- `.github/workflows/pull_request.yml`: `actions/setup-node@v4` с
  `node-version-file: ".nvmrc"` в job `checks`, `web-checks`, `web-smoke` и `server-smoke`;
  каждый из них выполняет `node -v`.
- `checks` запускает `pnpm lint` и `pnpm test`; `web-checks` —
  `pnpm --filter nuxt-app run build` и `pnpm --filter nuxt-app run typecheck`; `server-smoke` —
  `cd server && pnpm run build:ci`.

Локальные команды на Node `v24.12.0` и pnpm `10.18.3`:

| Команда | Фактический результат |
| --- | --- |
| `pnpm format` | exit 0: `All matched files use Prettier code style!` |
| `pnpm lint` | exit 0, ESLint не вывел ошибок |
| `pnpm test` | exit 0: server — 19 passed, 1 todo; web — 56 passed |
| `pnpm --filter nuxt-app run build` | exit 0; Nuxt 4.0.0 собрал production bundle. Есть предупреждения о устаревших Browserslist data и отсутствующих darwin-arm64 sharp binaries. |
| `pnpm --filter nuxt-app run typecheck` | exit 2: девять ошибок TypeScript в существующем web-коде (`Author.vue`, `Type.vue`, `error-t.vue`, маршруты статей/автора). Это не CI-конфигурация и вне scope T-001; продуктовый код не менялся. |
| `pnpm --filter server run build:ci` | exit 0: Prisma Client сгенерирован, `tsc` и `copy-graphql` завершились успешно. Миграции не запускались. |

## CI evidence

Ссылка на проверку CI для итоговой ревизии будет добавлена после создания pull request и
завершения обязательных job.

## Ограничения

Критерий typecheck настроен и будет выполнен CI, но текущий web typecheck локально красный по
девяти существующим ошибкам продукта. Это блокирует зелёный CI и требует отдельной задачи с
полномочием менять web-код.

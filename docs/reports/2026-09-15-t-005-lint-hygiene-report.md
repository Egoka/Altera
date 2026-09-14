# Отчёт: T-005 — линт-правила и гигиена

- **Дата**: 2026-09-15
- **План**: docs/plans/2026-09-15-t-005-lint-hygiene.md
- **Задача / authorization**: T-005 / ALTE-17; queue autopilot c40fbc10, run `01a0a1ef-a1dc-7d2e-856a-e1c8d2d5b973`
- **Ветка**: lint/t-005-lint-hygiene
- **Baseline**: `83f0d0ac49353b1f1eeb46016a1065f078fa5711`, clean
- **Проверенная revision**: `773790fac3ba7aef919bb49772aca49e860db8ee`, clean
- **Коммиты**: `773790fac3ba7aef919bb49772aca49e860db8ee`
- **Actor / run**: Altera — разработчик / ALTE-17 developer run, trigger comment `01a0a1f7-1c25-7452-804a-b77a5ceb7b99`
- **Run outcome**: success
- **Stage outcome**: завершена
- **Task acceptance**: не проверено — требуется независимый ревьюер
- **Результат**: выполнено полностью в scope стадии разработки

## 1. Что сделано

- В корневом ESLint добавлен `no-console` для `server/src`: `console.log` запрещён, текущие `console.info`, `console.warn` и `console.error` разрешены до отдельной задачи логгера T-086.
- 47 существующих информационных вызовов `console.log` в шести server-файлах механически заменены на `console.info`; аргументы и контрольный поток не менялись.
- Из `server build` удалён `prisma migrate deploy`; явный `prisma:migrate:deploy` сохранён. Неиспользуемый `@neondatabase/serverless` удалён из manifest и lockfile.
- Все 10 `process.client` в `useBreakpoint.ts`, `useScroll.ts` и `stores/admin.ts` заменены на Nuxt 4 API `import.meta.client`.
- Удалены пять файлов, названных мёртвыми в `docs/vision/00-reality-check.md` §10: `components/article/featured.vue` и четыре компонента `components/demo/`.
- `pages:extend` исключает три dev-page из production router. Дополнительный production-only global middleware возвращает 404 до динамического `/:slugTypeContent`, который иначе перехватывал бы освобождённые пути.
- Production smoke теперь проверяет `/` и `/en` на 200, а `/fonts-showcase`, `/components-showcase`, `/test-error` — на 404. Добавлены два unit-сценария build-time фильтра страниц.

## 2. Что не сделано и почему

- Логгер не реализовывался: это scope T-086.
- Миграции не запускались и schema/окружение не менялись.
- `web typecheck` не принят как pass: команда завершилась code 2 из-за несовместимых типов двух экземпляров Vite (`jiti@2.4.2` и `jiti@2.5.1`) в существующем `tailwindcss()` на `nuxt.config.ts:53`. T-005 не меняет версии Vite/jiti; production build при этом прошёл. Ограничение передано ревьюеру явно.

## 3. Отклонения от плана

Первый production smoke после одного только `pages:extend` вернул 200 для `/fonts-showcase`. Root-cause: route-файл был исключён, но существующий `web/app/pages/[slugTypeContent]/index.vue` принимает произвольный slug без валидации. Добавлен узкий production-only global middleware для exact paths; вторая попытка того же `check_id` прошла, поэтому его последовательный счёт неуспехов сброшен.

## 4. Затронутые файлы

- Конфигурация и manifests: `eslint.config.mjs`, `server/package.json`, `pnpm-lock.yaml`, `web/nuxt.config.ts`.
- Server logging calls: `server/src/graphql/{auth,article,contentType,sectionTag,user}/resolver.ts`, `server/src/utils/admin.ts`.
- Web runtime: `web/app/composables/useBreakpoint.ts`, `web/app/composables/useScroll.ts`, `web/app/stores/admin.ts`, `web/app/middleware/dev-only-routes.global.ts`.
- Проверки: `web/scripts/smoke.sh`, `web/tests/dev-only-routes.test.ts`.
- Удалены: `web/app/components/article/featured.vue`, `web/app/components/demo/{Header,MegaMenu,ScreenSizeIndicator,ScrollIndicator}.vue`.
- Evidence: план и этот отчёт.

## 5. Как проверено

Общее окружение: cwd `/Users/egorbondarenko/WebstormProjects/Altera/.worktrees/t-005-lint-hygiene`; Node `v24.3.0` при заявленном engine `24.12.0`; pnpm `10.18.3`; checked at `2026-09-15T01:21:10+03:00`; baseline `83f0d0ac49353b1f1eeb46016a1065f078fa5711`; revision `773790fac3ba7aef919bb49772aca49e860db8ee`; dirty fingerprint `clean`; trace_ref недоступен по паспорту среды, существенные вызовы и вывод сохранены ниже.

### AC-1 — `t005-lint-console`

1. RED до правила: временный `server/src/__t005_console_probe.ts` с `console.log`; `pnpm exec eslint server/src/__t005_console_probe.ts` → exit 0, то есть требуемый запрет отсутствовал.
2. GREEN после правила: та же команда → exit 1, 1 выполненный lint-сценарий:

   ```text
   1:1  error  Unexpected console statement. Only these console methods are allowed: info, warn, error  no-console
   ✖ 1 problem (1 error, 0 warnings)
   ```

   Probe удалён до коммита.

3. `pnpm lint` → exit 0:

   ```text
   > pnpm -r exec eslint .
   ```

Результат: passed. Ограничение: правило проверяет исходники `server/src`, generated Prisma client исключён существующим ignore.

### AC-2 — `t005-prod-dev-routes`

1. TDD RED: `pnpm --filter nuxt-app test -- tests/dev-only-routes.test.ts` → exit 1; два новых сценария упали с `expected undefined to be type of 'function'`, соседние 57 тестов прошли.
2. TDD GREEN после `pages:extend`: та же команда → exit 0, 8 test files / 59 tests passed.
3. `pnpm --filter nuxt-app build` → exit 0; Nuxt 4.0.0, Nitro 2.12.0, client/server/Nitro build completed. Неблокирующие warnings: устаревшие Browserslist data, sourcemap Tailwind plugin и отсутствующий `sharp` binary для darwin-arm64.
4. Первая smoke-попытка → exit 1: `/fonts-showcase: 200`; установлена коллизия с `/:slugTypeContent`.
5. После global middleware повторные build и `pnpm --filter nuxt-app smoke` → exit 0, 5 HTTP-сценариев:

   ```text
   /: 200
   /en: 200
   /fonts-showcase: 404
   /components-showcase: 404
   /test-error: 404
   ✓ production web отвечает на SSR-маршрутах, dev-маршруты недоступны
   ```

Результат: passed; последовательный failure count после успешной второй попытки — 0. Ограничение: локальная production-сборка, не deployed URL.

### AC-3 — `t005-server-build-no-migrate`

`pnpm --filter server build` → exit 0; выполненная script-команда:

```text
prisma generate && tsc && pnpm run copy-graphql && cp -r src/generated dist/
✔ Generated Prisma Client (v6.12.0)
```

Дополнительно Node-проверка manifest подтвердила отсутствие `migrate` в `scripts.build` и зависимости `@neondatabase/serverless`. Результат: passed. Ограничение: миграции намеренно не запускались; сборка не доказывает состояние БД.

### AC-4 — `t005-hygiene`

- `git grep -n 'process\.client' -- web` → exit 1, совпадений нет.
- `git grep -n 'console\.log' -- server/src ':(exclude)server/src/generated/**'` → exit 1, совпадений нет.
- `git grep -n '@neondatabase/serverless' -- server/package.json pnpm-lock.yaml` → exit 1, совпадений нет.
- `pnpm test` → exit 0: server 3 files, 20 passed + 1 todo; web 8 files, 59 passed. Итого 79 passed, 1 todo.
- `pnpm format` → exit 0: два workspace-пакета сообщили `All matched files use Prettier code style!`.
- pre-commit повторно выполнил `pnpm format`, `pnpm lint`, `pnpm test` с теми же успешными итогами перед созданием `773790f`.

Результат: passed.

### Дополнительная проверка — `t005-web-typecheck`

`pnpm --filter nuxt-app typecheck` → exit 2. `vue-tsc` сообщил несовместимость `Plugin` двух копий Vite у `tailwindcss()` в `nuxt.config.ts:53`; выполненных typecheck-сценариев: 1, result: failed. Это не скрывается под AC pass и передаётся как отдельный gap; production build и обязательные AC от него не подменяются.

## 6. Что осталось

- Независимому ревьюеру проверить revision и три AC, включая причину/устранение dynamic-route fallback и scope механической замены server logging calls.
- После review оркестратору продолжить PR/merge/release lifecycle по parent ALTE-17. Изменение `server/package.json` является shared/backend build input, поэтому после merge обязательны отдельные CI/deploy/health evidence; текущая стадия их не объявляет выполненными.

## 7. Handoff и история попыток

- Goal/acceptance: T-005 / ALTE-17, AC-1…AC-3 и hygiene result из source-файла.
- Artifact/revision: ветка `lint/t-005-lint-hygiene`, implementation `773790fac3ba7aef919bb49772aca49e860db8ee`; PR будет добавлен в handoff после публикации отчёта.
- `t005-prod-dev-routes`: первая попытка failed из-за dynamic fallback, после узкого fix вторая passed; persistent failures = 0.
- `t005-web-typecheck`: одна failed дополнительная проверка, исправление не предпринималось как отдельный out-of-scope dependency-resolution gap.
- Следующий владелец: независимый ревьюер; текущий developer run заканчивается после commit/push/PR/comment, task acceptance остаётся `не проверено`.

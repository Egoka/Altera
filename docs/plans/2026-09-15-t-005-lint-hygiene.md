# T-005: линт-правила и гигиена

- **Дата**: 2026-09-15
- **Ветка**: lint/t-005-lint-hygiene
- **Задача**: T-005 / ALTE-17
- **Authorization**: queue autopilot c40fbc10, run `01a0a1ef-a1dc-7d2e-856a-e1c8d2d5b973`; admission зафиксирован в ALTE-17
- **Базовый коммит**: 83f0d0ac49353b1f1eeb46016a1065f078fa5711
- **Исходное дерево**: clean
- **Отчёт**: docs/reports/2026-09-15-t-005-lint-hygiene-report.md (заполняется по завершении)
- **Статус**: выполняется

## 1. Цель

Закрыть остаток T-005: запретить `console.log` в исходниках сервера, исключить три dev-страницы из production router, убрать перечисленный мёртвый код и устаревший Nuxt API, удалить неиспользуемую зависимость Neon и отделить миграции от обычной сборки сервера.

## 2. Контекст

- Корневой и web ESLint уже игнорируют `.output` и `.data`; `no-console` пока не настроен.
- `server/package.json` запускает `prisma migrate deploy` внутри `build`, хотя `build:ci` уже собирает без миграции.
- Маршруты `/fonts-showcase`, `/components-showcase`, `/test-error` создаются из файлов в `web/app/pages` и должны существовать только в dev (`docs/spec/00-registries/routes.md`, маршрут #69).
- Nuxt 4 поддерживает удаление просканированных страниц через build-time hook `pages:extend`; источник: <https://nuxt.com/docs/4.x/guide/recipes/custom-routing>.
- В §10 `docs/vision/00-reality-check.md` мёртвыми названы `web/app/components/article/featured.vue` и четыре файла `web/app/components/demo/`; trace-mcp не обнаружил использований `featured.vue`.
- Найдены 10 вхождений `process.client`: в `useBreakpoint.ts`, `useScroll.ts` и `stores/admin.ts`. В исходниках нет импортов `@neondatabase/serverless`, зависимость присутствует только в manifest/lockfile.

## 3. Шаги

1. Добавить unit-тест функции фильтрации Nuxt pages: production удаляет ровно три dev-маршрута, development сохраняет их; выполнить тест и зафиксировать ожидаемый RED.
2. Реализовать небольшой helper фильтрации и подключить его к `pages:extend` в `web/nuxt.config.ts`; повторить тест до GREEN.
3. Расширить `web/scripts/smoke.sh`: после production build проверять `/`, `/en` на 200, а три dev-маршрута — на 404.
4. Выполнить RED-проверки текущего lint/build-контракта: временный `console.log` в `server/src` пока не должен давать нужную ошибку; текущий `build` содержит миграцию.
5. Добавить `no-console: ["error", { allow: ["warn", "error"] }]` только для `server/src/**/*.{ts,js}`, чтобы не вводить логгер из T-086 и не затронуть web fixtures.
6. Сделать `server build` эквивалентным безопасной сборке без миграций, оставив явный `prisma:migrate:deploy`; удалить `@neondatabase/serverless` через pnpm, обновив lockfile.
7. Заменить все `process.client` на `import.meta.client`; удалить `featured.vue` и четыре файла `components/demo`.
8. Выполнить целевые проверки: unit-тесты, временная вставка `console.log`, отсутствие `process.client`/неиспользуемого пакета, `pnpm lint`, production build и curl-smoke, server build без миграции; затем полные актуальные проверки проекта по доступным scripts.
9. Создать парный отчёт с фактическим выводом, проверить diff/index, сделать conventional commits, запушить ветку и открыть PR в `app`.

## 4. Критерии готовности

- **AC-1 / `t005-lint-console`**: `pnpm lint` — exit 0; временный файл в `server/src` с `console.log` — exit != 0 и ошибка `no-console`; после удаления временного файла дерево не содержит его.
- **AC-2 / `t005-prod-dev-routes`**: `pnpm --filter nuxt-app build && pnpm --filter nuxt-app smoke` — exit 0; `/fonts-showcase`, `/components-showcase`, `/test-error` возвращают HTTP 404, `/` и `/en` — HTTP 200.
- **AC-3 / `t005-server-build-no-migrate`**: manifest не включает `prisma migrate deploy` в `build`; `pnpm --filter server build` — exit 0 и в выводе нет запуска миграции.
- **AC-4 / `t005-hygiene`**: перечисленные пять мёртвых Vue-файлов удалены; в исходниках нет `process.client`; `@neondatabase/serverless` отсутствует в manifest и lockfile; релевантные тесты проходят.

## 5. Что сознательно не входит

- Реализация логгера T-086 и исправление существующих допустимых `console.warn`/`console.error`.
- Удаление почти дублирующих, но не названных мёртвыми `article/type.vue` и `article/author.vue`.
- Изменение продуктовых маршрутов, кроме ограничения маршрута #69 production-сборкой.
- Запуск миграций или изменение schema/окружения.

## 6. Риски

- Удаление маршрутов по имени файла может задеть вложенные/локализованные записи; helper обходит дерево страниц и сверяет точные canonical paths, а production smoke подтверждает наблюдаемые HTTP-ответы.
- ESLint-конфиги дублируются; правило размещается в корневом config с точным glob `server/src`, потому что AC проверяется корневой командой `pnpm lint`.
- Production smoke поднимает локальный процесс; существующий script владеет PID, проверяет занятый порт и завершает только свой дочерний процесс.
- `server build` генерирует Prisma client, но после изменения не обращается к БД и не применяет миграции.

## 7. Стадии и handoff

- **Разработка**: actor `Altera — разработчик`, issue ALTE-17, вход — baseline и passport из parent comment `01a0a1f7-1c25-7452-804a-b77a5ceb7b99`; выход — branch/commit/PR, парный отчёт и evidence по AC-1…AC-4.
- **Независимый ревью**: назначает оркестратор после handoff; проверяет текущую revision и evidence, не исторический baseline.
- `trace_ref`: недоступен по паспорту среды; для code-навигации использован trace-mcp, экспорт trace не поддерживается.
- Предыдущих неуспехов `check_id` нет; две подряд неуспешные попытки одной проверки останавливают соответствующую проверку с handoff причины.
- Run outcome, stage outcome и task acceptance до завершения реализации не применимы; успешный worker run не означает независимую приёмку задачи.

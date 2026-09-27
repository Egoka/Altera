# План: T-132 в канонической карточке ALTE-125 — сверка критериев и один итог

- **Задача**: T-132 «Рубрики: иерархия восстановления из архива и строки состояний раздела»
- **Карточка Multica**: ALTE-125 (`01a0e184-cbf4-762e-82c1-92b049a1d6a2`) — каноническая карточка T-132
- **Исполнитель**: Altera — разработчик (`b0f3bc32-dd95-471e-b40e-517aaf83edf0`), run `01a0e242-58dd-7ede-8d6f-17693afab500`
- **Источник**: `docs/backlog/tasks/T-132-sections-restore-hierarchy.md` (blob `babde820ad49343cfcb00e96ce2ba3b5817e8734`)
- **Baseline захода**: `origin/app` `77fb9b169b6b5d858e4e8ee882e394f944f2fea2`

## 1. Исходная обстановка

Код T-132 уже в `app`: PR [#227](https://github.com/Egoka/Altera/pull/227), head
`15dfe0a86a4c3315372df1092c9fb86a9388438e`, merge `574e484364a1885ca839ee9a5d0970f28bd24ab0`
(2026-09-26). Реализацию выполняли в карточке T-070 (ALTE-83), потому что отдельной карточки у
доработки тогда не было. Каноническая карточка T-132 — ALTE-125 — создана 2026-09-27, уже после
слияния.

Прежний итог остался с пробелами: `issue_id` указывает на карточку T-070, `pr.merge_sha` пустой,
результат агрегата CI в том заходе не наблюдался, `review` не заполнен. Контроллер требует native
execution той же `issue_id`, поэтому заход не переписывает продуктовый код, а сверяет критерии на
текущей ревизии и приводит канонический итог к карточке ALTE-125.

## 2. Что делает заход

1. Сверить, что код T-132 в `app` не менялся с проверенного head `15dfe0a`.
2. Прогнать критерии AC-1…AC-3 на текущей ревизии, включая AC-3 в браузере.
3. Прогнать общие проверки проекта: `format`, `lint`, `test`, `build:ci`, `typecheck`.
4. Заполнить `**Проверяемая revision**` в файле задачи.
5. Привести `docs/reports/tasks/T-132.{json,md}` к карточке ALTE-125: `issue_id`, реальный
   `implementer_run_id` этого захода, блок `checks`, `pr.merge_sha`, наблюдённый агрегат CI.
   Прежнюю карточку и прежний run сохранить блоком `history`.
6. Отчёт захода в `docs/reports/`, PR в `app`, автослияние, удаление ветки после слияния.

## 3. Что заход не делает

- Не меняет продуктовый код: критерии выполнены слитым кодом, менять нечего.
- Не принимает свою работу и не ставит `review.verdict`: исполнитель не ревьюер.
- Не пересобирает производные таблицы бэклога (`matrix.md`, `README.md`, `epics/E-11-admin-1.md`,
  `ready-candidates.md`): они держат «кандидат» сразу у десятка уже слитых задач, и их пересборка —
  отдельный проход `scripts/backlog/sync_status.py --apply`, а не правка одной строки.
- Не трогает `docs/vision/00-reality-check.md`: срез ведёт T-135 в своей ветке.
- Не входит физическое удаление рубрик и тегов `admin` без аудита — T-076.

## 4. Ветка и проверки

Ветка `docs/t132-canonical-receipt` от `77fb9b16` в отдельном рабочем дереве
`.worktrees/t132-canonical`. Проверки: `pnpm install --frozen-lockfile`, `pnpm format`, `pnpm lint`,
`pnpm test`, адресные `vitest tests/taxonomy-service.test.ts tests/admin-categories.test.ts` и
`vitest tests/admin-categories-page.nuxt.test.ts`, Playwright
`tests/e2e/admin-sections-restore-hierarchy.spec.ts` на изолированной базе PostgreSQL 16 из
`docker-compose` (порт 25432), `pnpm --filter server run build:ci`,
`pnpm --filter nuxt-app run typecheck`.

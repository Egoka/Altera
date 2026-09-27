# Отчёт: T-132 в канонической карточке ALTE-125 — сверка критериев и один итог

- **Дата**: 2026-09-27
- **Задача**: T-132 «Рубрики: иерархия восстановления из архива и строки состояний раздела»
- **Карточка Multica**: ALTE-125 (`01a0e184-cbf4-762e-82c1-92b049a1d6a2`) — каноническая карточка T-132
- **Исполнитель**: Altera — разработчик (`b0f3bc32-dd95-471e-b40e-517aaf83edf0`), run `01a0e242-58dd-7ede-8d6f-17693afab500`
- **Источник**: `docs/backlog/tasks/T-132-sections-restore-hierarchy.md` (blob `babde820ad49343cfcb00e96ce2ba3b5817e8734`)
- **Baseline захода**: `origin/app` `77fb9b169b6b5d858e4e8ee882e394f944f2fea2`
- **План**: [docs/plans/2026-09-27-t132-canonical-verification.md](../plans/2026-09-27-t132-canonical-verification.md)

## 1. Что было до захода

Продуктовый код T-132 уже в `app`. PR [#227](https://github.com/Egoka/Altera/pull/227), head
`15dfe0a86a4c3315372df1092c9fb86a9388438e`, base `d8ee443d`, merge
`574e484364a1885ca839ee9a5d0970f28bd24ab0` (2026-09-26, автослияние по зелёному CI).

Реализацию выполняли в карточке T-070 (ALTE-83): отдельной карточки у доработки тогда не было.
Каноническую карточку T-132 — ALTE-125 — создали 2026-09-27, уже после слияния. Прежний итог остался
с пробелами: `issue_id` указывал на карточку T-070, `pr.merge_sha` был пустой, результат агрегата CI
в том заходе не наблюдался, `review` не заполнен.

Контракт контроллера («Один итог задачи») требует, чтобы native execution относились к `issue_id`
канонического итога, и прямо говорит: run отдельной карточки доверие не наследует, старый
child-review сохраняется ссылкой как история, а актуальный независимый review выполняется в
канонической задаче. Поэтому заход ничего не переписывал в продуктовом коде — менять в нём нечего,
критерии выполнены — а сверил критерии на текущей ревизии и привёл канонический итог к ALTE-125.

## 2. Код не менялся с проверенного head

`git diff 15dfe0a..77fb9b16` по файлам T-132 — `server/src/taxonomy/service.ts`,
`server/tests/taxonomy-service.test.ts`, `server/tests/admin-categories.test.ts`,
`web/app/composables/useAdminCategories.ts`, `web/app/pages/admin/categories/index.vue`,
`web/tests/admin-categories-page.nuxt.test.ts`,
`web/tests/e2e/admin-sections-restore-hierarchy.spec.ts`,
`web/app/graphql/operations/admin/types.graphql` — пуст.

Единственное расхождение — `server/src/graphql/section/{resolver.ts,schema.graphql}`: T-129 добавил
`publicSections(locale: Locale!)` для меню шапки. Мутации `updateSection`, `restoreSection`,
`archiveFormat` и `restoreFormat` в этих файлах не менялись. Значит сверка на текущей ревизии
проверяет именно тот код, который слит по T-132.

## 3. Критерии на текущей ревизии

| AC   | Результат | Проверка на `77fb9b16`                                                                                                                                                                                                   |
| ---- | --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| AC-1 | passed    | `restoreSection` берёт строку `FOR UPDATE`, отвечает `NOT_FOUND` на отсутствующую рубрику, `CONFLICT` на активную и `FORBIDDEN`, когда роль ниже владельца снимает архив владельца — до записи аудита. 41 passed адресно |
| AC-2 | passed    | `updateSection` сверяет `expectedUpdatedAt` с `updatedAt` и передаёт версию в `updateSectionRow`, где она уходит в `WHERE` самого `UPDATE`: `count === 0` даёт `CONFLICT`. Браузерный сценарий конфликта — 1 passed      |
| AC-3 | passed    | `playwright tests/e2e/admin-sections-restore-hierarchy.spec.ts` exit 0, 2 passed: обе строки состояний `categories.md` §9. Плюс `vitest tests/admin-categories-page.nuxt.test.ts` exit 0, 8 passed                       |

Дополнительно проверены два пункта §3 файла задачи, не разложенные по AC: кнопки недоступных
действий. В `web/app/pages/admin/categories/index.vue` кнопка «Восстановить» выводится только при
`canRestoreSection(item)` — `status === "archived"` и либо владелец, либо архив не владельца; иначе
на её месте стоит пояснение `ownerArchiveNote`. `archiveFormat` и `restoreFormat` проверяют текущий
статус через `requireFormatStatus` (`active` и `archived` соответственно).

## 4. Проверки захода

| Команда                                                                | Exit | Вывод                                     |
| ---------------------------------------------------------------------- | ---- | ----------------------------------------- |
| `pnpm install --frozen-lockfile`                                       | 0    | Done in 29.5s                             |
| `pnpm format`                                                          | 0    | All matched files use Prettier code style |
| `pnpm lint`                                                            | 0    | без замечаний                             |
| `pnpm test` (корень, одним прогоном)                                   | 1→0  | нестабильный отказ, разбор ниже           |
| `pnpm --filter server test`                                            | 0    | 77 файлов, 863 passed / 47 skipped        |
| `pnpm --filter nuxt-app test`                                          | 0    | 55 файлов, 624 passed                     |
| `vitest tests/taxonomy-service.test.ts tests/admin-categories.test.ts` | 0    | 2 файла, 41 passed                        |
| `vitest tests/admin-categories-page.nuxt.test.ts`                      | 0    | 1 файл, 8 passed                          |
| `playwright tests/e2e/admin-sections-restore-hierarchy.spec.ts`        | 0    | 2 passed                                  |
| `pnpm --filter server run build:ci`                                    | 0    | сборка и copy-graphql                     |
| `pnpm --filter nuxt-app run typecheck`                                 | 0    | `vue-tsc -b --noEmit` без диагностик      |

### Нестабильный отказ корневого `pnpm test`

Корневой `pnpm test` запускает три пакета сразу и завершился exit 1 на одном сценарии:
`web/tests/smoke-script.test.ts` → «fails before launch when the requested port is already serving
HTTP», `Test timed out in 5000ms`. Сценарий поднимает дочерний процесс Node, занимает свободный порт
и ждёт, что скрипт дымовой проверки откажется стартовать. Под одновременной нагрузкой трёх пакетов
он не успевает в пятисекундный бюджет. Отдельный прогон того же файла — exit 0, 3 passed. К
таксономии и к изменениям T-132 сценарий не относится; пакеты по отдельности зелёные.

Отказ подтверждён нестабильным: pre-commit hook этого коммита прогнал тот же корневой
`npm run test` и завершился exit 0 — server 863 passed / 47 skipped, web 624 passed,
`packages/content` 99 passed. То есть корневой прогон из двух наблюдений дал 1 и 0 на
неизменном дереве; расхождение объясняется только временем старта дочернего процесса.

### Среда браузерного прогона

Базовый `web/playwright.config.ts` жёстко занимает порты 4000 (API) и 4173 (Nitro) с
`reuseExistingServer: false`. Порт 4000 держал dev-сервер владельца из основного checkout
(`/Users/egorbondarenko/WebstormProjects/Altera/server`), и заход его не останавливал. Прогон шёл по
временному конфигу с собственными портами Altera — 24000 и 24173 — на отдельной базе `t132_e2e`
(PostgreSQL 16 из `docker-compose`, порт 25432). Миграции применялись только к этой базе;
после прогона база удалена, временный конфиг и `test-results` удалены, дерево чистое.

### CI на проверенном SHA

Прежний отчёт оставлял агрегат CI ненаблюдённым. Он наблюдён сейчас: на tested SHA `15dfe0a` —
[run 36259645451](https://github.com/Egoka/Altera/actions/runs/36259645451), семь проверок success,
включая «Браузерная проверка веба» (4m53s), «Формат, линт и тесты», «Сборка сервера и дымовая
проверка старта», «Сборка и типизация веба» и агрегат `test`. На merge SHA `574e484` —
[run 36259953994](https://github.com/Egoka/Altera/actions/runs/36259953994) success.

Спека T-132 продолжает идти в CI после слияния: blob
`web/tests/e2e/admin-sections-restore-hierarchy.spec.ts` на head PR [#261](https://github.com/Egoka/Altera/pull/261)
(`54e914a9`) совпадает с `origin/app`, и джоб «Браузерная проверка веба» этого PR
([run 36308718670](https://github.com/Egoka/Altera/actions/runs/36308718670)) — pass.

## 5. Что изменено в файлах

- `docs/backlog/tasks/T-132-sections-restore-hierarchy.md` — заполнена `**Проверяемая revision**`.
- `docs/reports/tasks/T-132.json` — `issue_id` канонической карточки ALTE-125, реальный
  `implementer_run_id` этого захода, блок `checks`, `pr.merge_sha`, `pr.url`, `branch`,
  наблюдённый агрегат CI в доказательствах критериев; блок `history` с прежней карточкой и прежним
  run; `review` остаётся незаполненным под вердикт независимого ревьюера.
- `docs/reports/tasks/T-132.md` — тот же итог в Markdown; `finalization.sha256` пересчитан.
- Планы и прежний отчёт 2026-09-26 сохранены ссылками, ничего не удалено.

## 6. Остаток

- Независимое ревью в ALTE-125 с маркером `ALTERA_REVIEW_V1` на `15dfe0a` — за независимым
  ревьюером; исполнитель свою работу не принимает. Отдельно стоит отметить: на этом head вердикта не
  было ни в одной карточке. Вердикт в `docs/reports/tasks/T-070.json` относится к собственному head
  T-070 `baa84225`, а не к доработке, поэтому в `history` прежнего ревью нет.
- Выкладка обязательна (PR менял `server/`): probe Render и `/health` merge SHA выполняет отдельный
  актор.
- После приёмки T-132 возвращённая T-070 проходит повторную приёмку в карточке ALTE-83.
- Физическое удаление рубрик и тегов `admin` без аудита остаётся за T-076.
- Производные таблицы бэклога (`docs/backlog/matrix.md`, `README.md`, `epics/E-11-admin-1.md`,
  `ready-candidates.md`) держат T-132 в статусе «кандидат» вместе с другими уже слитыми задачами.
  Это общий разрыв, который закрывает проход `python3 scripts/backlog/sync_status.py --apply`, а не
  правка одной строки в этом заходе.
- `docs/vision/00-reality-check.md` в перечне кандидатов всё ещё называет T-132 открытым дефектом:
  «иерархия рубрик — `restoreSection` без проверки статуса и роли архивировавшего
  [ФАКТ: `server/src/taxonomy/service.ts:499-528`]». Запись устарела: обе проверки в коде, а
  указанный диапазон строк уже не тот. Срез ведёт T-135, поэтому заход файл не трогал и передаёт
  разрыв как факт.

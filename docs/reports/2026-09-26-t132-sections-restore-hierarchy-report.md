# Отчёт T-132: иерархия восстановления рубрик, конфликт и права в разделе

- **Задача**: T-132, карточка ALTE-83 (`01a0b5ee-c45e-7edd-b058-768964c3b5da`) — доработка
  возвращённой T-070
- **Источник**: `docs/backlog/tasks/T-132-sections-restore-hierarchy.md`, blob
  `babde820ad49343cfcb00e96ce2ba3b5817e8734`
- **План**: [docs/plans/2026-09-26-t132-sections-restore-hierarchy.md](../plans/2026-09-26-t132-sections-restore-hierarchy.md)
- **Baseline**: `d8ee443d17801bcdd27cb9d1dcc30fbb56e74439` (`origin/app`, fetch 2026-09-26 20:18 +03:00)
- **Tested SHA**: `15dfe0a86a4c3315372df1092c9fb86a9388438e`
- **Ветка / worktree**: `server/t132-sections-restore-hierarchy` /
  `.worktrees/t132-sections`
- **PR кода**: [#227](https://github.com/Egoka/Altera/pull/227) → `app`, автослияние включено
- **Источники решений**: журнал #1, #2; `docs/spec/40-admin/categories.md` §5, §8, §9;
  находки ревью — [docs/reports/2026-09-26-in-review-acceptance-report.md](2026-09-26-in-review-acceptance-report.md)

## 1. Что было возвращено и что исправлено

Независимое ревью 2026-09-26 вернуло T-070 с блокирующим дефектом: `restoreSection`
(`server/src/taxonomy/service.ts`) не проверял ни статус рубрики, ни `archivedByRole`, поэтому
`admin` восстанавливал рубрику, заархивированную `owner`, и «восстанавливал» уже активную
рубрику. Строки состояний §9 «Нет прав на часть действий» и «Конфликт» в разделе отсутствовали:
`updateSection` писал поверх чужой версии без сверки.

| Находка ревью                                                          | Что сделано                                                                                                                                                                    |
| ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `restoreSection` без проверки статуса и `archivedByRole` (блокирующая) | Проверки внутри транзакции после `FOR UPDATE`: `NOT_FOUND` для исчезнувшей рубрики, `CONFLICT` для активной, `FORBIDDEN` для архива `owner` у роли ниже. Отказ не пишет аудит. |
| AC-1 T-070: строки «нет прав на часть действий» и «конфликт»           | `updateSection` принимает необязательную версию карточки `expectedUpdatedAt`; раздел показывает пояснение «архивировано владельцем», конфликт версии и конфликт преемника.     |
| `updateSection` без версии записи                                      | Сверка `expectedUpdatedAt` с `updatedAt` плюс условный `UPDATE` с `updatedAt` в `WHERE`: параллельная запись не проскакивает между чтением карточки и обновлением.             |
| Резолвер `restoreSection` без `handleAdminError`                       | Мутация завёрнута в `handleAdminError`: исчезнувшая рубрика — `NOT_FOUND`, не внутренняя ошибка.                                                                               |
| `archiveFormat` / `restoreFormat` без проверки статуса                 | `requireFormatStatus` сверяет текущий статус до записи: повтор даёт `CONFLICT` и не оставляет ложной записи аудита.                                                            |
| `syncUrl` → `/admin/categories` вместо `/admin/sections`               | Фильтры сохраняются в текущем пути (`routes.md` #42 — канонический адрес `/admin/sections`).                                                                                   |
| `deleteSection` — физическое удаление `admin` без аудита               | Вне scope T-132: отдельная задача T-076 (границы §3 задачи).                                                                                                                   |

Приём оптимистичной блокировки (сверка версии плюс условие в самом `UPDATE`) повторяет
`server/src/admin/legal.ts`; иерархия восстановления повторяет `restoreTag` — правило одно
и то же для рубрик и тегов, новых продуктовых правил не вводилось.

## 2. Критерии готовности

| AC                                                                                                       | Результат | Доказательство                                                                                                                                                                                                                                                                                                                                                                                                                                |
| -------------------------------------------------------------------------------------------------------- | --------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| AC-1 — `admin` получает `FORBIDDEN` на архив `owner`, повтор на активной рубрике — `CONFLICT` без аудита | passed    | `server/src/taxonomy/service.ts` (`restoreSection`); `server/tests/taxonomy-service.test.ts` — «does not let an admin restore a section archived by the owner», «lets the owner restore an archive made by the owner», «does not restore an active section and writes no audit entry», «reports a missing section as NOT_FOUND instead of a Prisma failure»                                                                                   |
| AC-2 — одновременная правка даёт второму `CONFLICT` и сообщение в интерфейсе                             | passed    | `server/tests/taxonomy-service.test.ts` — «refuses a section edit that was prepared against an older version», «keeps the version in the UPDATE so a parallel edit cannot slip through»; `server/tests/admin-categories.test.ts` — «passes the card version from the client into the section update»; `web/tests/e2e/admin-sections-restore-hierarchy.spec.ts` — «explains a conflict when another administrator already changed the section» |
| AC-3 — строки состояний §9 покрыты e2e                                                                   | passed    | `web/tests/e2e/admin-sections-restore-hierarchy.spec.ts` — «hides restore from an admin for a section the owner archived» и сценарий конфликта; `web/tests/admin-categories-page.nuxt.test.ts` — пять новых сценариев состояний                                                                                                                                                                                                               |

## 3. Проверки на tested SHA `15dfe0a`

| Команда                                            | Exit | Наблюдаемый результат                                                 |
| -------------------------------------------------- | ---- | --------------------------------------------------------------------- |
| `pnpm install --frozen-lockfile`                   | 0    | 1244 пакета, Node 24.12.0, pnpm 10.18.3                               |
| `pnpm format`                                      | 0    | Prettier `--check` без замечаний                                      |
| `pnpm lint`                                        | 0    | ESLint во всех пакетах                                                |
| `pnpm test`                                        | 0    | server 798 passed / 30 skipped (89 файлов), web 569 passed (53 файла) |
| `pnpm --filter server run build:ci`                | 0    | сборка без применения миграций                                        |
| `pnpm --filter nuxt-app run typecheck`             | 0    | `nuxt prepare && vue-tsc -b --noEmit`                                 |
| `npx playwright test --project=chromium --no-deps` | 1    | 225 passed, 9 skipped, 1 failed                                       |

Миграции не добавлялись и не применялись: изменение работает на существующей схеме
(`updatedAt` рубрики уже есть в модели `Section`). Локальная база браузерной проверки —
docker-сервис Altera на порту 25432, все 21 миграция уже применены.

### Границы доказательств

- Единственный отказ браузерной проверки — `web/tests/e2e/feeds-xml.spec.ts` «лента локали
  отдаётся валидным RSS с типом и кешем ответа»: сценарий по своему комментарию рассчитан на базу
  «после миграций без seed» и проверяет `not.toContain("<item>")`. Локальная общая база накопила
  опубликованные материалы прошлых прогонов, поэтому фид не пуст. Сценарий не связан с
  таксономией; в CI база поднимается заново. По той же причине отдельно падает проект
  `empty-db` (2 сценария), из-за чего полный `pnpm --filter nuxt-app run test:e2e` не доходит до
  проекта `chromium` — он запускался с `--no-deps`.
- `admin-audit.spec.ts` и `admin-tags.spec.ts` читают собственные переменные
  `T079_TEST_DATABASE_URL` и `T071_TEST_DATABASE_URL`; при прогоне с одной `DATABASE_URL` они
  проходят. Это особенность локального запуска, не дефект кода.
- Зелёный локальный прогон не заменяет агрегат CI: результат CI на tested SHA фиксируется
  отдельно, и независимое ревью выполняет другой актор.

## 4. Остаток

- Агрегат CI на `15dfe0a` и независимое ревью того же SHA — не выполнены в этом заходе.
- Физическое удаление рубрик и тегов `admin` без аудита — T-076, отдельная задача.
- После приёмки T-132 возвращённая T-070 (ALTE-83) проходит повторную приёмку в своей карточке.

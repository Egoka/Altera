# T-048: адаптер AI-проверки допустимости (`fake`), запись результата и связь с очередью — отчёт

- **Дата**: 2026-09-28
- **Задача**: T-048 / ALTE-135, эпик E-08 «Проверка и публикация»
- **Native issue**: `01a0e4af-a3ee-72f7-af5a-2e0c4a6b98bf`
- **Источник**: `docs/backlog/tasks/T-048-ai-check-adapter.md`, ревизия допуска
  `76e46e6ab48a98568f87d5c44c55c4b0d9a45eec`
- **Baseline**: `origin/app` `eade0b29470d855b610eb8b11318316f6bba2c11`
- **Tested SHA**: `cfa67c4dda571c9d8df1094d807a288087c3f0f9`
- **Ветка**: `server/t048-ai-check-adapter`; PR [#325](https://github.com/Egoka/Altera/pull/325)
- **План**: [2026-09-28-t048-ai-check-adapter.md](../plans/2026-09-28-t048-ai-check-adapter.md)

## 1. Объём и границы

Выполнен объём, утверждённый журналом §32 п. 3: интерфейс адаптера, `fake`-реализация, запись
результата и связь с очередью T-047. `real` на YandexGPT (журнал §34 п. 4) не входит и не включён:
до утверждения владельцем `real`-проверка не работает (журнал §32 п. 2).

Вне объёма и не затронуто: переходы статусов версии `ai_check` → `published` / `review` (T-049),
раздел `/admin/ai` и его запросы (T-078), письма автору, пометка 18+ у статьи (T-136),
юридические дополнения критериев (T-137), `alt` (T-067).

## 2. Что появилось

| Файл                                                       | Роль                                                                                            |
| ---------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `server/src/ai/types.ts`                                   | интерфейс `AiCheckAdapter`, бинарный вердикт, шесть кодов категорий, `PROVIDER_UNAVAILABLE: ai` |
| `server/src/ai/submission.ts`                              | загрузчик и чистый сборщик подачи по `ai-check-criteria.md` §2                                  |
| `server/src/ai/adapters/fake.ts`                           | детерминированный двойник: фикстура, маркер в тексте, иначе `publish`                           |
| `server/src/ai/adapters/unavailable.ts`                    | провайдер не настроен: вердикт не выносится                                                     |
| `server/src/ai/config.ts`                                  | выбор реализации по `AI_CHECK_ADAPTER`                                                          |
| `server/src/ai/reasons.ts`                                 | названия шести категорий (ru/en) и сборка комментария автору                                    |
| `server/src/ai/service.ts`                                 | запись результата: процесс, агрегат стоимости, комментарий, аудит, логи                         |
| `server/src/ai/store.ts`                                   | узкий интерфейс хранилища поверх Prisma                                                         |
| `server/src/ai/queue.ts`                                   | постановка задания вместе с записью процесса одной транзакцией                                  |
| `server/src/ai/index.ts`                                   | обработчик вида `ai.check` и его регистрация                                                    |
| `server/prisma/migrations/20260928150000_ai_check_result/` | дополнение `ai_processes` и `review_messages`                                                   |

Новых кодов событий и прав не вводилось: `ai.job.created/.started/.running/.done/.failed`
и аудит `ai.decision` уже были утверждены реестром `docs/spec/00-registries/events-and-logs.md`
(строки #46, #71) и присутствовали в `LOG_EVENT_CODES` и `AUDIT_CODE_ZONES`; вид задания
`ai.check` уже был в `KNOWN_JOB_KINDS`. Тест `ai-check-adapter.test.ts` это фиксирует.

### 2.1 Один вердикт — четыре записи

На каждый вердикт сервис пишет одной транзакцией:

1. запись AI-процесса: статус `completed`, вердикт, причины с текстом, `evidence`, признаки
   `adult` и `manipulationAttempt`, модель, `promptVersion`, длительность;
2. агрегат `AiCostAggregate` за суточную корзину UTC (`[ДОПУЩЕНИЕ]`: величину корзины
   спецификация не задаёт, раздел показывает стоимость «за период», журнал §27.4);
3. при отказе — `ReviewMessage` вида `ai_decision` с причинами по категориям;
4. аудит `ai.decision` с кодами категорий, `translationId`, `revisionId` и `promptVersion`.

Статусы процесса проходят `created` (при постановке) → `started` → `running` →
`completed` / `failed`, как требует журнал #34.

### 2.2 Недоступность провайдера

Ошибка адаптера пишет процессу статус `failed` с классом ошибки, логирует `ai.job.failed` и
отдаёт наружу `PROVIDER_UNAVAILABLE: ai`. Вердикта, комментария, аудита и агрегата при этом нет,
а задание повторяет очередь T-047 (до трёх попыток). Ошибка сборки подачи `PROVIDER_UNAVAILABLE`
не выдаётся: в записи остаётся её собственный класс.

### 2.3 Повтора вердикта нет

Завершённая запись второго вердикта не даёт: `runCheck` находит процесс по `jobId` и при статусе
`completed` выходит, не обращаясь к провайдеру (журнал #14). На уровне базы то же держит
уникальность `(objectType, objectId, revisionId)`: вторая проверка той же ревизии не создаётся.
NULL в PostgreSQL не конфликтует, поэтому ограничение не касается проверок профиля и `alt`,
у которых ревизии нет.

## 3. Миграция и репетиция

`20260928150000_ai_check_result` только дополняет таблицы: `ai_processes` получает `revisionId`,
`evidence`, `manipulationAttempt`, `adult` и уникальный индекс; `review_messages.byRole` становится
необязательным, потому что у записи автоматической проверки роли сотрудника нет (журнал §16.3).
Колонки стоимости у записи процесса нет и не появляется.

Репетиция на копии локальной базы `altera_dev` (420 записей `ai_processes`, 795 `review_messages`):

- `prisma migrate deploy` применил T-020 и T-048 без ошибок;
- число строк после миграции совпало: `ai_processes` 420, `review_messages` 795, `byRole IS NULL` 0;
- `prisma migrate diff --from-url … --to-schema-datamodel … --exit-code` — «No difference detected»,
  то же на чистой базе со всем набором миграций.

Development Neon и production не читались и не изменялись.

## 4. Сборка: `@altera/content` в зависимостях сервера

`server/src/ai/submission.ts` берёт текст блоков из `toPlainText` пакета `@altera/content`: второй
реализации разбора документа в проекте нет намеренно (ADR-0029, решение T-020). Поэтому пакет
переведён из `devDependencies` в `dependencies` сервера, а `build` и `build:ci` начинаются с
`build:content` (`pnpm --filter @altera/content run build`) — `dist` пакета в git не хранится.

Проверено из чистого состояния, повторяющего джоб `server-smoke`:
`rm -rf packages/content/{node_modules,dist}` → `cd server && pnpm install --frozen-lockfile` →
`cd server && pnpm run build:ci` → `dist/server.js` собран, `require("@altera/content")`
разрешается. Тесты собранный пакет не требуют: `server/vitest.config.ts` направляет пакет
на исходники.

## 5. Критерии готовности

| №   | Критерий                                                                           | Результат | Чем подтверждено                                                                                                                                                                                                         |
| --- | ---------------------------------------------------------------------------------- | --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | С `fake` статья с фикстурой «отказ» получает комментарий с причинами по категориям | ✅        | `server/tests/ai-check-adapter.test.ts` — запись `ai_decision` содержит названия категорий отказа и не содержит остальных; на настоящей базе то же в `ai-check-queue-database.test.ts`                                   |
| 2   | Текст для проверки не содержит имени и e-mail автора                               | ✅        | `server/tests/ai-check-submission.test.ts` — выборка загрузчика не запрашивает `author`, `name`, `email`, `handle`; состав подачи — закрытый перечень полей; расширенная запись с данными автора в подачу их не проносит |
| 3   | Стоимость записывается так, что доступна только агрегатом                          | ✅        | `server/tests/ai-cost-contract.test.ts` — в `AiProcess` нет ни одного поля стоимости (и в `Prisma.AiProcessScalarFieldEnum` тоже), агрегат не ссылается на отдельную запись, схема API стоимости AI-записи не отдаёт     |

## 6. Как проверено

Все команды выполнены на ревизии `cfa67c4dda571c9d8df1094d807a288087c3f0f9`
(рабочее дерево `/Users/egorbondarenko/WebstormProjects/Altera/.worktrees/autopilot`).

| Команда                                                                     | Результат                                                                                     |
| --------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| `pnpm install --frozen-lockfile`                                            | exit 0                                                                                        |
| `pnpm format`                                                               | exit 0                                                                                        |
| `pnpm lint`                                                                 | exit 0                                                                                        |
| `pnpm test`                                                                 | exit 0: server 911 passed / 57 skipped, web 723 passed, content 99 passed                     |
| `pnpm --filter server exec vitest run tests/ai-check-adapter.test.ts`       | 16 passed                                                                                     |
| `pnpm --filter server exec vitest run tests/ai-check-submission.test.ts`    | 6 passed                                                                                      |
| `pnpm --filter server exec vitest run tests/ai-cost-contract.test.ts`       | 3 passed                                                                                      |
| `T048_TEST_DATABASE_URL=… vitest run tests/ai-check-queue-database.test.ts` | 4 passed                                                                                      |
| `pnpm --filter server run build:ci`                                         | exit 0, `dist/server.js` собран                                                               |
| `pnpm codegen --check`                                                      | exit 0, дрейфа схемы нет                                                                      |
| `prisma validate`                                                           | «The schema … is valid»                                                                       |
| `prisma migrate deploy` на одноразовой базе и на копии `altera_dev`         | «All migrations have been successfully applied»                                               |
| `prisma migrate diff --exit-code`                                           | «No difference detected», exit 0                                                              |
| `pnpm run smoke` на копии базы со всеми миграциями                          | сервер поднялся, GraphQL ответил, `/health` подтвердил PostgreSQL, Redis, миграции и revision |

Границы проверок: локальный зелёный набор не заменяет CI; `real`-провайдер не проверялся, потому
что его нет; браузерных сценариев задача не добавляет; число тестов взято из фактического вывода.

Прогон `tests/ai-check-queue-database.test.ts` добавлен в джоб `server-smoke`
(`T048_TEST_DATABASE_URL`): уникальный индекс и транзакция постановки на двойнике не проверяются.

## 7. Допущения и открытое

- **Суточная корзина агрегата стоимости** (UTC) — `[ДОПУЩЕНИЕ]`: величину периода спецификация
  не задаёт.
- **Порядок тегов** в подаче — по времени создания тега: связь `ArticleToTag` позиции не хранит,
  поэтому «первый — главный» (журнал §21.22) ещё не обеспечено. Позиция у связи — задача
  редактора (T-040), не этой.
- **Пометка 18+ автора** уходит в подачу как `false`: поля в базе пока нет, его вводит T-136.
  Придуманного значения не подставлялось.
- **Якорь категории** в записи причины не хранится: `review-history.md` §4 ожидает
  `reasons[] { category, anchor, text }`, но слаги якорей в юридическом тексте не утверждены.
  Якорь выводится из кода категории читающей стороной (T-078, T-040).
- **Текст причины `fake`** — заготовка двойника, а не утверждённая формулировка: утверждены
  только названия шести категорий. В production `fake` запрещён конфигурацией, поэтому автору
  заготовка не показывается.

## 8. Найденное расхождение (не правилось)

Карточка сводки `editorialProcesses` в `server/src/admin/dashboard.ts` считает AI-процессы по
`objectType: "Article"`, тогда как объект проверки по `ai-processes.md` §3 — версия статьи
(`ArticleTranslation`), и именно она пишется адаптером. Значение карточки останется нулевым.
Правка требует связи через `isEditorial`, а по `objectId` версии её не сделать выборкой Prisma:
это относится к разделу `/admin/ai` и сводке (T-078, T-069), а не к адаптеру. Молча менять
семантику чужой карточки в этой задаче нельзя, поэтому расхождение зафиксировано здесь.

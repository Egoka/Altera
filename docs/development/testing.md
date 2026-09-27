# Проверки Altera

`GET /health` проверяет `SELECT 1` через серверный Prisma client и, если задан `REDIS_URL`, `PING`
через тот же Redis client, который обслуживает кеш. Ответ — HTTP 200/503, `status`
(`ok`/`degraded`/`unavailable`), `revision` (валидный `RENDER_GIT_COMMIT` либо `null`), булевы
`checks.postgres`/`checks.migrations` и `checks.redis`: `true`/`false` для настроенного Redis либо
`"disabled"` без `REDIS_URL` (кеш noop, ADR-0019). HTTP 503 (`unavailable`) — только неготовые база
или миграции. Недоступный настроенный Redis даёт HTTP 200 и `degraded`: кеш отключён, API работает
(`docs/spec/80-observability/health-and-alerts.md` п. 1, 7).
Проверка миграций читает `_prisma_migrations`: все каталоги из `server/prisma/migrations`
должны иметь завершённую, не откаченную запись; незавершённые попытки, отсутствующая таблица
или каталог миграций дают HTTP 503. Проверка не применяет миграции и не возвращает их записи.
HTTP deadline — 4 секунды; результат кешируется внутри процесса 2 секунды. Параллельные
запросы используют одну проверку. После timeout новая проверка не запускается до завершения
предыдущей: это предотвращает накопление запросов к зависшей зависимости. Клиентский кеш отключён.
`GET` и `HEAD` на `/` без строки запроса и без `Accept: text/html` — проба платформы: сервер
отвечает на неё сам (HTTP 200, `ok`, без кеша) и не передаёт запрос в GraphQL. Иначе Yoga считал
бы пробу GraphQL-запросом без заголовка CSRF и писал бы `error.unhandled` на каждый деплой.
GraphiQL (`Accept: text/html`) и запросы GraphQL по адресу `/` этим не затронуты.
Server smoke в CI проверяет этот маршрут и точный SHA на временных PostgreSQL 17/Redis сервисах.

Браузерные сценарии при отказе сохраняют диагностику: Playwright пишет трассировку и снимок
экрана в `web/test-results`, а джоб «Браузерная проверка веба» выгружает этот каталог артефактом
`playwright-artifacts` (хранится 7 дней). Трассировка открывается `npx playwright show-trace`.
Повторов у браузерных тестов нет, поэтому в CI трассировка включена по отказу, а не по повтору.

## Конвертируемость тел материалов и репетиция миграций

```bash
pnpm verify:legacy-bodies
```

Скрипт (T-020, `server/scripts/verify-legacy-bodies.ts`) читает все тела материалов из
`articles.body`, `article_translations.body` и `article_revisions.body`, прогоняет каждое через
SQL-функцию конверсии `t020_legacy_body_to_document` и проверяет результат валидатором каталога
`readDocument` из `@altera/content`. Он ничего не изменяет: только `SELECT`. Коды выхода — 0, если
неконвертируемых тел нет; 1, если есть (идентификаторы печатаются); 2, если нет `DATABASE_URL` или
в базе нет функции конверсии, то есть миграции не применены. `articles.body` остаётся строковым
legacy-полем до перевода API на языковые версии, поэтому строки в этом источнике — ожидаемое
состояние, а не дефект.

Репетиция миграций с данными идёт на копии локальной базы, а не на development Neon:

```bash
docker exec altera-postgres-1 psql -U altera -d postgres \
  -c "CREATE DATABASE altera_rehearsal TEMPLATE altera_dev"
DATABASE_URL=postgresql://altera:altera@localhost:25432/altera_rehearsal \
DATABASE_URL_UNPOOLED=postgresql://altera:altera@localhost:25432/altera_rehearsal \
  pnpm --filter server exec prisma migrate deploy
```

`CREATE DATABASE … TEMPLATE` требует, чтобы к базе-шаблону не было подключений.
Миграционные тесты баз данных берут адрес из переменных вида `T020_TEST_DATABASE_URL`
(указывает на базу `postgres` того же сервера: тест создаёт и удаляет одноразовые базы сам).
Без такой переменной набор соответствующей задачи пропускается, а не падает.

## Актуальное состояние инфраструктуры после Task 3

Инфраструктура добавлена в `b8e00f13b53cd73db8571d248e6823165d5f3764`; исправление
пяти браузерных файлов — `1dad64f9fa0af196e32dd2f9f5676740c8d13797`. Node закреплён
в `.nvmrc` и engines как `24.12.0`, pnpm — `10.18.3` в корневом `packageManager`.
Это состояние конфигурации, а не утверждение, что все проверки прошли на этих commit.
Точные проверенные входы, вывод и ограничения находятся в
[первичном отчёте](../reports/evidence/2026-09-13-autonomy/task-3-initial-report.md) и
[отчёте fix1](../reports/evidence/2026-09-13-autonomy/task-3-fix1-report.md).

```bash
pnpm install --frozen-lockfile
pnpm format
pnpm lint
pnpm test
pnpm --filter server run build:ci
pnpm --filter nuxt-app run build
pnpm --filter nuxt-app run typecheck
pnpm --filter nuxt-app run test:e2e
```

`web/typecheck` — `nuxt prepare && node scripts/typecheck.mjs`. Скрипт берёт проекты из `references`
в `web/tsconfig.json` (app, server, shared, node), проверяет каждый отдельным
`vue-tsc --noEmit -p` без tsbuildinfo и последним печатает сводку «проект → exit, число ошибок».
Ошибка одного проекта не останавливает остальные; exit ненулевой, если упал хотя бы один.
Прежний `vue-tsc -b --noEmit` проверял те же проекты, но печатал ошибки одним потоком без
разбивки по проектам, и последней шла ошибка node-проекта (`nuxt.config.ts`). 2026-09-27 в его
выводе заметили только ошибку `nuxt.config.ts` при девяти ошибках app. В изолированном
воспроизведении `-b` эти девять ошибок показал, поэтому точная причина пропуска не установлена.
Команды запускаются по необходимости текущей задачи. Исторические результаты ниже
не ограничивают проверки в новом прямом запросе пользователя.

Плагин Tailwind в `web/nuxt.config.ts` проходит typecheck без приведения типов, пока в lockfile
одна копия `vite@7.0.5`. До 2026-09-27 их было две, различавшиеся необязательным peer `jiti`
(2.4.2 у Nuxt, 2.5.1 у vitest и корневого eslint). `@nuxt/schema` не объявляет vite в
зависимостях и получал копию, поднятую в `node_modules/.pnpm/node_modules`, а `@tailwindcss/vite`
— свою; при расхождении node-проект падал с TS2322 (`Plugin$1<any>[]` → `PluginOption`). jiti
перерешён на 2.5.1 без постоянных `overrides`: override добавили, выполнили
`pnpm install --lockfile-only`, убрали и повторили. Тем же приёмом jiti выровнен на 2.7.0 при
переходе на `tailwindcss` 4.3: `@tailwindcss/node` требует `^2.7.0`, и без выравнивания снова
появлялась вторая копия vite. Точный `jiti: 2.4.2` у `@prisma/config`
остался, vite он не касается. Если TS2322 вернётся, проверь `grep '^  vite@7' pnpm-lock.yaml`:
больше одной строки со скобками — дубль снова появился, и лечить его нужно выравниванием
расходящегося peer, а не кастом. `pnpm dedupe` здесь слишком широк: он заодно перерешает десятки
несвязанных пакетов. `ls node_modules/.pnpm` для этой проверки ненадёжен: pnpm хранит
осиротевшие каталоги до 7 дней (`modules-cache-max-age`).

| Проверка         | Наблюдаемый результат и граница                                                             |
| ---------------- | ------------------------------------------------------------------------------------------- |
| Unit             | 24 passed и 1 todo; todo отражает открытый T-027, не выполненную SDL-проверку безопасности  |
| Format/lint      | Прошли; fix1 имеет сохранённые raw outputs и входные хэши                                   |
| Server/web build | Прошли в Task 3; `build:ci` не применяет миграции                                           |
| Web typecheck    | 2026-09-27: exit 0 во всех четырёх проектах; Exit 2 и девять диагностик — срез Task 3       |
| Browser smoke    | После исправления проверки title: один failed, девять skipped; HTML title пуст              |
| T-112            | Девять подготовленных сценариев skipped; flow 16 имеет непринятый дефект последовательности |

Текущий workflow для PR в `app` читает Node из `.nvmrc` и содержит четыре prerequisite jobs:
`checks`, `server-smoke`, `web-checks`, `web-smoke`. Итоговый `test` с `if: always()` требует
успеха всех четырёх. Локальные unit/build результаты не означают зелёный aggregate CI.
Исходный вывод двух typecheck-попыток и некоторые первые RED не сохранились: отчёт явно
фиксирует этот пробел. Новые результаты фиксируются отдельно и не восстанавливают потерянный старый вывод.

## Исторический срез до инфраструктурных изменений

- **Срез**: 2026-09-13, commit `2e542a0774a2fae7c38e7f19e7255ebf6a673ed3`, чистое
  исходное дерево.
- **Локальная среда среза**: Node `v24.3.0`, pnpm `10.18.3`.
- **Источник команд**: корневой `package.json`, `server/package.json`, `web/package.json`,
  `.github/workflows/pull_request.yml`, `.husky/pre-commit`.

Это датированный перечень исполняемых команд и границ evidence. Он заменяет старое утверждение
«тестов нет», сохранённое как исторический факт в
[CLAUDE до переноса](sources/2026-09-13-claude-original.md).

### Тестовый набор исторического среза

Корневая команда `pnpm test` выполняет `pnpm -r test`. На указанной ревизии она запускает
Vitest в двух пакетах:

| Пакет               | Скрипт       | Файлы                                              | Результат среза           |
| ------------------- | ------------ | -------------------------------------------------- | ------------------------- |
| `server`            | `vitest run` | `tests/permissions.test.ts`, `tests/admin.test.ts` | 2 файла, 19 тестов passed |
| `nuxt-app` (`web/`) | `vitest run` | `tests/i18n-locales.test.ts`                       | 1 файл, 5 тестов passed   |

Фактический запуск из корня завершился с exit code `0`: 3 test files и 24 tests passed.
Это подтверждает только перечисленный набор. Команда не доказывает браузерные сценарии,
связность веба с API, миграции, production SSR, внешние сервисы или полноту покрытия.

Тест одного пакета:

```bash
pnpm --filter server test
pnpm --filter nuxt-app test
```

Имя веб-пакета — `nuxt-app` из `web/package.json`; фильтр `--filter web` не является его
каноническим именем.

### Формат, lint и сборка исторического среза

```bash
pnpm format
pnpm lint
pnpm test
cd server && pnpm run build:ci
```

- `pnpm format` вызывает Prettier в режиме `--check` и не форматирует файлы.
- `pnpm format:fix` вызывает `--write` и изменяет файлы; запускай его только для разрешённого
  набора, когда массовая перезапись всего монорепозитория не входит в scope.
- `pnpm lint` запускает ESLint во всех workspace-пакетах.
- `server`-скрипт `build` включает `prisma migrate deploy` и имеет внешний побочный эффект при
  настроенной базе. Для CI-сборки без применения миграций используется `build:ci`.
- Pre-commit hook запускает `npm run format`, `npm run lint`, `npm run test`.

### CI исторического среза

Workflow `.github/workflows/pull_request.yml` работает для pull request в `app` на Node 20:

1. job `checks` выполняет frozen install, format, lint и `pnpm test`;
2. job `server-smoke` собирает server через `build:ci`, проверяет `dist/server.js` и запускает
   `pnpm run smoke` с Redis service;
3. итоговый job `test` с `if: always()` явно падает, если любой из двух предыдущих job не
   завершился успешно.

Старый вызов `timeout 2s pnpm start || true` оставлен только в комментарии workflow как история;
текущий smoke-скрипт не маскируется этой конструкцией. Локальный зелёный `pnpm test` всё равно
не заменяет CI smoke и не подтверждает запуск сервера.

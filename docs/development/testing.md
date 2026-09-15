# Проверки Altera

`GET /health` проверяет `SELECT 1` через серверный Prisma client и `PING` через тот же
Redis client, который обслуживает кеш. Ответ — HTTP 200/503, `status`, `revision`
(валидный `RENDER_GIT_COMMIT` либо `null`) и булевы `checks.postgres`/`checks.redis`.
HTTP deadline — 4 секунды; результат кешируется внутри процесса 2 секунды. Параллельные
запросы используют одну проверку. После timeout новая проверка не запускается до завершения
предыдущей: это предотвращает накопление запросов к зависшей зависимости. Клиентский кеш отключён.
Server smoke в CI проверяет этот маршрут и точный SHA на временных PostgreSQL 17/Redis сервисах.

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

`web/typecheck` использует установленный `vue-tsc` через `nuxt prepare && vue-tsc -b --noEmit`.
Команды запускаются по необходимости текущей задачи. Исторические результаты ниже
не ограничивают проверки в новом прямом запросе пользователя.

| Проверка         | Наблюдаемый результат и граница                                                             |
| ---------------- | ------------------------------------------------------------------------------------------- |
| Unit             | 24 passed и 1 todo; todo отражает открытый T-027, не выполненную SDL-проверку безопасности  |
| Format/lint      | Прошли; fix1 имеет сохранённые raw outputs и входные хэши                                   |
| Server/web build | Прошли в Task 3; `build:ci` не применяет миграции                                           |
| Web typecheck    | Exit 2, девять диагностик; T-001 остаётся открыт                                            |
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

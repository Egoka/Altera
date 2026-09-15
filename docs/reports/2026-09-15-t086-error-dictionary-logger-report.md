# Отчёт: словарь ошибок и структурированный логгер

- **Дата**: 2026-09-15
- **План**: `docs/plans/2026-09-15-t086-error-dictionary-logger.md`
- **Задача / authorization**: T-086, native issue `01a0a297-e719-78ad-85d8-20a08cc4878c`; recovery разрешён комментарием `01a0a302-8b35-70eb-be6c-f90d928de6cd`
- **Ветка**: `server/t086-error-dictionary`
- **Baseline**: `5271880f5ba228f315573219f9106f622ec98653`, исходное дерево clean
- **Проверенная revision**: `4bb55c9d6572f83ab40ebcaa9094be71e7e57204`; source diff к revision отсутствовал, незакоммичен был только этот отчёт
- **Коммиты**: `349feb4` (словарь), `4b1fbea` (логгер/privacy), `9d057e8` (Yoga boundary), `c8781cd` (миграция resolver/helpers), `4bb55c9` (review hardening)
- **Actor / run**: Altera — разработчик (`b0f3bc32-dd95-471e-b40e-517aaf83edf0`), issue ALTE-20, trigger `01a0a302-8b35-70eb-be6c-f90d928de6cd`
- **Run outcome**: success
- **Stage outcome**: завершена
- **Task acceptance**: не проверено
- **Результат**: выполнено полностью

## Что сделано

- Добавлен executable dictionary для кодов #1–11 и #89 с typed factory, обязательными полями,
  allowlist extensions и provider union `psp | ai | mail | storage`.
- Добавлен module-private `WeakMap` factory identities. Masker обходит `originalError` и `cause`
  breadth-first, защищён от циклов/throwing getters и доверяет только сохранённому immutable snapshot.
- Yoga использует custom `maskedErrors.maskError`; неизвестная ошибка возвращается как
  `INTERNAL_ERROR` без исходных message, stack, cause и extensions.
- Добавлен pino-backed `AppLogger`, frozen registry событий, обязательные service/environment/event,
  ровно один correlation key и recursive sanitization до destination.
- Добавлены purpose-separated HMAC-SHA-256 helpers для нормализованного e-mail и дневного IP hash;
  `LOG_HASH_SECRET` обязателен и представлен только placeholder-ом в `server/env.example`.
- Resolver/helpers переведены на canonical errors. Удалены direct/bare/unknown GraphQL errors,
  открытый magic link, `console.*` в `server/src` и pseudo-audit `logAdminOperation`.
- Добавлены regression/source-contract тесты; ESLint запрещает `console.*` во всём server source.

## Что не сделано и почему

- Локальный smoke не запускался: `DATABASE_URL`, `DIRECT_URL`, `REDIS_URL`,
  `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET` и `LOG_HASH_SECRET` в окружении run отсутствуют.
  Скрипт требует собранный server и доступный Redis;
  подставлять фиктивные production-like секреты или объявлять такой запуск Redis-check нельзя.
- Независимая тестовая приёмка, review, merge, Render deploy и deployed health относятся к следующим
  стадиям и этим developer run не подтверждаются.

## Отклонения от плана

- После двух исторических падений AC-1 работа была остановлена. Архитектор обновил план коммитом
  `17a8eb9b`, а оркестратор разрешил один recovery cycle. В нём nominal `instanceof` был заменён на
  private WeakMap membership и traversal wrapper chain; recovery завершился успешно.
- Первый `build:ci` обнаружил ES2022-only обращения `Object.hasOwn` и `Error.cause` при target ES2020.
  Они заменены эквивалентными structural/hasOwnProperty проверками без изменения `tsconfig`; повторный
  `build:ci` прошёл.
- Команды плана вида `vitest run -- <file>` в установленной конфигурации исполняют все server tests.
  В отчёте отдельно указано число сценариев целевого файла и общий фактический результат Vitest.
- Заключительный read-only review не нашёл Critical issues и выявил четыре Important и один Minor:
  redaction IP/raw magic token, bounded wrapper traversal, source-mode import, expected JWT failures и
  runtime correlation-key validation. Все замечания закрыты regression-тестами в `4bb55c9`.

## Затронутые файлы

- Контракт ошибок: `server/src/errors/*`, `server/src/exceptions/permissions.ts`, resolver modules и
  `server/src/utils/admin.ts`.
- Логирование/privacy: `server/src/observability/*`, `server/src/prisma.ts`, `server/src/server.ts`,
  `server/src/cache/redis.ts`, `server/env.example`.
- Зависимости/config: `server/package.json`, `pnpm-lock.yaml`, `eslint.config.mjs`.
- Тесты: dictionary, logger, Yoga boundary, source contract, permissions/admin/cache fixtures.
- Документация: обновлённый техплан и этот отчёт.

## Как проверено

Общее для проверок: actor — Altera — разработчик; stage — реализация; cwd —
`/Users/egorbondarenko/WebstormProjects/Altera/.worktrees/t086-error-dictionary`; revision —
`4bb55c9d6572f83ab40ebcaa9094be71e7e57204`; source dirty fingerprint — clean относительно revision
(кроме untracked report); checked at `2026-09-15T06:15:58+03:00`; trace_ref — issue ALTE-20 и trigger
`01a0a302-8b35-70eb-be6c-f90d928de6cd`.

### `t086-ac1-yoga-error-mask`

- Command: `pnpm --dir server test -- graphql-error-boundary.test.ts`; exit code 0.
- Target: 9 Yoga scenarios: unknown, known, malformed, forged extensions, `originalError`, `cause`,
  cyclic/expansive graphs и immutable snapshot. Значимый общий вывод: 10 files passed, 69 tests
  passed, 1 todo.
- Результат: unknown resolver error даёт фиксированный `INTERNAL_ERROR` и тот же fallback requestId,
  не раскрывая исходные message/stack/extensions; forged errors остаются unknown.
- Recovery history: две прежние попытки на `4b1fbea` + WIP дали exit 1 на known error и были
  сохранены в blocker comment `01a0a2f6-5942-76db-b102-82be88ad873d`. После replanning `17a8eb9b`
  единственный разрешённый recovery на `9d057e8` дал exit 0 (8 files, 56 passed, 1 todo); свежая
  проверка на source SHA выше также дала exit 0.

### `t086-ac2-log-pii-redaction`

- Command: `pnpm --dir server test -- logger.test.ts`; exit code 0.
- Target: 6 logger/privacy scenarios. Значимый общий вывод: 10 files passed, 69 tests passed, 1 todo.
- Результат: destination не получает открытые e-mail, token, JWT, Bearer credential, magic link или
  ПД из nested data/Error stack/cause; HMAC нормализует e-mail и разделяет purpose/day.

### `t086-error-dictionary-contract`

- Command: `pnpm --dir server test -- error-dictionary.test.ts error-contract.test.ts`; exit code 0.
- Target: 11 dictionary/source-contract scenarios; общий вывод: 10 files passed, 69 tests passed,
  1 todo. Проверены exact codes, `storage`, invalid code rejection, отсутствие direct GraphQLError и
  `console.*` вне canonical boundary/generated source.

### `t086-server-gate`

- `pnpm format` — exit 0, все файлы соответствуют Prettier.
- `pnpm lint` — exit 0, включая `no-console: error` для `server/src`.
- `pnpm test` — exit 0: server 10 files / 69 passed / 1 todo; web 10 files / 73 passed.
- `pnpm --dir server run build:ci` — первый exit 2 из-за двух ES2022-only type references; после
  bounded compatibility fix повторный exit 0 (`prisma generate`, `tsc`, GraphQL/generated copy).
- `JWT_ACCESS_SECRET=test-only JWT_REFRESH_SECRET=test-only LOG_HASH_SECRET=test-only PORT=0 pnpm --dir server exec ts-node src/server.ts`
  — source-mode процесс остался запущен до контролируемого SIGINT; canonical boundary module
  разрешился без прежнего `Cannot find module ...graphql-error.js`. Значения были локальными
  test-only placeholders, не environment secrets.
- `pnpm --dir server run smoke` — not_run: обязательные DB/Redis/JWT/hash-secret env vars отсутствуют.
- Ограничение среды: repository требует Node 24.12.0, run выполнен на Node 24.3.0; все выполненные
  checks завершились exit 0 после описанного build fix. Единственный todo существовал ранее и к T-086
  не относится.

## Что осталось

1. Независимому тестировщику повторить AC-1/AC-2 и полный gate на переданном source SHA.
2. Reviewer-у проверить WeakMap trust boundary, dictionary fields, PII sanitization и scope diff.
3. После приёмки выполнить обычные PR/merge/release стадии; backend deploy потребует безопасно задать
   `LOG_HASH_SECRET` в разрешённом окружении и отдельно подтвердить Render/HTTP/DB/Redis status.

## Handoff и история попыток

- Branch/source: `server/t086-error-dictionary` / `4bb55c9d6572f83ab40ebcaa9094be71e7e57204`.
- Persistent AC-1 failures до recovery: 2; причина — Yoga located wrapper и ненадёжный nominal
  `instanceof`. Recovery authorization сохранён, реализация WeakMap прошла обязательный check.
- AC-2 не имел persistent failure; logger test прошёл на исходном logger commit и повторён на итоговом
  source SHA.
- Дубликат parent/implementation не создавался; следующий владелец — независимый тестировщик, затем
  reviewer. Developer acceptance не объявляется независимой приёмкой.

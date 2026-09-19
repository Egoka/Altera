# Отчёт: `/health` не падает в 503 без Redis

- **Дата**: 2026-09-19
- **План**: `docs/plans/2026-09-19-health-redis-optional.md`
- **Ветка**: `server/health-redis-optional`
- **Задача**: прямое поручение владельца
- **Базовый коммит**: `1ef2ac5185acaef10073f648272683202508e948` (origin/app)
- **Статус**: завершён, PR в `app`

## 1. Итог

Без `REDIS_URL` `GET /health` отвечает 200 и `checks.redis: "disabled"`, если база и миграции
готовы. Настроенный, но недоступный Redis даёт 200 и `status: "degraded"` с `checks.redis: false`.
HTTP 503 остаётся только для неготовых базы или миграций. Ответ по-прежнему не содержит текстов
ошибок драйверов, строк подключения и секретов.

## 2. Причина

`server/src/server.ts` всегда передавал в проверку `cache.isReady()`. Без `REDIS_URL` кеш — `NoopCache`,
его `isReady()` честно возвращает `false`, а `createHealthCheck` требовал `redis === true` для `ok`
и отдавал 503 на всё остальное. Сама noop-реализация не менялась: решение о том, проверять ли Redis,
теперь принимается по `cache.mode`.

## 3. Изменения

| Файл                          | Изменение                                                                                                                                                                                                                                                                                    |
| ----------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `server/src/health.ts`        | `redis` в зависимостях необязателен; `redisReadiness(cache)` возвращает пробу только для `mode === "redis"`; `checks.redis` — `true`/`false`/`"disabled"`; статус `unavailable` (503) при неготовых базе или миграциях, `degraded` (200) при недоступном настроенном Redis, иначе `ok` (200) |
| `server/src/server.ts`        | передаёт `redisReadiness(cache)` вместо безусловного `cache.isReady()`                                                                                                                                                                                                                       |
| `server/tests/health.test.ts` | общий фейковый Redis client; блок «optional Redis (ADR-0019)» — 7 тестов                                                                                                                                                                                                                     |
| `docs/development/testing.md` | описание контракта `/health`                                                                                                                                                                                                                                                                 |

## 4. Решение по недоступному настроенному Redis

По `docs/spec/80-observability/health-and-alerts.md`: п. 1 — `[ДОПУЩЕНИЕ: 503 только при недоступной
базе; провайдеры — деградация без 503]`, п. 7 — недоступный Redis означает отключённый кеш, §5 —
«недоступный Redis → `/health` показывает `redis: down`, API отвечает». Поэтому настроенный, но
недоступный Redis — HTTP 200, `checks.redis: false`, `status: "degraded"`. Значение `degraded` —
техническое обозначение этой деградации в ответе, новых продуктовых правил нет.

Совместимость: для настроенного Redis `checks.redis` остаётся булевым. CI smoke
(`server/scripts/smoke.sh:72`) и приёмка deploy (`scripts/autonomy/deploy_evidence.py:64`) работают
с настроенным Redis (в CI — service, на production — Render Key Value) и по-прежнему требуют
`status: "ok"` и `checks.redis === true`; они не менялись и остаются строгими.

## 5. Проверки

Node `v24.12.0`, pnpm `10.18.3`, `pnpm install --frozen-lockfile` — exit 0.

**RED** (до изменения `health.ts`/`server.ts`), `npx vitest run tests/health.test.ts` в `server`:
exit 1, `Tests 7 failed | 10 passed (17)`. Шесть новых тестов упали на `TypeError: redisReadiness is
not a function`, тест зависшей пробы — на `status: "unavailable"` вместо `"degraded"`. Отдельным
временным тестом (удалён) подтверждено исходное поведение: с проводкой прежнего `server.ts` и
`createCache({ redisUrl: undefined })` проверка возвращает
`{ status: "unavailable", checks: { postgres: true, redis: false, migrations: true } }`, то есть 503.

**GREEN**, после изменения:

| Команда                                                   | Результат                                                                                                          |
| --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `npx vitest run tests/health.test.ts` (server)            | exit 0, 17 passed                                                                                                  |
| `pnpm test`                                               | exit 0; server: 26 files passed, 8 skipped; 163 tests passed, 20 skipped; web: 21 files, 155 tests passed          |
| `pnpm lint`                                               | exit 0                                                                                                             |
| `pnpm format`                                             | exit 0 (первый прогон — exit 1 только по `server/tests/health.test.ts`; исправлено `prettier --write` этого файла) |
| `pnpm --filter server run build:ci`                       | exit 0 (включает `tsc` по `server/src` в strict)                                                                   |
| `tsc --noEmit --strict` для `server/tests/health.test.ts` | exit 0                                                                                                             |

Skipped в server — database-тесты, которым нужна отдельная тестовая база; к `/health` они не относятся.

**Smoke собранного `server/dist/server.js`** (dummy-секреты только для старта, запуск из пустого
каталога, чтобы не подхватить `.env`; одноразовый контейнер `postgres:17-alpine` на
`127.0.0.1:55491`, миграции применены `prisma migrate deploy` — «All migrations have been
successfully applied»; контейнер остановлен):

| Окружение                                 | Ответ                                                                                                                  |
| ----------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| без `REDIS_URL`, база недоступна          | HTTP 503, `{"status":"unavailable","revision":null,"checks":{"postgres":false,"redis":"disabled","migrations":false}}` |
| без `REDIS_URL`, база и миграции готовы   | HTTP 200, `{"status":"ok","revision":null,"checks":{"postgres":true,"redis":"disabled","migrations":true}}`            |
| `REDIS_URL` на закрытый порт, база готова | HTTP 200, `{"status":"degraded","revision":null,"checks":{"postgres":true,"redis":false,"migrations":true}}`           |

## 6. Критерии готовности

| AC      | Результат | Evidence                                                                                                                                                                 |
| ------- | --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| AC-HR-1 | выполнен  | тест `returns 200 and reports Redis as disabled without REDIS_URL` (`undefined`, `""`, `"  "`); smoke без `REDIS_URL`                                                    |
| AC-HR-2 | выполнен  | тест `returns 503 without driver details when Postgres is down and Redis is disabled`; прежний тест 503; smoke с недоступной базой                                       |
| AC-HR-3 | выполнен  | тесты `degrades without 503 when configured Redis is unreachable` и `degrades at the shared deadline when a configured Redis probe hangs`; smoke с закрытым портом Redis |
| AC-HR-4 | выполнен  | прежние тесты health без изменения ожиданий; smoke-скрипт и `deploy_evidence.py` не в diff                                                                               |
| AC-HR-5 | выполнен  | раздел 5                                                                                                                                                                 |

## 7. Ограничения и дальнейшее

- CI smoke с Redis service проверит неизменный путь `ok`; путь без Redis в CI не запускается —
  он покрыт unit-тестами и локальным smoke выше.
- Остальные компоненты spec п. 1 (`db` вместо `postgres`, `psp`, `ai`, `mail`, `storage`, возраст
  резервных копий) не реализованы — вне поручения.
- Если production когда-либо запустят без `REDIS_URL`, `deploy_evidence.py` отклонит `"disabled"`:
  это сознательно строгая приёмка, её ослабление — отдельное решение.

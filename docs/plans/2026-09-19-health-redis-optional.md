# `/health` не падает в 503 без Redis

- **Дата**: 2026-09-19
- **Ветка**: `server/health-redis-optional`
- **Задача**: прямое поручение владельца
- **Authorization**: письменное поручение в диалоге 2026-09-19 — «make /health report Redis as not
  configured/disabled (not failed) when REDIS_URL is absent, keep 200 when Postgres and migrations are OK,
  and decide per the spec whether a configured-but-unreachable Redis should degrade without 503»; границы —
  серверный `/health`, тесты Vitest в `server/tests`, план/отчёт, PR в `app`
- **Базовый коммит**: `1ef2ac5185acaef10073f648272683202508e948` (origin/app)
- **Исходное дерево**: clean (новый worktree от origin/app)
- **Отчёт**: `docs/reports/2026-09-19-health-redis-optional-report.md`
- **Статус**: выполняется

## 1. Цель

Сервер без `REDIS_URL` отвечает на `GET /health` кодом 200, когда база и миграции готовы, и явно
показывает, что Redis не настроен, а не сломан. Настроенный, но недоступный Redis — деградация без 503.

## 2. Контекст

- `server/src/cache/index.ts:15-21` — без `REDIS_URL` `createCache` возвращает `NoopCache`.
- `server/src/cache/noop.ts:6-8` — `NoopCache.isReady()` возвращает `false`: у noop нет готового Redis,
  это значение верно само по себе.
- `server/src/server.ts:48` — `/health` всегда опрашивает `cache.isReady()`, не глядя на `cache.mode`.
- `server/src/health.ts:60` — `status` равен `ok` только при `postgres && redis && migrations`;
  `server/src/health.ts:114` — всё, кроме `ok`, отдаёт 503.
- Итог: без `REDIS_URL` `/health` = 503, хотя сервер исправно работает.

Требования:

- ADR-0019 п. 1 — сервер стартует без `REDIS_URL`, ошибка кеша не ломает запрос.
- `docs/spec/80-observability/health-and-alerts.md` п. 1 — API проверяет Redis «при включении»;
  `[ДОПУЩЕНИЕ: 503 только при недоступной базе; провайдеры — деградация без 503]`; без ПДн и секретов.
- Там же п. 7 — недоступный Redis означает отключённый кеш; §5 — «недоступный Redis → `/health`
  показывает `redis: down`, API отвечает».

Потребители формата ответа (проверены `git grep`):

- `server/scripts/smoke.sh:72` — CI smoke запускается с `REDIS_URL` и требует `status: "ok"` и
  `checks.redis === true`;
- `scripts/autonomy/deploy_evidence.py:64` — приёмка deploy требует `status == "ok"` и
  `checks[*] is True`; на production Redis настроен (`docs/development/render-neon.md`, Render Key Value).

## 3. Решение

- `checks.redis`: `true` — Redis настроен и ответил `PONG`; `false` — настроен, но недоступен
  (spec §5 `redis: down`); `"disabled"` — `REDIS_URL` не задан, проверка не выполняется.
  Булевы значения для настроенного Redis сохраняются, поэтому smoke и `deploy_evidence.py` не меняются.
- `status`: `unavailable` (HTTP 503) — база или миграции не готовы; `degraded` (HTTP 200) — база и
  миграции готовы, настроенный Redis недоступен; `ok` (HTTP 200) — все настроенные зависимости готовы,
  в том числе при `redis: "disabled"`.
- Проверка миграций сохраняет 503: это существующее условие готовности схемы базы, поручение прямо
  требует 200 только при готовых Postgres и миграциях.
- `NoopCache.isReady()` не меняется. Решение о пробе принимает функция `redisReadiness(cache)` в
  `server/src/health.ts` по `cache.mode`; `server.ts` передаёт её результат в `createHealthCheck`.

## 4. Шаги

1. RED: в `server/tests/health.test.ts` тесты «без `REDIS_URL` → 200, `redis: "disabled"`»,
   «недоступный настроенный Redis → 200, `degraded`, `redis: false`, без текста ошибки»,
   «Postgres недоступен → 503»; убедиться, что новые тесты падают по ожидаемой причине.
2. GREEN: `server/src/health.ts` — необязательная проба Redis, три статуса, HTTP 503 только для
   `unavailable`, `redisReadiness`; `server/src/server.ts` — передать `redisReadiness(cache)`.
3. Обновить описание `/health` в `docs/development/testing.md`.
4. `pnpm test`, `pnpm lint`, `pnpm format`, `pnpm --filter server run build:ci`.
5. Отчёт, commit, push, PR в `app`.

## 5. Критерии готовности

- **AC-HR-1**: без `REDIS_URL` (`createCache({})` и пустая строка) `/health` = 200,
  `{ status: "ok", checks: { postgres: true, redis: "disabled", migrations: true } }` — Vitest.
- **AC-HR-2**: Postgres недоступен → 503, `status: "unavailable"`, тело без текста ошибки драйвера —
  Vitest, в том числе при выключенном Redis.
- **AC-HR-3**: настроенный Redis недоступен при готовых базе и миграциях → 200, `status: "degraded"`,
  `checks.redis: false`, тело без текста ошибки — Vitest.
- **AC-HR-4**: при готовом настроенном Redis ответ прежний (`ok`, все `true`); существующие тесты
  health, CI smoke и `deploy_evidence.py` не требуют изменений — Vitest и `git diff`.
- **AC-HR-5**: `pnpm test`, `pnpm lint`, `pnpm format`, `build:ci` сервера — exit 0.

## 6. Что сознательно не входит

- Остальные компоненты spec п. 1 (`psp`, `ai`, `mail`, `storage`, возраст резервных копий) и
  переименование `postgres` в `db` — отдельные задачи.
- Изменение `deploy_evidence.py` и smoke: они проверяют окружения с настроенным Redis и остаются строгими.
- Проверка старта сервера без `REDIS_URL` целиком (T-006) и лимиты частоты (ADR-0024).
- Правка спецификаций: реализация приводится к уже принятому тексту, новых правил нет.

## 7. Риски

- Внешний потребитель, ожидающий только булевы `checks.redis` — такой потребитель в репозитории
  один набор (smoke, deploy evidence), оба работают с настроенным Redis; значение `"disabled"`
  появляется только без `REDIS_URL`.
- Зависшая проба Redis — общий deadline 4 секунды сохраняется; при timeout настроенный Redis
  остаётся `false`, ответ — `degraded` с 200.

## 8. Стадии и handoff

Прямое поручение: одна стадия реализации в этом worktree, итог — PR в `app` и отчёт с фактическим
выводом проверок.

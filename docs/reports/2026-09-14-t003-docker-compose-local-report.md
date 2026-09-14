# Отчёт: T-003 локальное окружение Docker Compose

- **Дата**: 2026-09-14
- **План**: `docs/plans/2026-09-14-t003-docker-compose-local.md`
- **Задача / authorization**: T-003 / ALTE-9, статус `готова` в `docs/backlog/tasks/T-003-docker-compose-local.md`
- **Ветка**: `codex/autopilot-start`
- **Baseline**: `3716f3048a660d678af17957b578fdf4624d30f2`; исходный dirty fingerprint зафиксирован в плане
- **Проверенная revision**: `3716f3048a660d678af17957b578fdf4624d30f2` + незакоммиченный T-003 diff: `docker-compose.yml` `c1f480c53dc6aa9a57019dd39d71ce06e178519abf8ff4172a0f6d06b8f9c58e`; `server/env.example` `9bd42f7b45a1ca359f99afb57dc286389059d9a94487f868904a080caac009cf`; `docs/guides/README.md` `7ff166328b4c63910cfb3a48eab2ec9a7996bef9f2654f9579102ff0459a9118`; `docs/guides/local-development.md` `59b3d893992b268ec45c5bf53f3f85a826f18edaea4767a51c9b2b3f516b7b4e`; план `7d9b60cac0ae54bebf7ef5b3a95142dccc3385c9dadc5d61fccff84a08664d83`
- **Коммиты**: нет; результат не готов к коммиту и независимому ревью
- **Actor / run**: релиз-инженер / ALTE-9
- **Run outcome**: blocked
- **Stage outcome**: остановлена
- **Task acceptance**: не проверено
- **Результат**: выполнено частично

## Что сделано

- Добавлен `docker-compose.yml` для PostgreSQL 16, Redis 7 и Mailpit, с именованным томом и healthcheck каждого сервиса.
- Локальные адреса PostgreSQL и Redis в `server/env.example` согласованы с Compose; реальные секреты не добавлялись.
- Добавлено `docs/guides/local-development.md` и ссылка на него из индекса руководств: запуск зависимостей, server/web, GraphQL curl и явное ограничение почтовой проверки до T-021.

## Что не сделано и почему

Не получены evidence `docker compose ps` с тремя сервисами и GraphQL curl. `docker compose up -d` завис на pull `axllent/mailpit:v1.30.6`: за 70 секунд не началась загрузка образа, сервисы не созданы. Команда прервана её собственным PID; `docker compose ps` после этого пуст. Без PostgreSQL и Redis запуск server не проверялся, чтобы не подменять требуемый сценарий внешним окружением.

## Отклонения от плана

Нет изменений архитектуры или scope. Остановка вызвана внешней недоступностью загрузки образа.

## Затронутые файлы

- `docker-compose.yml`
- `server/env.example`
- `docs/guides/README.md`
- `docs/guides/local-development.md`
- `docs/plans/2026-09-14-t003-docker-compose-local.md`
- `docs/reports/2026-09-14-t003-docker-compose-local-report.md`

## Как проверено

| AC-ID / check_id | Команда и значимый вывод | Результат |
| --- | --- | --- |
| AC-1 / compose-config | `docker compose config --quiet`, exit 0 | Пройдено: YAML и Compose-конфигурация валидны. |
| AC-1 / compose-up | `docker compose up -d`, образ Mailpit оставался в состоянии `Pulling` 70 секунд, затем команда прервана; `docker compose ps` вывел только заголовок без сервисов | Заблокировано внешней загрузкой образа. |
| AC-2 / graphql-curl | Не запускалась: AC-1 не создал локальные PostgreSQL и Redis. | Не проверено. |
| AC-3 / format | `pnpm format:fix`, exit 0 | Пройдено. |
| AC-3 / lint | `pnpm lint`, exit 0 | Пройдено. |
| AC-3 / test | `pnpm test`, exit 0: server — 19 passed, 1 todo; web — 56 passed | Пройдено. |
| AC-4 / guide | Ручная сверка `docs/guides/local-development.md` с T-003: описаны Compose, server, web, curl, Mailpit и ограничение до T-021. | Пройдено. |
| diff-check | `git diff --check`, exit 0 | Пройдено. |

## Что осталось

После восстановления доступа Docker к `axllent/mailpit:v1.30.6` повторить только `compose-up` и, при успехе, `docker compose ps`, запуск `server` с `server/.env` и GraphQL curl. Затем обновить этот отчёт новым evidence и передать актуальную revision независимому ревьюеру.

## Handoff и история попыток

- **Цель**: подтвердить AC-1 и AC-2 на текущем T-003 diff.
- **Persistent failures**: `compose-up → 1` завершённая попытка: pull Mailpit не начал загрузку за 70 секунд; конфигурация не менялась между диагностическими запусками.
- **Условие возобновления**: Docker должен получить образ `axllent/mailpit:v1.30.6`; проверяемое условие — `docker compose up -d` завершается с exit 0 и `docker compose ps` содержит три сервиса.
- **Следующий разрешённый шаг**: повторить заблокированную проверку, не заменяя Mailpit другим образом или внешним сервисом.

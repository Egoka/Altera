# Отчёт: T-003 локальное окружение Docker Compose — снятие блокера и завершение

- **Дата**: 2026-09-17
- **План**: `docs/plans/2026-09-14-t003-docker-compose-local.md`
- **Предыдущий отчёт**: `docs/reports/2026-09-14-t003-docker-compose-local-report.md` (run outcome `blocked`)
- **Задача / authorization**: T-003 / ALTE-9; прямой запрос владельца разобрать задачу и довести её до решения
- **Baseline**: `7a900e026ece570fa483017a8edc73fb58618863` (tip `app`)
- **Actor / run**: релиз-инженер
- **Run outcome**: завершено
- **Task acceptance**: AC-1 и AC-2 подтверждены фактическим выводом; AC-3 остаётся отложенным до T-021

## Снятый блокер

Предыдущий заход остановился на том, что `docker compose up -d` не мог получить образ
`axllent/mailpit:v1.30.6`: pull не начинал загрузку 70 секунд. В текущем заходе
`docker pull axllent/mailpit:v1.30.6` завершился успешно, digest
`sha256:7f33095f80e901f6ad08028f06ca284aa58fe84942be5496008d041d3b9f4d4d`. Внешняя причина
отпала; конфигурация Compose ради обхода не менялась.

## Собственные порты проекта

При первом запуске на стандартных портах Compose упал: `Bind for 127.0.0.1:1025 failed: port is
already allocated` — порты 5432, 6379, 1025 и 8025 на машине владельца заняты другим локальным
проектом (`bilinv-*`). Поскольку это воспроизведётся на любой машине с несколькими локальными
стеками, порты Altera переведены на собственную схему «2 + стандартный порт»:

| Сервис | Порт хоста | Порт контейнера |
| --- | --- | --- |
| PostgreSQL | 25432 | 5432 |
| Redis | 26379 | 6379 |
| Mailpit SMTP | 21025 | 1025 |
| Mailpit UI | 28025 | 8025 |

Порты внутри контейнеров и внутренняя сеть Compose не менялись, поэтому схема не влияет ни на
CI (`.github/workflows/pull_request.yml` использует service containers со стандартными портами),
ни на прод. Изменение согласовано в `server/env.example`, `server/ENV_SETUP.md` и
`docs/guides/local-development.md`.

## Затронутые файлы

- `docker-compose.yml`
- `server/env.example`
- `server/ENV_SETUP.md`
- `docs/guides/local-development.md`
- `docs/reports/2026-09-17-t003-docker-compose-local-completion-report.md`

## Как проверено

| AC-ID / check_id | Команда и значимый вывод | Результат |
| --- | --- | --- |
| AC-1 / compose-config | `docker compose config --quiet`, exit 0 | Пройдено. |
| AC-1 / compose-up | `docker compose up -d`, затем `docker compose ps`: три сервиса `altera-postgres-1`, `altera-redis-1`, `altera-mailpit-1` в статусе `Up (healthy)` с портами 25432, 26379, 21025/28025 | Пройдено. |
| AC-2 / migrate | `pnpm prisma:migrate:deploy` против поднятой базы: `All migrations have been successfully applied.` | Пройдено. |
| AC-2 / graphql-curl | `curl -sS -X POST http://localhost:4000/ -H 'Content-Type: application/json' --data '{"query":"{ __typename }"}'` → `{"data":{"__typename":"Query"}}` | Пройдено. |
| AC-3 / mailpit-ui | `curl` к `http://localhost:28025/` → HTTP 200; SMTP-приёмник поднят | Частично: интерфейс доступен, но письмо входа проверяемо только после T-021 — сервер пока печатает magic link в консоль. |
| repo / format | `pnpm format:fix`, exit 0 | Пройдено. |
| repo / lint | `pnpm lint`, exit 0 | Пройдено. |
| repo / test | `pnpm test`: server — 21 файл, 121 passed, 16 skipped; web — 17 файлов, 131 passed | Пройдено. |

Перед успешным прогоном `pnpm test` падал на web с `ERR_MODULE_NOT_FOUND: @vitejs/plugin-vue`.
Причина — рассинхронизованный локальный `node_modules`, а не изменения этого захода: `pnpm install`
по существующему lock-файлу восстановил дерево, после чего оба пакета прошли. Числа тестов взяты
из фактического вывода и выше зафиксированных ранее (server 69, web 75), потому что с тех пор в
`app` слиты T-016…T-019 и другие задачи.

## Что осталось

AC-3 в исходной формулировке требует увидеть письмо входа в локальном приёмнике. Это остаётся
недоступным до T-021 (почтовый транспорт), как и было записано в задаче. Инфраструктурная часть
критерия — работающий SMTP-приёмник и его интерфейс — выполнена.

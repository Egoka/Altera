Независимое review задачи T-007 (ALTE-64): Детерминированный сид базы данных.

PR #111: https://github.com/Egoka/Altera/pull/111
Ветка: server/t007-deterministic-seed
Актуальный HEAD SHA: a3eebdb27e726fd27c65b8a17d706668b32bde1e
Receipt: docs/reports/tasks/T-007.json

Критерии:
- AC-1: Два запуска prisma db seed на пустой базе не создают дубликаты
- AC-2: По одной служебной записи каждой роли и материал в каждом статусе

Завершить вывод строкой:
ALTERA_REVIEW_V1 {"sha": "a3eebdb27e726fd27c65b8a17d706668b32bde1e", "verdict": "approved"}

Независимое review задачи T-047 (ALTE-56): Очередь фоновых заданий в базе и исполнитель в процессе API.

PR #123: https://github.com/Egoka/Altera/pull/123
Ветка: server/t047-job-queue
Актуальный HEAD SHA: 9387f06586d97769f7bf4aedda7241d63a2257d2
Receipt: docs/reports/tasks/T-047.json

Критерии:
- AC-1: Задание с ошибкой переходит в failed после исчерпания попыток и пишет job.failed
- AC-2: Зависшее задание помечается stuck по таймауту (тест с подменой времени)

Завершить вывод строкой:
ALTERA_REVIEW_V1 {"sha": "9387f06586d97769f7bf4aedda7241d63a2257d2", "verdict": "approved"}

Независимое review задачи T-029 (ALTE-57): Аудит чтения персональных данных.

PR #127: https://github.com/Egoka/Altera/pull/127
Ветка: server/t029-pd-read-audit
Актуальный HEAD SHA: 94c7e3bbf5d2a968c5bd49348f9850eb995a9235
Receipt: docs/reports/tasks/T-029.json

Критерии:
- AC-1: Запрос карточки пользователя admin создаёт запись admin.read.personal
- AC-2: Запрос карточки материала moderator не содержит e-mail автора

Завершить вывод строкой:
ALTERA_REVIEW_V1 {"sha": "94c7e3bbf5d2a968c5bd49348f9850eb995a9235", "verdict": "approved"}

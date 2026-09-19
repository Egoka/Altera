Независимое review задачи T-028 (ALTE-69): Индивидуальные исключения владельца.

PR #121: https://github.com/Egoka/Altera/pull/121
Ветка: server/t028-permission-exceptions
Актуальный HEAD SHA: 48dbb175da8c5174dc9ab6afc95cfbe5396aefcb
Receipt: docs/reports/tasks/T-028.json

Критерии:
- AC-1: Выдача исключения не-владельцем возвращает FORBIDDEN
- AC-2: Истёкшее право не действует и создаёт permission.exception.expire

Завершить вывод строкой:
ALTERA_REVIEW_V1 {"sha": "48dbb175da8c5174dc9ab6afc95cfbe5396aefcb", "verdict": "approved"}

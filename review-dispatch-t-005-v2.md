Независимое review задачи T-005 (ALTE-67): Lint-правила и гигиена кода.

PR #116: https://github.com/Egoka/Altera/pull/116
Ветка: task/t005-lint-hygiene
Актуальный HEAD SHA: b7eade34f80e2c950e56b0fbbe8543a7c986a6d5
Receipt: docs/reports/tasks/T-005.json

Критерии:
- AC-1: pnpm lint проходит; console.log в server/src вызывает ошибку
- AC-2: Маршруты /fonts-showcase, /components-showcase, /test-error отвечают 404
- AC-3: pnpm --filter server build не запускает prisma migrate deploy

Завершить вывод строкой:
ALTERA_REVIEW_V1 {"sha": "b7eade34f80e2c950e56b0fbbe8543a7c986a6d5", "verdict": "approved"}

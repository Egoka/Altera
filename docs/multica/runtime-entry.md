# Инструкции запуска Multica

Только для явно запущенной Multica. Обычный чат владельца не запускает очередь,
ритуалы, hooks и продолжение чужих задач.

Текущий процесс — [контроллер автономии](autonomy-controller.md). Читать свой task,
короткий handoff и изменившиеся evidence. Технические правила —
[project-rules](../development/project-rules.md), проверки —
[testing](../development/testing.md). Полную историю и весь бэклог не перечитывать.

Начало новой задачи: успешный fetch свежего `origin/app`, отдельная ветка/worktree,
[preflight инфраструктуры](infrastructure-checks.md). Не менять чужой checkout.
Development Neon сохраняется. Один product writer.

Итог — канонический JSON задачи и короткий Markdown. CI и независимый verdict
привязаны к текущему SHA. Merge и Done — только через установленный controller.py.
Отказы сохранять с конкретным условием восстановления; не ждать формального Done владельца.
Исторические gate/adapters и ALTE-11 не активировать.

Прежний текст сохранён в `history/2026-09-15-before-controller/runtime-entry.md`
для аудита; он не является инструкцией текущего запуска.

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

Демон в режиме `in_place` перед каждым запуском вписывает brief в `CLAUDE.md` рабочего
дерева между маркерами `<!-- BEGIN MULTICA-RUNTIME -->` и `<!-- END MULTICA-RUNTIME -->`,
поэтому там `CLAUDE.md` всегда изменён. Блок не является инструкцией проекта и в коммит
не попадает: не добавлять его через `git add -A`/`git commit -a`, из индекса убирать
`git restore --staged CLAUDE.md`. Так блок дважды попал в app через PR #53
(`92bf3cb`, `34541c4`). Pre-commit hook и `test_chat_routing.py` отклоняют `CLAUDE.md` или
`AGENTS.md` с этим блоком.

Прежний текст сохранён в `history/2026-09-15-before-controller/runtime-entry.md`
для аудита; он не является инструкцией текущего запуска.

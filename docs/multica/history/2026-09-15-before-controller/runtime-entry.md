# Инструкции запуска Multica

> Актуальный контракт контроллера: [autonomy-controller.md](autonomy-controller.md). Ниже сохранены прежние подробности процесса для совместимости; правила merge/Done и дедупликации задаёт контроллер.

Этот документ подключает только профиль запуска Multica. Он не является инструкцией
для прямых чатов владельца, даже когда запрос касается кода или самой Multica.

При изменениях backend/shared build inputs обязательна [проверка Render и Neon](../multica/infrastructure-checks.md): CI, merge, deploy и health фиксируются отдельно.
Доступ native runtime и конфигурации MCP проверяются по [infrastructure-access](infrastructure-access.md).

Каждая новая задача начинается с успешного fetch `origin/app`: от полученного полного SHA
создаются новая ветка и отдельный worktree, проверяются HEAD и чистота. Полный порядок и
отличие нового старта от продолжения — [fresh-task-worktree](../multica/fresh-task-worktree.md).

Перед планированием или исполнением прочитай:

- [операционную модель](../multica/operating-model.md) — полномочия, стадии, один writer,
  остановка и выпуск;
- [контракты артефактов](../development/artifact-contracts.md) — задача, evidence, handoff и
  независимая приёмка;
- [правила проекта](../development/project-rules.md) — источники, технические соглашения;
- [проверки](../development/testing.md) — актуальные команды и ограничения;
- [бэклог](../backlog/README.md) и файл задачи — когда работа идёт из очереди.

Прямое письменное поручение владельца может быть самостоятельным источником полномочий для
точно названного scope: ему не требуется выдуманный статус `готова` в бэклоге. Завершение ответа,
run, стадии и приёмка задачи — разные события. Новые ограничения runtime появятся только после
M4; описанные здесь контракты сами по себе их не обеспечивают.

## Ритуал и runtime

Прочитай `docs/multica/task-ritual.md` и `docs/multica/testing-contract.md`. Все пути в этом документе и профилях считаются
от корня репозитория. Общие AGENTS.md и CLAUDE.md не активируют этот процесс.

Claude: runtime загружает `docs/multica/claude-plugin` через `--plugin-dir`;
его Stop hook сохраняет прежний gate, роли и команды. Не устанавливать plugin
в user/project scope: это вернёт его в прямые диалоги. Команды plugin имеют namespace
`altera-multica`, например `/altera-multica:multica-status`.
Codex: отдельный Claude plugin не нужен; используется прежний явный gate/collector.
Linux checker: прежняя внешняя приёмка и запрет hooks сохраняются.

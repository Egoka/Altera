# Altera — карта инструкций агентов

При изменениях backend/shared build inputs обязательна [проверка Render и Neon](docs/multica/infrastructure-checks.md): CI, merge, deploy и health фиксируются отдельно.

Каждая новая задача начинается с успешного fetch `origin/app`: от полученного полного SHA
создаются новая ветка и отдельный worktree, проверяются HEAD и чистота. Полный порядок и
отличие нового старта от продолжения — [fresh-task-worktree](docs/multica/fresh-task-worktree.md).

Перед планированием или исполнением прочитай:

- [операционную модель](docs/multica/operating-model.md) — полномочия, стадии, один writer,
  остановка и выпуск;
- [контракты артефактов](docs/development/artifact-contracts.md) — задача, evidence, handoff и
  независимая приёмка;
- [правила проекта](docs/development/project-rules.md) — источники, технические соглашения и
  ритуал;
- [проверки](docs/development/testing.md) — актуальные команды и ограничения;
- [бэклог](docs/backlog/README.md) и файл задачи — когда работа идёт из очереди.

Прямое письменное поручение владельца может быть самостоятельным источником полномочий для
точно названного scope: ему не требуется выдуманный статус `готова` в бэклоге. Завершение ответа,
run, стадии и приёмка задачи — разные события. Новые ограничения runtime появятся только после
M4; описанные здесь контракты сами по себе их не обеспечивают.

<!-- prettier-ignore-start -->
<!-- trace-mcp:start -->
## trace-mcp Tool Routing

IMPORTANT: For ANY code exploration task, ALWAYS use trace-mcp tools first. NEVER use Read/Grep/Glob/Bash(ls,find) for navigating source code.

| Task | trace-mcp tool | Instead of |
|------|---------------|------------|
| Find a function/class/method | `search` | Grep |
| Understand a file before editing | `get_outline` | Read (full file) |
| Read one symbol's source | `get_symbol` | Read (full file) |
| What breaks if I change X | `get_change_impact` | guessing |
| All usages of a symbol | `find_usages` | Grep |
| All implementations of an interface | `get_type_hierarchy` | ls/find on directories |
| All classes implementing X | `search` with `implements` filter | Grep |
| Project health / coverage gaps | `self_audit` | manual inspection |
| Dead code / dead exports | `get_dead_code` / `get_dead_exports` | Grep for unused |
| Context for a task | `get_feature_context` | reading 15 files |
| Tests for a symbol | `get_tests_for` | Glob + Grep |
| Untested symbols (deep) | `get_untested_symbols` (classifies "unreached" vs "imported_not_called") | manual audit |
| HTTP request flow | `get_request_flow` | reading route files |
| DB model relationships | `get_model_context` | reading model + migrations |
| Component tree | `get_component_tree` | reading component files |
| Circular dependencies | `get_circular_imports` | manual tracing |

Use Read/Grep/Glob ONLY for non-code files (.md, .json, .yaml, config) or before Edit.
Start sessions with `get_project_map` (summary_only=true).
<!-- trace-mcp:end -->
<!-- prettier-ignore-end -->

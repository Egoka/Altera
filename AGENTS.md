# Altera — общие технические инструкции

Выполняй текущий запрос пользователя в его scope. Приветствие и вопрос не запускают
работу с репозиторием. Прямой запрос на изменение кода выполняется как обычная
разработка: изучить нужный код, изменить, проверить, сообщить результат.

Очереди, роли, стадии, паспорта, обязательные планы/отчёты и gate внешней автоматизации
не являются процессом прямого диалога. Не загружай их инструкции, не вызывай их команды
и не продолжай чужие задачи из-за состояния checkout или старых артефактов.
Процесс автоматизированного запуска задаётся только инструкциями этого запуска.

При работе с кодом используй [технические соглашения](docs/development/project-rules.md)
и подходящие [проверки](docs/development/testing.md). Читай требования и документацию
по задаче; не обходи весь бэклог. Сохраняй чужие изменения и не раскрывай секреты.

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

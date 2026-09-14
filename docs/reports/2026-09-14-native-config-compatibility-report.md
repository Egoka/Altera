# Совместимость конфигурации Multica — отчёт

Дата: 2026-09-14. План: [native-config-compatibility](../plans/2026-09-14-native-config-compatibility.md).
Baseline: `1ab094023da349de051f560420689a9e8d5b0118`. Исполнитель: Codex, текущая сессия владельца.

## Реализовано

Политика `codex-mcp-map-selected-v2` принимает многострочные массивы перед managed-блоком,
переносит только явно выбранные инструменты и фиксирует число исключённых серверов без их
значений. Старый режим не изменён. Выбранные инструменты проходят прежние validators.

Collector распознаёт точный `provider_input_refused` до вызова launcher: сверяет native terminal,
identity, ticket SHA, adapter claim/observation и отсутствие runtime receipt. Сохраняет
`process_outcome=not_started`, `native_outcome=failed`, `task_acceptance=not_checked`, затем
освобождает только совпадающий slot. История и счётчики сохраняются.

## Проверки

Cwd всех команд: `/Users/egorbondarenko/WebstormProjects/Altera`.
AC-1/2, `check_id=codex-config-compatibility`: `PYTHONPATH=scripts/agent-runtime python3 -m unittest test_codex_toml_map`
— 21 тест, exit 0. До исправления два новых сценария дали ожидаемый RED.

AC-2, `check_id=native-adapter-regression`: `PYTHONPATH=scripts/agent-runtime python3 -m unittest test_native_adapter test_playwright_mcp`
— 21 тест, exit 0.

AC-2, `check_id=collector-regression`: `PYTHONPATH=scripts/agent-loop:scripts/agent-runtime python3 -m unittest test_native_collector`
— 15 тестов, exit 0. Проверены подмена identity/ticket, неоднозначный запуск, active/successful native
run, сохранение истории и повторный admission. Исходный новый recovery-тест воспроизвёл отказ.

Фактический generated config запуска `01a09ffd-a1e0-7ef6-a66b-7c4d499692da` прошёл полный D2 probe
и `native_codex_adapter.verify` без запуска модели: `managed_mapping_verified=true`;
policy SHA `1fe9a7db997068f75adca5668c185a8f7501f6673b53bc03deb99730e6886a26`.
Три сервера исключены, context7/trace перенесены. Секреты в evidence не копировались.

Deployment v4 установлен. Предыдущий failed run reconciled по owner CLI readback, его слот
освобождён штатным gate. Полный native canary и включение очереди пока не проверены;
локальные тесты не означают приёмку автономии. Trace: tool calls текущей сессии; полный
экспорт недоступен. Проверки выполнены на рабочем diff четырёх Python-файлов от baseline;
пользовательский `pnpm-lock.yaml` вне scope.

# Восстановление native-запуска до старта процесса

Дата: 2026-09-14. Основание: прямое поручение владельца закрыть последний блокер ALTE-11.
Baseline: `a869fc15358bb75530bc9be50f19b9344f322bd9`.
Ветка: `docs/agent-loop-autonomy`; основное дерево. Пользовательский `pnpm-lock.yaml` изменён и исключён из работы.

## Проблема и границы

`bind` сохраняет ticket/binding до проверки gate. При отказе проверки нет `01-bound.json`,
adapter claim и process receipt. `reconcile` безусловно требует process receipt и не может
закрыть такую попытку даже после подтверждённого native failure. Исправление ограничено
collector, его регрессионными тестами и согласованной установкой native adapters.

## Решение

1. Воспроизвести отказ gate после admission на настоящем Git/gate fixture.
2. Под блокировкой пары сверить точный terminal run через существующий доверенный readback.
3. Для отсутствующего process receipt разрешить только native `failed` с completed_at,
   отсутствующим маркером завершённого bind и всеми следами запуска adapter/runtime.
   Сохранить terminal receipt: process not_started, native failed, acceptance not_checked.
4. Сохранить прежние ticket/binding и счётчики. Свежий admission проходит обычные ограничения.
5. Проверить положительный сценарий и отказы при активном run, неверной identity, native success
   либо следах запуска; выполнить весь collector suite.
6. Восстановить фактическую зависшую попытку по свежему readback Multica, подготовить согласованное
   deployment и выполнить ограниченный live-запуск. Результат и ограничения записать в парный отчёт.

## Критерии

- AC-1: prelaunch failure закрывается без выдуманного process receipt и без удаления истории.
- AC-2: активный/успешный/чужой run и неоднозначный старт не разрешают такое восстановление.
- AC-3: новый admission после восстановления проходит штатный gate; существующие collector tests проходят.
- AC-4: фактический зависший run имеет проверенный terminal receipt; live outcome фиксируется отдельно от приёмки.

Источники: `docs/development/artifact-contracts.md`, `docs/multica/operating-model.md`,
`docs/plans/2026-09-14-native-runtime-pilot.md`. Новых продуктовых решений нет.

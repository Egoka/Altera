# Восстановление native-запуска до старта процесса

- **Дата**: 2026-09-14
- **План**: [native-prelaunch-recovery](../plans/2026-09-14-native-prelaunch-recovery.md)
- **Ветка**: `docs/agent-loop-autonomy`
- **Baseline**: `a869fc15358bb75530bc9be50f19b9344f322bd9`
- **Статус**: блокер незавершённого bind закрыт; live-проверка выявила несовместимость mapper с конфигурацией Multica

## Результат

Collector теперь закрывает подтверждённый failed native run без process receipt только
когда bind не завершён и нет следов старта adapter/runtime. Проверка работает под блокировкой
пары workspace/agent. История не удаляется; receipt явно содержит `process_outcome: not_started`,
`native_outcome: failed`, `task_acceptance: not_checked`.

Реальная попытка `592c3ec9c53d45b1b427fbf87f8faa27` связана с native run
`01a09fe5-ca39-7608-a030-082fa93798ce`. Read-only запрос Multica подтвердил `failed`,
окончание `2026-09-14T12:30:33Z`, точные issue/agent/workspace. Получен
[terminal receipt](evidence/2026-09-14-native-prelaunch-recovery/terminal.json).

Причина зависания: прежний gate-slot был освобождён мной до повторного запуска; проверка
gate остановила bind после сохранения binding. Прежний reconcile требовал отсутствующую
process receipt. Это локальный дефект восстановления; внешняя ошибка Multica как причина
этого зависания не доказана. Старый collector ticket имел собственную корректную схему;
прежнее предположение о его неправильном формате ошибочно.

## Проверки

Actor: Codex owner session, текущая задача. Cwd: `/Users/egorbondarenko/WebstormProjects/Altera`.
Revision: baseline выше плюс diff collector и его тестов. Source SHA-256 collector:
`18fe3ae17bacfdd06f3da4135b146b6efb0706517e050db8563c44fc22efc174`.
Пользовательский `pnpm-lock.yaml` не изменялся этой работой.

- AC-1/2, `collector-prelaunch-recovery`: до исправления 3 сценария обнаружили отсутствие
  восстановления; после исправления 3 passed, exit 0. Проверены active run, native success,
  неверный agent и четыре вида следов запуска.
- AC-3, `collector-regression`: команда
  `PYTHONPATH=scripts/agent-loop:scripts/agent-runtime python3 -m unittest test_native_collector`:
  14 tests passed, exit 0, 38.647 s. [Вывод](evidence/2026-09-14-native-prelaunch-recovery/collector-tests.txt).
  Тесты используют настоящий Git/gate и подменяют внешний native boundary; live provider ими не принят.
- AC-4, `native-prelaunch-reconcile`: explicit controller runner выполнил свежий read-only
  `multica issue runs` с явными server/workspace, сверил точный run и отсутствие активных
  запусков ALTE-11. Receipt сохранён в приватном registry и скопирован в evidence.

Новая установка v3 прошла проверку module/config pins для обоих providers. Выявлен и исправлен
устаревший config SHA в Claude launcher; сначала установщик отказал до переключения профилей.
[Хэши установки](evidence/2026-09-14-native-prelaunch-recovery/deployment.json).
v2 сохранена. Autopilot остаются на паузе. Полная автономия и приёмка native runtime этим отчётом
пока не объявляются.

## Контрольный live-запуск и оставшаяся проблема

Исправление зафиксировано `abb0c4e8367b2a86037aaa003057d63faace90dc`. Pre-commit:
format и lint passed; server 19 passed (1 todo), web 56 passed. Новый admission
`7a71652c7ded4fcb91d038f3399c57b6` успешно создан на этой ревизии со scoped fingerprint `clean`.
Предварительный admission отказал из-за прав request-файла; после установки `0600` прошёл.

Контрольный native run `01a09ffd-a1e0-7ef6-a66b-7c4d499692da` прошёл collector bind и adapter claim,
затем остановился с `provider_input_refused`. Daemon подтвердил cleanup/reaped, tools=0;
runtime child не был запущен. [Native результат](evidence/2026-09-14-native-prelaunch-recovery/live-result.json),
[наблюдение adapter](evidence/2026-09-14-native-prelaunch-recovery/adapter-observation.json).
Поле `worker_quiescence: unknown` сохранено как есть: новая попытка не получает выдуманную process receipt.
Её claim и gate-slot оставлены для явного восстановления после исправления provider.

Локальный replay только provider-verifier на конфигурации этого завершённого run воспроизвёл
`managed_block_ambiguous`. Реальная конфигурация содержит многострочный массив `notify`,
а `_lexical_markers` требует закрыть все скобки на каждой строке. Дополнительная read-only
проверка только managed-блока даёт `managed_block_invalid`: в нём пять серверов
(`computer-use`, `context7`, `node_repl`, `playwright`, `trace`), а `_parse_managed` допускает
не более трёх. Это две подтверждённые несовместимости входного формата, отдельные от восстановленного bind.
Назначения MCP тестировщика через CLI: context7 и playwright; прочие записи присутствуют в
сгенерированной конфигурации, поэтому одного изменения назначений агента недостаточно.

Следующая работа — согласовать mapper с действительной конфигурацией Multica, сохранив
явный список допускаемых инструментов и проверку путей, затем закрыть provider-refusal по
доверенным доказательствам и повторить bounded native acceptance. Эта работа не выполнена
в рамках исправления незавершённого bind. Старый блокер закрыт, полная автономия не принята.

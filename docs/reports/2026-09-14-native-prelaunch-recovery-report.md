# Восстановление native-запуска до старта процесса

- **Дата**: 2026-09-14
- **План**: [native-prelaunch-recovery](../plans/2026-09-14-native-prelaunch-recovery.md)
- **Ветка**: `docs/agent-loop-autonomy`
- **Baseline**: `a869fc15358bb75530bc9be50f19b9344f322bd9`
- **Статус**: исправление и восстановление выполнены; live-проверка новой попытки ожидается

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
  14 tests passed, exit 0, 38.647 s. [Вывод](evidence/2026-09-14-native-prelaunch-recovery/collector-tests.log).
  Тесты используют настоящий Git/gate и подменяют внешний native boundary; live provider ими не принят.
- AC-4, `native-prelaunch-reconcile`: explicit controller runner выполнил свежий read-only
  `multica issue runs` с явными server/workspace, сверил точный run и отсутствие активных
  запусков ALTE-11. Receipt сохранён в приватном registry и скопирован в evidence.

Новая установка v3 прошла проверку module/config pins для обоих providers. Выявлен и исправлен
устаревший config SHA в Claude launcher; сначала установщик отказал до переключения профилей.
[Хэши установки](evidence/2026-09-14-native-prelaunch-recovery/deployment.json).
v2 сохранена. Autopilot остаются на паузе. Полная автономия и приёмка native runtime этим отчётом
пока не объявляются.

## Следующий шаг

Свежий admission на зафиксированной ревизии и ограниченный запуск ALTE-11. История неудачных
попыток и gate counters сохраняются. Исправление восстановило зависшую запись; успешность
нового provider run будет зафиксирована отдельно.

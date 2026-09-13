# Повторное ревью Multica proposal после fix round 1

- Вердикт: **принято для C1 guarded apply после подстановки полного `SOURCE_SHA`**.
- Блокирующих замечаний: 0.
- Граница: проверены только исправленные after-тексты, формулировки `Q-NN`, новый чек-лист и неизменность C0 before-values. Multica не изменялась; run и автопилоты не запускались.

## Проверка прежних блокеров

### B1 — исправлен

`docs/multica/proposed/autopilot-c40fbc10-3bb3-4181-b244-14b87e8ae3f1-description.txt:1` теперь разделяет два независимых условия: `готова` задаёт владелец в исходном `T-NNN`, а `Todo` — дополнительное native-состояние Multica, которое само готовность не задаёт. Строка 13 повторяет полный gate: `готова` + `Todo` + закрытые зависимости + отсутствие открытого `Q-NN` в scope задачи + AC-ID + свободный слот. Внутреннего противоречия и расхождения с `docs/multica/operating-model.md` §4/§6 больше нет.

Оркестратор на `docs/multica/proposed/agent-d08ef989-e4d4-4772-bc33-335127a85f0f-instructions.txt:27` использует тот же gate и отдельно сохраняет уже данное прямое поручение владельца как основание исполнить конкретный план, не меняющее готовность других задач. Вопросы, явно исключённые владельцем из scope, не закрываются и не редактируются.

### B2 — исправлен

`docs/multica/proposed/skill-a65ce5c7-674b-44fe-b418-81c7f55b4116-SKILL.md.txt:57-72` теперь задаёт проверочный pipeline `pnpm format && pnpm lint && pnpm test`. `pnpm format:fix` вынесен отдельно как изменяющая команда, доступная только исполнителю разрешённой правки в её scope; проверяющие используют `pnpm format`. Это совпадает с `docs/development/project-rules.md:89-91` и сохраняет границы тестировщика/reviewer.

### B3 — исправлен

`docs/multica/proposed/skill-a65ce5c7-674b-44fe-b418-81c7f55b4116-SKILL.md.txt:36-37` теперь использует `git rev-parse HEAD`. Полный baseline SHA согласован с `docs/development/artifact-contracts.md:14,37-38` и `docs/development/project-rules.md:104-107`.

## Регрессии и дополнительные проверки

- Формулировка восстановления на `docs/multica/proposed/autopilot-e564a6fb-d7cd-4ab6-b719-b0570b730ccf-description.txt:11` блокирует только открытый `Q-NN` в scope стадии, отложенное продуктовое решение или неустранённый конфликт. Она не снимает вопрос владельца, не превращает диагностику в третью попытку и не сбрасывает счёт новым run. Это согласовано с scoped wording очереди и оркестратора.
- Shared skill на строке 29 сохраняет прямое поручение владельца как отдельное разрешение конкретного плана, без фиктивной готовности остальных задач. Паспорт на строке 99 по-прежнему требует поручение/задачу, AC-ID, scope, разрешённые действия и baseline.
- `docs/multica/proposed/changes.json` по-прежнему содержит 19 уникальных `kind/id/field`; 19 after-файлов присутствуют. Все 19 `before_sha256` повторно совпали с manifest before-text и C0 snapshot/raw backup: несовпадений 0. Исправления не затронули восстанавливаемые старые значения.
- `docs/reports/2026-09-13-autonomy-execution-report.md:19` теперь правильно сообщает о 19 подготовленных изменениях.
- `docs/development/sources/2026-09-13-autopilot-checklists-original.md` байт-в-байт совпадает с версией `docs/multica/autopilot-checklists.md` в текущем HEAD до замены. Исторические, основанные только на prompt, отметки не утрачены и больше не выдаются за runtime evidence.
- Новый `docs/multica/autopilot-checklists.md` правдиво оставляет непройденными apply/readback, соответствие source SHA, загрузку contract/trace реальным run, фактические границы записи/секретов, резервирование writer-slot, негативные сценарии, scoped `Q-NN`, двухнеуспешный stop и отдельное разрешение на включение. Отмеченные пункты ограничены наблюдаемым C0 snapshot, сохранением before-values, текущим paused-состоянием, выбранным C1 scope и локальной приёмкой T-110 с явно указанным ограничением.
- Чек-лист не утверждает, что prompt, `private`, пустой Environment или чтение active run технически обеспечивают filesystem isolation, секретность или mutex. Он сохраняет порядок отдельного включения и не закрывает три автопилота одним ручным update.

`SOURCE_SHA` остаётся допустимым только как текущий pre-write placeholder. Перед apply его нужно заменить одним полным SHA установленного source commit во всём proposal и в manifest, проверить отсутствие остаточного `SOURCE_SHA`, затем выполнить compare-before/write/readback. Этот вердикт принимает исправленный proposal, но не подтверждает ещё не выполненные C1 write/readback, pilot, runtime isolation или включение автопилотов.

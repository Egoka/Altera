# Task 9 finalfix — независимый scoped re-review

**Spec: PASS в scope N1/N2. Quality: PASS в scope N1/N2.** Новых actionable defects в
рассмотренном исправлении не найдено. Это не native/runtime/whole-loop acceptance.

## Идентичность и evidence

- Collector: `cfd53f4739781f2618a52246705646524fccf050e2016b26b43fe0486989e95b`.
- Tests: `a5cfd058ec420ff69c33ebdd7dc42667b18b8ea1e12432b77a0857107693bf12`.
- Runtime остался `3f104d127949a68f57040be35916be4a14dd999b71918a7c33d81611dc69183c`;
  остальные семь pins в `task-9-frozen-modules.json` совпадают с предыдущим review.
- Raw `task-9-finalfix-green.log`, SHA256
  `fb92ad1d5e8ce0ee62d90097d637bc5e08df3b1dd1baaae919d5a0cb44226daa`: 9 tests,
  23.563 seconds, OK. Сохранённые `task-9-finish-red.log` и `task-9-cli-collect-red.log`
  прочитаны; старые неуспехи не удалены.

Hashes независимо сверены с файлами. Изучены только изменённые current/transition/main и
добавленные regressions, с опорой на уже прочитанный предыдущий frozen source. Trace был
первым; его дедупликация вернула старые metadata, поэтому точные изменённые spans прочитаны
непосредственно. Tests, Docker, native, model, API и credential/config операции не запускались;
source/index/HEAD не менялись.

## N1 — ADDRESSED

`current` сохраняет exact slot ownership, passport и lease. Флаг делегирования проверки
artifact ancestry включается только для заранее разрешённых bind-artifacts/finish
(`native_collector.py:393`). Admission, collect и check продолжают сравнивать исходный snapshot.
Поздние переходы вызывают existing gate, который проверяет own-artifact relation, evidence и
source equivalence; новой state machine или безусловного разрешения изменённого source нет.

Regression выполняет настоящий gate record, report/archive, собственный evidence commit,
bind и finish. Дополнительно доказывает, что обычный current после этого commit по-прежнему
отказывает. Проверка завершает стадию `plan` тестового паспорта; она не заявляет завершение
всех его стадий или фактического Agent Loop pilot. Причина прежнего launch-to-finish blocker
закрыта кодом и этой meaningful regression.

## N2 — ADDRESSED

Standalone collect исключён из CLI choices, оба произвольных observation-path аргумента
удалены (`native_collector.py:442`–`:444`). Trusted in-process collect callback сохранён.
Новая regression получает argparse exit 2 до чтения отсутствующего deployment и подтверждает
отсутствие gate events. Она доказывает закрытие файлового CLI entrypoint, а не исторически
выполненную подделку process receipt.

## Границы

Оценка R1–R8 и остальных Task9 codepaths из `task-9-combined-review.md` не открывалась заново.
Его N1/N2 superseded этим фактическим scoped pass; история отрицательного review сохраняется.
Документация установки теперь требует own-artifact bind перед finish и верно описывает
collect как callback. Root-owned no-model/native canaries, live task-token authority,
Claude/Codex context/MCP и независимая содержательная приёмка pilot этим документом не заменяются.

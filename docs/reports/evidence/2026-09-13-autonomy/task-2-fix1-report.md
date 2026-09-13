# Task 2 — исправления независимого review, раунд 1

**Статус: DONE** для двух адресных Important findings. Независимый повторный вердикт ожидается;
полная автономность/runtime M4 не объявляется принятой. Ограничение возврата завершённых стадий
остаётся открытым и намеренно не расширялось этим fix.

## Вход и сохранение истории

Прочитаны исходные `task-2-review.md` и `task-2-review-probes.txt`; SHA-256 обоих файлов
зафиксирован до commit и повторно сверён после — байты не изменились. Первый `task-2-report.md`
и прежние outputs сохранены. Этот отдельный отчёт дополняет их; старый verdict не переписан.

Actor `/root/loop_gate`, run `local-task2-fix1-loop-gate-20260913`, стадия `review-fix-1`.
Cwd `/private/tmp/altera-agent-loop-autonomy`, ветка `docs/agent-loop-autonomy`.

- Immutable review baseline: `ea7f142b729bd88b2b79e247130cd40d2e329992`; tree `98a6be3e1f3b5bdec5f575ef6f1c323fb1ef4f08`.
- Root отдельно закоммитил разрешённые C0/C1 docs: implementation base `f5f95f49a0027e2258e409674e3f9f4d77b7584b`;
  tree `41a5a70e44d7b763a8652982db6705255558c9d5`. Эти файлы не входили в fix.
- Проверенный до commit HEAD: `f5f95f49a0027e2258e409674e3f9f4d77b7584b`;
  own scope dirty fingerprint `sha256:4df7dfc6c15191115d0b5cd4e341486e09dafa0b036bf2df6ee9b5c407ca0eef`.
- Итоговый commit/HEAD: `e77c65e0bea357f103b1edbfd30350ac2776b99c`; tree `ff3743eb0c643535ca5ac975e38623c5091915b1`.
- После commit own dirty fingerprint **clean**. SHA-256 трёх committed файлов совпали
  с manifest проверенного дерева до commit: `task-2-fix1-final-revision.json`.
- Команда snapshot: `python3 scripts/agent-loop/gate.py snapshot --scope scripts/agent-loop docs/development/agent-loop-gate.md`.
- Полный review-scoped diff от immutable ea7: `task-2-fix1-review-diff.patch`; до commit:
  `task-2-fix1-before-commit.patch`, `task-2-fix1-before-commit-manifest.json`.

Финальный commit содержит ровно три файла: `scripts/agent-loop/gate.py`, `scripts/agent-loop/test_gate.py`,
`docs/development/agent-loop-gate.md`. Остальные исходные девять Task 2 paths не изменены.
C0/C1 raw sources, snapshots, evidence, migration ledger/checklists/plans/reports не staged/modified/форматировались.
Корневой C0/C1 commit сохранён как предок. На момент capture git status не показывал иных dirty-файлов;
это датированный факт, а не обещание неизменности параллельной работы контроллера.

## Исправление Important 1 — product parent

Добавлен сохраняемый `parent`, независимый от run/stage slot. `start` принимает только тот же
parent/passport/checkout, пока цепочка не закончена. `finish` промежуточной стадии освобождает
только slot; `release` не завершает стадию и сохраняет parent/failures. Новый run той же незавершённой
стадии явно запускается через start с новым run ID; failures не теряются. `docs-only` не обходит
ожидающий parent. Только finish всех объявленных стадий освобождает parent для другой задачи;
результат finish явно содержит `parent_retained`.

State version 2 делает новое представление явным. Version 1 отклоняется без перезаписи, обнуления
failures или автоматической миграции. Предыдущий state не удаляется; migration/reset API не добавлен.
Все поля остаются в том же git-common-dir и под тем же атомарным lock/write механизмом.

Два новых настоящих CLI fixtures:

- `test_parent_reservation_survives_finish_until_all_stages_complete`: продуктовый dirty diff,
  test/pass/finish, попытка другой задачи отклонена без изменения state; review/pass/finish с
  обновлённой парой отчётов; только затем другая задача получает parent.
- `test_parent_reservation_survives_release_and_resume_preserves_failures`: failed check, release,
  другая задача/docs-only отклонены, явный resume сохраняет failure=1, второй failed доводит до 2,
  дальнейший run остановлен.

## Исправление Important 2 — актуальность prerequisites

Одна функция validate_prerequisites проверяет сохранённые ревизии и immutable hashes
всех обязательных предыдущих стадий. Она вызывается на start, record, finish и Stop; на
операциях продвижения — до и после основной проверки против того же snapshot. Stop использует
validate_finish и в активном slot, и после завершённой цепочки. Изменение scoped кода после
review start теперь отвергает record; подмена предыдущего output отвергает record, finish и Stop.

Проверяются прежние evidence/output/trace, а не прежний current report path. Поэтому следующая
стадия может законно обновить человеческий и JSON отчёты, сохраняя старые proof-файлы/историю.
Fixture helper теперь фактически меняет human report text `test` → `review`, JSON меняет stage/run/events.

Четыре новых CLI fixtures:

- `test_prerequisites_rechecked_at_record_after_review_start` — новый dirty код после start(review),
  свежий review proof, отказ record без изменения state.
- `test_prerequisite_output_rechecked_at_record` — подмена output предыдущей стадии после start.
- `test_prerequisites_rechecked_at_finish_and_active_stop` — review record легален, затем prior output
  изменён; оба finish и активный Stop отвергают продвижение.
- `test_prerequisites_rechecked_at_completed_stop` — полный test→record→finish→review→record→
  обновление human/JSON report→finish→Stop проходит; после подмены prior output Stop отклоняется.

Таким образом happy path целиком проверен, не только успешный start(review).

## TDD, команды и фактический вывод

| Проверка | Command suffix после `python3 -m unittest discover -s scripts/agent-loop -p 'test_*.py'` | Output | Итог |
|---|---|---|---|
| RED parent | `-k parent -v` | `task-2-fix1-parent-red.txt` | 2 tests, 2 ожидаемых failures: чужой start возвращал acquired |
| RED prerequisites | `-k prereq -v` | `task-2-fix1-prereq-red.txt` | 4 tests, 4 ожидаемых failures: record/finish/Stop возвращали успех |
| GREEN parent | `-k parent -v` | `task-2-fix1-parent-green.txt` | 2/2 passed, exit 0 |
| GREEN prerequisites | `-k prereq -v` | `task-2-fix1-prereq-green.txt` | 4/4 passed, exit 0 |
| Полная regression suite | `-v` | `task-2-fix1-full-green.txt` | **28/28 passed, exit 0**, 37.129 s |

Во всех командах установлен `PYTHONDONTWRITEBYTECODE=1`. RED добавлены и реально воспроизведены
до изменения production code. Они подтверждают заранее известные review findings, не считаются
неуспешными попытками исправления. Все GREEN этой fix-итерации прошли с первой попытки;
новых actual failures check_id `task2-fixtures` нет. Независимый `task2-independent-review`
контроллера этим отчётом не переобозначается как passed.

Сводный trace AC/check_id/stage/run/result: `task-2-fix1-trace.jsonl`. Completion timestamps взяты
из output mtime; полноценный native trace экспорт не выдумывается. При первых RED root параллельно
менял только disjoint C docs, поэтому источник gate привязан к ea7, не заявляется неизвестный HEAD
каждой промежуточной миллисекунды. Полная GREEN имеет точный HEAD+dirty snapshot+file hashes,
которые совпали с committed bytes; повторный запуск неизменённых 28 fixtures после commit не требуется
для проверки этого совпадения и здесь не заявляется выполненным.

`pnpm exec prettier --check docs/development/agent-loop-gate.md`: passed. `git diff --check`: passed.
`python3 scripts/agent-loop/gate.py --help`: exit 0, `task-2-fix1-help.txt`.

Commit `e77c65e0bea357f103b1edbfd30350ac2776b99c` — `fix(agents): preserve parent ownership and prerequisite evidence`.
Полный pre-commit output `task-2-fix1-precommit.txt`: format passed, lint passed, server19+web5
= **24 product tests passed**, commit exit 0. Не использовались --no-verify/HUSKY=0.
Shared Git metadata escalation разрешена; staging выполнен после явного освобождения index контроллером.

## Оставшиеся ограничения и следующий шаг

- Возврат completed stage reviewer→developer→tester и освобождение остановленного/отменённого parent
  до всех finish отдельным API пока не поддержаны. Удаление state, новая task identity или очистка
  failures не являются разрешённым обходом. Контролируемый history-preserving переход нужен позже.
- Version 1 требует отдельного безопасного решения о переходе; автоматически сбросить его нельзя.
- Gate по-прежнему кооперативный, не OS security boundary; Multica bypass/danger-full-access,
  native runner loading, независимость личности и семантика AC требуют отдельных проверок.
- Source exploration снова начала с trace outline; gate отсутствует в индексе исходного checkout,
  поэтому перед адресным редактированием прочитаны нужные spans worktree. register_edit сообщил
  прежнее ограничение индекса, не использовался как evidence выполнения кода.

Следующий шаг: независимое адресное review двух исходных findings на итоговом commit и scoped diff.
Новые lifecycle API и Task 1 review этим fix не затрагивались.

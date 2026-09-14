# Task 2 — реализация gate контрактов и состояния

Статус реализации: **DONE_WITH_CONCERNS**. Независимая приёмка: **не проверено**, выполняется контроллером отдельно.
Полная M4/runtime-граница не заявлена принятой.

## Контекст и точная ревизия

- Задача: Task 2 из `docs/plans/2026-09-13-autonomy-execution.md`; исходный brief — `task-2-brief.md`.
- Каноническая пара plan/report исполнения принадлежит контроллеру; этот файл — подробный SDD-отчёт реализации для включения в основной отчёт, не подмена пары репозитория.
- Actor: `/root/loop_gate`; run: `local-task2-loop-gate-20260913`; стадия: `implementation-verification`.
- Cwd: `/private/tmp/altera-agent-loop-autonomy`; ветка: `docs/agent-loop-autonomy`.
- Baseline commit: `f3fc646cb6858b3dce78cb561db7704e6ed5d1d6`.
- Baseline Git tree: `bba26873f2728bb4e30d085171e2711c4ea6ceb0`. Это tree коммита; worktree уже имел посторонние dirty-файлы контроллера.
- Итоговый HEAD: `ea7f142b729bd88b2b79e247130cd40d2e329992`.
- Итоговый Git tree: `98a6be3e1f3b5bdec5f575ef6f1c323fb1ef4f08`.
- Собственные файлы: dirty fingerprint **clean** после коммитов; content manifest digest `sha256:1e9fe0c88e05fceec087dd1284363fa52e8b4515a88d2ec30ece6a0037e826e5`.
- Полный manifest с SHA-256 всех девяти файлов и сохранённым посторонним dirty scope: `task-2-final-revision.json`.
- Полный собственный diff baseline→итоговый HEAD: `task-2-own-change.patch`.
- `task-2-own-files-before-commit.json` и `task-2-own-diff-before-commit.patch` — промежуточный срез до последнего уточнения handoff; не выдаётся за окончательный fingerprint.
- Фактически использованная среда: Python **3.9.6**, Git **2.50.1 (Apple Git-155)**, Node **v24.3.0**, pnpm **10.18.3**. Наличие другой установленной версии Node не означает её использование в этих командах.

## Что реализовано

Один CLI на Python stdlib: snapshot, start, record, finish, release, docs-only, stop, status.
Проверяются паспорт и исходный человеческий план, парные человеческий/JSON отчёты, task/stage/actor/run/check/criterion,
полный baseline/HEAD и scoped staged/working/untracked fingerprint. Все продуктовые изменения baseline..HEAD и dirty
обязаны входить в scope. Чужие или symlink-пути, устаревшие revision/output/trace, изменённые паспорт/план,
непокрытые checks критерии, неизвестная или преждевременная стадия получают отказ.

State размещается в git-common-dir и разделяется между worktree. Атомарные mkdir-lock и temporary+fsync+rename
сохраняют единственный кооперативный slot, ownership/lease, историю событий, run IDs и счёт task/stage/check.
Повтор event или run не меняет state. Два последовательных failed/blocked запрещают дальнейшую попытку check/start;
release не стирает счёт. Обычный passed сбрасывает только свой счёт. Ожидаемый RED не увеличивает и не обнуляет его,
не даёт завершить стадию как проверенную реализацию. Необработанный lock после аварии не разблокируется автоматически.

Claude hook больше не обходит проверку по stop_hook_active и не считает один незакоммиченный diff всей задачей.
Без active passport Stop требует явную docs-only attestation с baseline. Stop не принимает задачу и не освобождает slot.
В settings удалены широкие pre-allow на мутации/arbitrary code; существующие secret-deny сохранены. Профили
тестировщика/ревьюера явно говорят, что Bash/Write и Multica bypass не обеспечивают read-only runtime.

Документация `docs/development/agent-loop-gate.md` содержит --help, поддержанный JSON flow, условия отказа,
порядок завершения/освобождения slot и ограничения. `testing.md` добавляет отдельную команду fixtures.

## AC → проверки и результат

Локальные AC ниже декомпозируют именно Task 2, не создают продуктовых критериев.

| AC | Требование Task 2 | Проверка / evidence | Итог |
|---|---|---|---|
| AC-1 | План/парный отчёт, исходная и итоговая ревизия, committed+dirty scope, именованные критерии | `task2-fixtures`: supported_flow, scope_cannot_omit, missing_foreign_or_modified_plan_report, paired_human_report, uncovered_criterion | подтверждено fixtures |
| AC-2 | Устойчивые task/stage/check failures, один slot/lease, actor/run/idempotency, атомарность | `task2-fixtures`: two_failures_across_runs, duplicate_event, global_slot, concurrent_acquisition, linked_worktrees, corrupt_state, success counter independence, expected RED | подтверждено fixtures |
| AC-3 | No-op, повтор Stop/run, stale evidence, подмена пути, неверная стадия | `task2-fixtures`: docs_only, repeated_stop, stale_evidence, paths/symlink/foreign_directory, wrong_stage_actor/check, handoff revision/output revalidation | подтверждено fixtures |
| AC-4 | Согласованный hook/settings/roles, документированный CLI и честная граница | `task2-precommit`, `task-2-help.txt`, bash -n, адресный Prettier, diff self-review, docs/roles | подтверждено для локального CLI; runtime canary отдельно |

Финальный exact-HEAD запуск: **22/22 tests, exit 0**, `task-2-final-head-fixtures.txt`.
Команда: `PYTHONDONTWRITEBYTECODE=1 python3 -m unittest discover -s scripts/agent-loop -p 'test_*.py' -v`.
Каждый fixture вызывает реальный CLI в новых процессах с реальным временным Git-репозиторием. Конкуренция
проверяется двумя Popen-процессами, linked worktree — реальным git worktree. Mocks нет.

Сводный очищенный trace check_id/AC/stage/run/result: `task-2-trace.jsonl`. Это реконструкция существенных
вызовов и результатов из tool history плюс полные локальные outputs, не полный native trace экспорт.
Времена в trace — фактический mtime завершённого output, не выдуманное время начала. Полные промежуточные
RED dirty-деревья не сохранялись; их outputs сохранены, финальное дерево и его source digest зафиксированы точно.

## TDD и счёт неуспехов

| Шаг | Вывод | Классификация |
|---|---|---|
| Первые fixtures против отсутствующей команды | первичный missing-file запуск показал также ошибки harness; затем введён только JSON rejection stub | не считался достоверным RED до исправления scaffold |
| RED против rejection stub и старого hook | `task-2-red.txt`: 14 tests, 13 failures; отсутствующие supported-flow/Stop гарантии воспроизведены | ожидаемый RED, не неуспех fix |
| Первая реализация | `task-2-green-1.txt`: 14 tests, 6 failures, все из-за canonical cwd mismatch | первый реальный неуспех `task2-fixtures` |
| Проверка гипотезы и один фикс fixture | `/var/...` от tempfile отличается от `/private/var/...` после resolve; вход cwd исправлен у источника | production guard не ослаблялся |
| GREEN после этого фикса | `task-2-green-2.txt`: 14/14, exit 0 | счёт реальных неуспехов сброшен |
| Дополнительные self-review RED перед исправлениями | `task-2-self-review-red.txt`: 4 ожидаемых отклонения; `task-2-schema-red.txt`: uncovered AC; `task-2-handoff-red.txt`: подмена prior-stage output | ожидаемые воспроизведения заранее названных пробелов |
| GREEN после адресных исправлений | `task-2-self-review-green.txt`: 20/20; `task-2-final-fixtures.txt`: 22/22; exact final HEAD: `task-2-final-head-fixtures.txt`: 22/22 | passed |

Для `task2-fixtures` не возникало двух последовательных реальных неуспехов. Проверка Task 1,
которую контроллер остановил ранее, не запускалась и Task 1 commands не менялись.

## Остальные проверки и коммиты

- `pnpm test`: server 19 + web 5 = **24 passed**, exit 0; подтверждён также обоими pre-commit.
- `pnpm exec prettier --check` на собственных settings/role/docs: exit 0, all matched files use Prettier style.
- `bash -n .claude/hooks/ritual-check.sh`: exit 0.
- `git diff --check`: exit 0.
- `python3 scripts/agent-loop/gate.py --help`: exit 0; output в `task-2-help.txt`.
- `eb4dc504f590e951ec8ae9f0d5404aaff05ad51d` — `feat(agents): add persistent contract gate and fixture checks`.
  Полный pre-commit output: `task-2-precommit.txt` (format, lint, 24 product tests passed).
- `ea7f142b729bd88b2b79e247130cd40d2e329992` — `docs(agents): use project language in gate comments`.
  Только комментарии/docstring, без изменения поведения. Полный pre-commit: `task-2-comments-precommit.txt`, passed.
- Pre-commit pnpm -r format/lint работает в workspace-пакетах, не является проверкой всех root/docs артефактов.
  Собственные root/docs проверены адресным Prettier. Посторонние snapshots/raw sources не форматировались.

Git commit потребовал разрешения на shared Git metadata; escalation разрешена автоматической проверкой.
Ни один hook не обходился, флаг --no-verify/HUSKY=0 не применялся.

## Собственные файлы (только они вошли в коммиты)

1. `.claude/hooks/ritual-check.sh`
2. `.claude/settings.json`
3. `.claude/agents/multica-tester.md`
4. `.claude/agents/multica-reviewer.md`
5. `docs/development/agent-loop-gate.md`
6. `docs/development/testing.md`
7. `scripts/agent-loop/.gitignore`
8. `scripts/agent-loop/gate.py`
9. `scripts/agent-loop/test_gate.py`

Посторонние dirty-файлы **сохранены**, не staged/committed/reverted: docs/multica/autopilot-checklists.md,
operating-model.md; исходные migration/execution планы; migration/execution/corrections отчёты;
новые raw source, docs/multica/proposed, snapshots и docs/reports/evidence. Точный список — manifest.
Полное worktree **не clean**. AGENTS/Task 1 commands/старые источники не изменены.

## Self-review и ограничения

- Trace-first: get_project_map(summary_only=true), затем outline существующего ritual-check.sh до чтения/редактирования.
  Сначала ошибочное имя check-plan-report.sh вернуло NOT_FOUND, фактический путь получен из settings.
  Trace индексирует исходный checkout, не worktree; существующий hook совпал с outline. Register_edit для новых
  worktree-only Python-файлов вернул indexed:0/errors:1; это ограничение индекса, не evidence об отсутствии кода.
- Self-review исправил строго через воспроизводящие fixtures: cwd fixture, парность человеческого отчёта,
  foreign evidence directory, schema timestamp/AC completeness, stale prior-stage revision и output.
- Gate 480 строк stdlib, один файл ответственности, без scheduler/proxy/wrapper и новых зависимостей.
- Fingerprint scoped: полный продуктовый diff не может выйти за scope, но полнота nonproduct scope требует reviewer.
  Игнорируемые secrets не читаются. SHA-256 не доказывает семантику/истинность evidence.
- Passport и state редактируемы тем же привилегированным агентом. Это не защита от намеренного обхода.
  Двойные snapshots обнаруживают обычные гонки, не дают OS-транзакции с Git.
- Завершённую стадию CLI автоматически не переоткрывает; после смены ревизии handoff остановлен до решения
  контроллера с сохранением истории. Сброс двух failures/force-unlock не реализован намеренно.
- Gate не исполняет проверки сам, не останавливает чужие процессы и не доказывает независимость личности reviewer.
  Native outcome, stage outcome и task acceptance остаются раздельными. `contract_valid` не означает принято.
- Multica/Codex/Claude runtime/model canary здесь **не выполнялась**. OS/read-only enforcement, автопилоты,
  внешняя очередь, источники/статусы T-112 не затрагивались. Полная M4 и независимое принятие ждут отдельных проверок.

Следующий разрешённый шаг: независимый reviewer проверяет этот exact HEAD и собственный diff по Task 2 AC;
контроллер переносит вывод и ссылки в канонический execution report. Не продолжать stopped Task 1 review.

## Дополнение контроллера перед независимым review

Два существенных ограничения требуют отдельного вердикта по полному автономному циклу; реализация
после замечания не расширялась, согласно указанию контроллера.

1. **Slot сейчас закрепляет run/stage, а не активного продуктового parent до конца всей цепочки.**
   `finish` освобождает общий slot целиком, сохраняя историю стадий, но не отдельную блокировку
   незавершённого parent task. Поэтому между завершением тестирования и стартом review другая
   задача может получить slot. Существующий fixture доказывает одну одновременно занятую lease,
   но **не** один продуктовый parent на всех промежутках цепочки. Это возможное нарушение Global
   Constraint, AC-2 в этой части не подтверждён; fixture не выдаётся за доказательство этой границы.
2. **Возврат reviewer→developer→tester после изменения кода пока не поддержан CLI.** Completed
   stage не переоткрывается, stale handoff отклоняется. Нужен явный переход с сохранением полной
   истории и failures; ручное удаление/редактирование state не считается разрешённым рабочим flow.
   Это блокирует полноту автономного цикла, даже при положительных существующих fixtures.

Контроллер поручил не добавлять сейчас непроверенную функциональность: независимый reviewer
должен оценить оба пункта и оформить адресные выводы. До этого нельзя считать M4 или
полный Task 2 lifecycle принятым.

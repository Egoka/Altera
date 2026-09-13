# Независимое ревью C0/C1–C5 diff Multica

- Вердикт: **вернуть до применения**.
- Объект проверки: `docs/multica/proposed/changes.json` и все 19 `after_file` из него против C0 snapshot, `docs/development/artifact-contracts.md`, `docs/development/project-rules.md`, `docs/multica/operating-model.md` и Task 4 плана.
- Граница: ревью read-only относительно Multica; конфигурация, issue, run и автопилоты не изменялись и не запускались.

## Блокирующие замечания

### B1. Автопилот очереди сохраняет два несовместимых определения готовности

`docs/multica/proposed/autopilot-c40fbc10-3bb3-4181-b244-14b87e8ae3f1-description.txt:1` говорит, что владелец отмечает готовность переводом Multica-задачи в `Todo`. В строке 13 того же after-text уже задан правильный составной gate: `готова` в `T-NNN` **и** `Todo` в Multica, закрытые зависимости, отсутствие открытого `Q-NN`, AC-ID и свободный слот.

Первая формулировка не просто неполна: она прямо приписывает `Todo` значение owner-controlled readiness и может разрешить dispatch при файле `кандидат`. Это противоречит `docs/multica/operating-model.md:86-99`, в особенности строкам 88-90, и таблице автопилотов на строке 145. Удалить или переписать второе предложение строки 1 так, чтобы `Todo` было только native-состоянием Multica, а готовность задавалась статусом `готова` в файле.

### B2. Общий навык нарушает границу read-only проверки

`docs/multica/proposed/skill-a65ce5c7-674b-44fe-b418-81c7f55b4116-SKILL.md.txt:57-61` продолжает называть `pnpm format:fix && pnpm lint && pnpm test` «Командами проверки». `format:fix` выполняет запись. Канонический контракт в `docs/development/project-rules.md:89-91` и `docs/development/testing.md:39-48` определяет для проверки `pnpm format`, а `format:fix` допускает только разрешённую правку ограниченного набора файлов.

Это особенно существенно потому, что общий навык назначен всем 10 участникам, включая тестировщика и независимого ревьюера, чьи роли запрещают исправлять продуктовый код (`docs/multica/operating-model.md:23-24`). Исправление только инструкции тестировщика на `pnpm format` недостаточно: доставляемый всем навык даёт противоположную команду. В общем навыке заменить проверочный pipeline на `pnpm format && pnpm lint && pnpm test`; `format:fix` оставить отдельной командой реализации с явной границей scope.

### B3. Навык требует сокращённую исходную ревизию вопреки artifact contract

`docs/multica/proposed/skill-a65ce5c7-674b-44fe-b418-81c7f55b4116-SKILL.md.txt:36-37` требует записывать в план `git rev-parse --short HEAD`. `docs/development/artifact-contracts.md:14` требует полный `baseline_commit`, строки 37-38 — полные baseline и revision SHA; `docs/development/project-rules.md:104-107` также требует полный commit для evidence. Добавленный блок того же навыка на строке 97 не исправляет это противоречие, потому что не уточняет длину SHA.

Заменить команду на `git rev-parse HEAD` и явно сохранить полный SHA в паспорте/evidence. Иначе разные коммиты могут получить неоднозначную или неканоническую ссылку, а общий навык будет расходиться с источником, который сам велит читать.

## Подтверждённые свойства предложения

- Manifest содержит 19 уникальных троек `kind/id/field` и 19 соответствующих after-файлов. Все 19 `before_sha256` совпали и с точным полем `before` в manifest, и с C0 snapshot; для двух сторонних навыков, не копируемых в Git, использован указанный snapshot-источник `/private/tmp/altera-multica-before-full`. Несовпадений — 0.
- Адресный набор меняет только 10 `agent.instructions`, 3 `skill content`, `squad.instructions`, 3 `autopilot.description`, одну `member.role` и `project.description`. Он не адресует model, runtime, thinking, visibility, roster membership, resource, trigger/schedule, autopilot status или execution mode. C0 фиксирует 10 тех же agent ID, 10 членов squad, 2 ресурса и 3 автопилота со статусом `paused`; расписания и assignee остаются вне diff. Это делает сохранение структурно возможным, но окончательно доказывается только C1 read-back после записи.
- Уникальные обязанности десяти ролей сохранены. Разработчик остаётся единственным автором продуктового кода; тестировщик проверяет и возвращает дефекты; reviewer не участвует в реализации; релиз-инженер сохраняет release gates. Точное изменение member-role релиз-инженера соответствует уже действующему разрешению в `docs/multica/operating-model.md:165-172` и не расширяет его.
- Три автопилота остаются `run_only` и paused. Контекстный автопилот ограничен только Project description, а repo overview оставлен хранителю документации в обычной принятой стадии, что совпадает с C1 на `docs/multica/operating-model.md:143` и 147-150.
- Предложение не заявляет ложное runtime enforcement: общий навык прямо говорит, что Multica `private` — только invocation ACL, а prompt/hook/skill не доказывают filesystem sandbox; общий блок after-текстов повторяет, что текст инструкции не доказывает ограничение runtime. Project description оставляет isolation tester/reviewer и сквозную цепочку непринятыми. Это согласуется с `docs/development/project-rules.md:123-125`, `docs/multica/operating-model.md:186-187` и зафиксированными официальными default-профилями Codex `danger-full-access` / Claude `bypassPermissions`.
- `SOURCE_SHA` пока остаётся шаблоном. Это допустимо только как pre-write placeholder: перед любой записью один и тот же полный SHA установленного source commit должен заменить его во всех after-текстах и `changes.json`, после чего требуется проверка отсутствия `SOURCE_SHA`. Проектное описание корректно датирует test baseline и помечает перечень ограничений историческим; остальные факты подчинены требованию перепроверять checkout/evidence на pinned source. Оставшиеся повторения одних и тех же фактов в role-text создают будущий риск drift, но сейчас не противоречат pinned source и сами по себе не блокируют применение.

## Неблокирующая несогласованность evidence

`docs/reports/2026-09-13-autonomy-execution-report.md:19` всё ещё сообщает о 18 подготовленных изменениях, хотя manifest и after-файлы содержат 19. Исправить число при следующем обновлении отчёта; на семантику конкретных 19 полей это не влияет.

После устранения B1-B3 proposal можно повторно проверить адресно только по изменённым after-текстам, затем подставить полный `SOURCE_SHA`, выполнить guarded writes с проверкой `before_sha256` и read-back. Включение автопилотов и запуск pilot остаются отдельными стадиями и этим вердиктом не разрешаются и не подтверждаются.

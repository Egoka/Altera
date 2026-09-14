# Минимум до рабочего Agent Loop pilot

Дата: 2026-09-14  
Статус: read-only critical-path audit

## Решение

**Product auth не блокирует первый честный Agent Loop pilot.** Он блокирует полную приёмку Task 3/M5: обязательный web typecheck остаётся красным из-за отсутствующей реализации session/current-user/named-auth middleware (`task-closure-critical-path.md:18–30`, `docs/plans/2026-09-13-autonomy-execution.md:22–24`). Поэтому auth нельзя объявить выполненным или убрать из полного плана, но ставить всю цепочку T008/T011/T012/T019/T021/T022/T023 перед native pilot — лишняя связь.

Прямой binding-критерий для pilot уже записан: «использовать существующую разрешённую pilot task и настоящие AC», а product/browser/release acceptance требуется только «в объёме конкретного паспорта, а не реализация всего product backlog» (`task-7-trusted-native-collector-brief.md:182`). Task 4 также требует snapshot/diff/readback, независимый pilot и негативные сценарии, но не объявляет product auth входом pilot (`docs/plans/2026-09-13-autonomy-execution.md:26–28`).

Практический кандидат — **T009 BFF transport**, если свежая admission проверка подтверждает его readiness и паспорт. Он имеет synthetic upstream и browser contract, но явно исключает cookies/session/login/roles (`task-closure-critical-path.md:49–50`). Его pass даёт реальный небольшой product AC для pilot; он не закрывает M5 или auth. Если текущая Playwright canary не будет принята, нужно выбрать другой уже разрешённый non-browser паспорт, а не считать browser task пройденной.

## Обязательные пробелы до pilot

1. **Принять ровно нужный runtime path.** Для browser-паспорта закончить уже идущий bounded Playwright package и получить настоящий PASS. Для назначенных pilot-ролей завершить постоянные native adapters, Codex managed config, fresh per-invocation preparation и необходимые context/hook/MCP проверки. Текущий статус прямо отмечает эти части незавершёнными (`docs/reports/2026-09-14-autonomy-current-status.md:27–33`; `task-7-trusted-native-collector-brief.md:133–136`, `:194–196`).
2. **Реализовать один вертикальный collector path.** Нужны atomic pending-ticket claim, exact `(workspace, agent, issue, run)` binding через фиксированный `issue runs KNOWN_ISSUE --active`, opaque task-token только для identity-verified CLI child, structured child/container outcome и quiescence, allowlisted quarantine, fixed check receipt и вызовы существующего gate. После wrapper exit существующий controller отдельно reconciles terminal status того же native ID перед следующей стадией (`task-7-trusted-native-collector-brief.md:41–46`, `:51–64`, `:83–117`, `:131–136`).
3. **Проверить production admission и применить минимальный Multica diff для pilot.** Сначала no-model binding/readback/cleanup/fresh-provisioning evidence, затем snapshot → exact diff → apply → readback только полей, необходимых выбранным ролям и паспорту. Autopilots остаются paused. Полный набор подготовленных изменений и activation checklist остаются обязательными для полного migration closure, но unrelated поля не должны задерживать один scoped pilot без прямого AC edge (`docs/plans/2026-09-13-autonomy-execution.md:28`; `task-closure-critical-path.md:77–81`; `task-7-trusted-native-collector-brief.md:199–205`).
4. **Провести один настоящий native цикл.** Multica назначает реальные роли; controller фиксирует contract/passport; executor делает разрешённый change; trusted checker исполняет declared check; отдельный reviewer выдаёт immutable substantive verdict; collector связывает native/process/check evidence и gate transition; later controller подтверждает terminal run и finish. Для первого рабочего pilot достаточно положительного цикла на настоящем AC. Return/recover, two-failure stop, publication/release и queue negatives затем закрывают полную Task 4/6 migration acceptance до включения autopilots (`task-7-trusted-native-collector-brief.md:163–182`, `:199–205`; `docs/plans/2026-09-13-autonomy-execution.md:38–85`).

## Связи, которые не следуют binding требованиям

- **Auth → любой pilot:** неверно. Auth обязателен для M5/global web gate, а не для отдельного non-auth паспорта.
- **Native terminal до process/check record:** создаёт цикл. Wrapper может доказать child/quiescence и exact active-run identity, записать `native_identity_running`, выйти, а terminal readback выполняется позже controller-ом (`task-7-multica-native-binding-preflight.md:217–244`, `:256–280`).
- **`agent tasks` вместе с `issue runs` как двойной production join:** не требуется. Production binding использует trusted ticket + ровно один exact matching row известного issue; `agent tasks` остаётся diagnostic-only из-за полного history/capture риска (`task-7-multica-native-binding-preflight.md:131–180`, `:184–198`).
- **Вторая lifecycle machine в collector:** запрещённое дублирование. Journal хранит delivery/reconciliation; gate остаётся владельцем slots, transitions и counters (`task-7-trusted-native-collector-brief.md:81`, `:134`, `:139–159`).
- **RO wrappers для всех ролей:** не записано как минимум Task 5. Реальная OS isolation обязательна для tester/reviewer; executor/keeper сохраняют существующий authorized single-writer path с проверкой scope/output (`task-7-trusted-native-collector-brief.md:11`, `:121–129`).
- **Все 19 Multica изменений до первого pilot:** binding docs требуют точный snapshot/diff/readback и поля выбранного flow, а не число 19. Необходимость каждого поля должна иметь прямое AC edge; оставшиеся изменения нужны перед полным migration/activation, но не могут быть молчаливо засчитаны scoped pilot-ом.

## Что останется после pilot

Положительный pilot докажет один рабочий autonomous path. Он не завершит Task 3/M5, product auth, полный Task 4/6 fault/recovery/publication/release набор, интеграцию отдельного worktree в исходный проект или activation checklists. Эти результаты нужно закрывать отдельно; только после них можно заявлять полную migration acceptance и включать autopilots (`docs/reports/2026-09-14-autonomy-current-status.md:3–6`, `:34–42`).

Аудит не запускал browser, Docker, CLI, network, tests, native/model/auth действия и не менял source/index/HEAD.

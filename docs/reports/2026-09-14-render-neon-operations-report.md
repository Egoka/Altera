# Отчёт: Render, Neon и контроль инфраструктуры

- **Дата**: 2026-09-14
- **План**: [render-neon-operations](../plans/2026-09-14-render-neon-operations.md)
- **Задача / authorization**: прямое поручение владельца исследовать и описать Render/Neon, передать правила Multica; development сохранён по ответу владельца.
- **Ветка**: codex/render-neon-operations
- **Baseline**: 1a6ebdb99600bfd1c65f2d76a55563129cbfe43e, clean
- **Проверенная revision**: 00c692f72cbdf954a051d57a507311a7356ecbdc; исходники аудита — baseline.
- **Actor / run**: Codex, local thread 01a09b13-a0f8-7e93-81c5-418a9272a26a
- **Run outcome**: success для аудита и настройки; восстановление runtime pending
- **Stage outcome**: документация и live instructions подготовлены
- **Task acceptance**: docs/config принято; deploy/Neon и HTTP проверены; полная runtime acceptance blocked из-за Redis
- **Результат**: аудит и docs/config выполнены; новый deploy Live, Neon восстановлен; Redis blocked

## Сделано

Создан канонический [runbook](../development/render-neon.md) с фактической картой окружения,
срезом инцидента и планом постоянной интеграции. Создан контракт
[infrastructure-checks](../multica/infrastructure-checks.md); ссылки добавлены в AGENTS,
operating-model, pr-auto-merge и post-merge-continuation. Будущие два frontend записаны как
намерение, отдельно от работающей среды и существующего Q-01/T-103.

## Evidence аудита

| AC / check_id                 | Источник / результат                                                                                                        | Ограничение                                                                                     |
| ----------------------------- | --------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| AC-1 / infra-render-settings  | CUA, Settings: srv-d1uk6b6mcj7s73ek25h0, app, server, Free Oregon, On Commit, PR previews Off, пустой health path           | Срез интерфейса, не экспорт API                                                                 |
| AC-1 / infra-neon-settings    | CUA, development и production: IDs/host, Free Virginia, PG17, history 6h, dev 0.25–2 CU, suspend 5min                       | Не аудит бизнес-данных                                                                          |
| AC-2 / infra-credential-match | CUA read-only DOM сравнение: обе Render строки passwordMatchesCurrentDevelopment=false; Neon password проверен как unmasked | Значения секретов не сохранены; это дефект конфигурации, не полное доказательство причины P1001 |
| AC-2 / infra-deploy-original  | Render dep-dak5cs49v7es73ft3ktg, 467bde721ff853d7e9057d393ba2e3abbf6ae46f: build failed на migrate deploy, P1001            | Новый deploy ещё не принят                                                                      |
| AC-2 / infra-neon-tcp         | Python socket.create_connection(host,5432,timeout=10), cwd repo, exit0; оба dev host и prod pooler reachable                | Запущено с Mac; не из Render, не SQL/auth                                                       |
| AC-2 / infra-live-http        | curl --max-time 75 к API /, JSON query InfrastructureProbe { \_\_typename }, exit28, HTTP000, 75 секунд                     | Нет HTTP ответа в бюджете; не доказывает конкретную причину или непрерывный outage              |
| AC-3 / infra-cli-auth         | render whoami -o json, CLI2.1.4, exit1 unauthorized                                                                         | CLI установлен, постоянный доступ не подключён                                                  |
| AC-3 / infra-ci-scope         | .github/workflows/pull_request.yml: PR only; Neon workflow создаёт preview, migrations закомментированы                     | Зелёные CI и branch creation не проверяют deployed DB                                           |

Actor для строк таблицы — Codex/local thread выше; стадия — аудит; источники кода закреплены
за baseline; runtime evidence относится к указанным service/branch/deploy IDs. Trace_ref —
история CUA/exec этого thread и ссылка на Render deploy из runbook. Полный browser trace
не экспортировался, т.к. Environment содержит secrets; сохранён только безопасный результат сравнения.

## Применение Multica

Обновлены 13 text fields: два autopilot, squad и десять агентов. Прежний текст сохранён после
нового prefix; readback совпал для всех 13. Cron/timezone/enabled/status не изменены.
Первый контроль остановился из-за служебного updated_at у trigger; после сравнения реальных
полей расписания продолжение пропустило уже применённый prefix без дублирования.

Точная инструкция и SHA-256 before/after:
[snapshot](../multica/snapshots/2026-09-14-infrastructure-checks/verified.json),
[prefix](../multica/snapshots/2026-09-14-infrastructure-checks/prefix.json).
Отдельно проверены все 13 хэшей prefix + before и отсутствие шаблонов credentials в новых
артефактах. Это подтверждает настройку, не выполненную canary из Multica.

## Проверки документов и публикация

Независимый actor `/root/render_neon_review` принял docs/config scope после устранения
конфликта dispatch; Critical/Important/Minor не осталось. Проверены 11 файлов, все 13 hashes,
сохранение старых инструкций и отсутствие credentials. Отчёт о ревью — trace этого thread.

Для revision выше `git diff --cached --check` и scoped `pnpm exec prettier --check` по
изменённым документам/JSON завершились с exit0. Обязательные hooks `format`, `lint`, `test`
завершились с exit0: server 20 passed/1 todo, web 56 passed. Cwd всех проверок — worktree
`.worktrees/render-neon-operations`, actor — Codex. Последующая правка этого отчёта фиксирует
полученное evidence, не меняет live prefix или исходный проверенный контракт.

[PR #32](https://github.com/Egoka/Altera/pull/32) содержит текущие GitHub checks и решение
об интеграции. Для данного docs/config diff Render deploy не требуется; это не закрывает
предыдущий infrastructure incident.

## Что осталось и почему

1. Владелец исправил две переменные в Render UI. Новый deploy
   `dep-dak5rnad0e5s73b458a0`, SHA `1a6ebdb99600bfd1c65f2d76a55563129cbfe43e`, Live с 23:51:40 MSK.
   Миграционное подключение development успешно: четыре миграции найдены, pending нет;
   build successful и server listening4000. P1001 в новой попытке устранён.
2. После Live `curl --max-time 90` с тем же \_\_typename запросом завершился exit0, HTTP200,
   0.413 секунды. Runtime log выявил новый blocker: повторный `ioredis ENOTFOUND`
   для старого Redis Cloud host. Полная release acceptance остаётся blocked до Redis проверки.
3. Подключить постоянную авторизацию Render/Neon в разрешённом runtime; затем canary именно из Multica.
4. Реализовать согласованный CI на app и post-deploy workflow; текущий scope содержит план и agent instructions.
5. DB-aware readiness и Redis verification остаются отдельной реализацией; \_\_typename не подменяет их.

## Отклонения и ограничения

Независимое ревью выявило конфликт старого запрета dispatch до финализации с ожиданием внешнего
деплоя. Добавлен узкий `parked_release` с readback, сохранением parent/worktree и повторным
получением единого slot перед recovery-записью; backlog-autofill и pr-auto-merge согласованы.
Если runtime не умеет доказать park/reacquire, используется прежний последовательный порядок.

Вместо необоснованной смены БД на production получено решение владельца сохранять development.
Live smoke не прошёл за 75 секунд; автоматический повтор без нового условия не делался.
Offline install не нашёл один tarball; frozen install с сетью выполнен для подготовки проверок.
Schema, данные, тарифы, домены и credentials этим commit не изменяются.

## Handoff

Рабочее дерево: .worktrees/render-neon-operations. Runtime blocker теперь Redis ENOTFOUND;
нужен адрес действующего сервиса, запрошен у владельца без пароля. Auth blocker:
render whoami unauthorized. Проверка infra-live-http после изменения среды прошла,
предыдущий timeout сохранён как история; infra-cli-auth один неуспех. Не запускать новый
deploy без исправления Redis. Состояние документации и полной runtime acceptance раздельны.

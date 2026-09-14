# Подготовка штатных autopilot

Дата: 2026-09-14. [План](../plans/2026-09-14-standard-autopilot-preparation.md).
Baseline: `fb6a43cfb7cc30663e613ff2d232f8ba4784f0d4`. Исполнитель: Codex по прямому поручению владельца.

## Что подготовлено

Владелец выбрал штатный native режим и ALTE-10. M4 не принят и не перезапускается ради очереди.
Два агента переключаются на штатные runtime с прежними моделями и effort. Экспериментальные
профили отключаются. Все три autopilot остаются paused, расписания сохраняются.
Изменения API выполняются с проверкой ответов; изменения issue — только с `--no-start`.

Старые настройки и точные целевые поля сохранены в
`docs/multica/snapshots/2026-09-14-standard-launch/`. Пользовательские секреты не выгружались.
Описание проекта обновлено без переноса старого перечня дефектов в текущие факты.
ALTE-10 уточнена по текущему YAML/package.json; критерии T-001 сохранены.

## Как проверено

- AC-2: `git diff --stat 3db90d682ad7c483032ea14de968eb2ff63c8fd1 HEAD --` для пяти
  файлов из T-110 дал пустой вывод, exit 0. Независимый review принят:
  `evidence/2026-09-13-autonomy/t110-review.md`. Native реализация completed.
- Предыдущий invocation `abf5a531f74340278eecac1ec5fb202b` оказался уже потреблён отдельным
  native run `01a0a046-4f60-7288-bd40-af20cf56178e` до подготовки. Он failed; adapter refusal
  и неизвестный runtime outcome сохранены. Это не непотреблённый ticket, как ожидал план.
  Проверены отсутствие active native run и Altera-контейнеров; slot освобождён решением
  владельца, owner-cancelled receipt сохранён без утверждения приёмки M4.
- Новые agent/autopilot run эта подготовка не вызывает. Runtime online подтверждает связь
  с daemon, но не является сквозной проверкой задачи или авторизации модельного запроса.

## Итог подготовки и проверка checkout

Подготовка завершена. Финальный readback API от `2026-09-14T14:39:00Z`:
`docs/multica/snapshots/2026-09-14-standard-launch/final-readback.json`.
AC-1/2/3/4 подготовки подтверждены: десять агентов на штатных runtime, модели/effort
сохранены, concurrency=1, ALTE-10 единственная Todo, ALTE-4 Done, ALTE-11 Cancelled,
три autopilot paused, расписания совпадают с исходными, активных agent run нет.

Checkout: `/Users/egorbondarenko/WebstormProjects/Altera/.worktrees/autopilot`;
ветка `codex/autopilot-start`. Проверенная исходная ревизия checkout:
`8b2c1d8335bb09c6acf47028ca36b00d8a3f458b`. Dirty tree до/после проверок — clean.
Последующее дополнение этого отчёта и launch-инструкции не меняет проверенный source.

- `pnpm install --frozen-lockfile` — exit 0, установлено 1244 пакета, lockfile не изменён.
  Первый install предупредил о Node 24.3.0 в исходном PATH; установленная 24.12.0 найдена
  и закреплена первой в custom PATH всех десяти агентов. Их прежний custom_env был пуст.
  Readback каждого env совпал с заданным значением; секретные env не читались.
- `PATH=/Users/egorbondarenko/.nvm/versions/node/v24.12.0/bin:$PATH pnpm format` — exit 0.
- С тем же PATH `pnpm lint` — exit 0; `pnpm test` — exit 0, server 19 и web 56 passed,
  server один TODO и один skipped test file. Node v24.12.0, pnpm 10.18.3 подтверждены.
- Установка предупредила об отключённых dependency build scripts; workspace postinstall
  Prisma/Nuxt выполнились, baseline проверки прошли. Build/typecheck и фактический CI остаются
  критериями ALTE-10, подготовка не выдаёт их за выполненные.
- Локальный `.claude/settings.local.json` в новом checkout отключает hooks, чтобы M4 Stop-hook
  не требовал ticket в штатном режиме. Общие permission rules сохранены. Основная папка
  владельца остаётся на `docs/agent-loop-autonomy` с прежним пользовательским lockfile.

Сетевые таймауты при env update и финальном readback устранены проверкой фактического
состояния и повтором только чтения/незавершённых записей. Новые model run не запускались.
Решение включить autopilot оставлено владельцу. Инструкция: `docs/multica/standard-autopilot-launch.md`.

Основной `pnpm-lock.yaml` — чужое незакоммиченное изменение, в commits подготовки не входит.
Trace: история tool calls этой сессии и безопасные snapshots. Полный native runtime trace
для будущего запуска отсутствует, потому что запуск намеренно не выполняется.

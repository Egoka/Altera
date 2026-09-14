# T-004: прод-сборка веба и CI smoke

- **Задача:** T-004 / ALTE-13
- **Базовый коммит:** `843b7d2`
- **Полный baseline:** `843b7d2c16a294adfc73eb7e1059731d6d11b247`
- **Ветка:** `web/t-004-prod-build`
- **Worktree:** `/Users/egorbondarenko/WebstormProjects/Altera/.worktrees/t-004-web-prod-build`
- **Источник полномочий:** комментарий оркестратора `01a0a1c8-1feb-7cda-b6c5-56bb34e002c1`

## Цель

Устранить подтверждённую причину ошибки ESM-импорта `vue` в production SSR-бандле Nuxt под
Node `24.12.0` и включить в CI настоящий запуск этого бандла с проверкой HTTP 200 для `/` и `/en`.

## Границы

- В scope: конфигурация production-сборки web, исполняемый smoke-скрипт, scripts web-пакета,
  PR workflow и отчёт задачи.
- Вне scope: `sharp`, `/_ipx/`, изменение страниц, продуктовых правил и backend.
- Один и тот же smoke-скрипт используется локально и в CI; ошибки запуска и HTTP не глушатся.

## Затрагиваемые файлы

- `web/scripts/smoke.sh` — запускает `.output/server/index.mjs`, ожидает готовность, проверяет `/`
  и `/en`, завершает только созданный процесс и печатает диагностический лог при ошибке.
- `web/package.json` — объявляет команду production smoke.
- `web/nuxt.config.ts` — меняется только если воспроизведение и трассировка emitted bundle
  подтвердят причину в настройке externalization/transpile.
- `pnpm-lock.yaml` — меняется только если подтверждённая причина требует корректировки зависимости.
- `.github/workflows/pull_request.yml` — после production build вызывает production smoke.
- `docs/reports/2026-09-15-t004-web-prod-build-report.md` — причина, RED/GREEN и фактические проверки.

## Исполнение

1. Установить зависимости frozen-lockfile под Node из `.nvmrc`; записать версии Node и pnpm.
2. Собрать baseline и запустить `.output/server/index.mjs`; получить коды `/` и `/en`, полный стек
   ошибки и найти generated import, который запрашивает default export `vue`.
3. Проследить generated import до исходного пакета и сравнить его формат модулей с правилами
   Nuxt/Nitro. Зафиксировать одну проверяемую гипотезу причины до исправления.
4. Добавить `web/scripts/smoke.sh` и package script. Запустить его на неисправном baseline и получить
   ожидаемый RED по реальному HTTP/start поведению.
5. Внести одно минимальное исправление в подтверждённой точке причины. Повторить smoke и получить
   GREEN с явными кодами `/: 200` и `/en: 200`.
6. Подключить ту же package-команду в job `web-checks` непосредственно после build; сохранить
   проверку CI workflow локально доступными средствами.
7. Выполнить `pnpm format`, `pnpm lint`, `pnpm test`, web build, typecheck и production smoke.
   Для каждой команды записать exit code и существенный вывод; два последовательных сбоя одного
   `check_id` останавливают стадию.
8. Оформить отчёт, проверить scoped diff, закоммитить без обхода hooks, push и открыть PR в `app`.

## Приёмка

- AC-1: под Node `24.12.0` собранный production server отвечает HTTP 200 на `/` и `/en`.
- AC-2: PR workflow запускает тот же production smoke после сборки; окончательное evidence — лог CI.
- Независимые тестирование и ревью выполняются следующими ролями на точном SHA реализации.

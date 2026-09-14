# Отчёт T-004: прод-сборка веба и CI smoke

## Результат

Production SSR-бандл Nuxt запускается под Node `24.12.0` и отвечает HTTP 200 на `/` и `/en`.
В job `web-checks` после сборки добавлен запуск того же smoke-скрипта, который используется локально.

- **Задача:** T-004 / ALTE-13
- **Baseline:** `843b7d2c16a294adfc73eb7e1059731d6d11b247`
- **Ветка:** `web/t-004-prod-build`
- **План:** `docs/plans/2026-09-15-t004-web-prod-build.md`
- **Проверяемое окружение:** macOS arm64, Node `24.12.0`, pnpm `10.18.3`

## Причина дефекта

В `web/package.json` был подключён `@pinia/nuxt@0.11.2`, но отсутствовала его прямая peer-зависимость
`pinia`. pnpm предоставлял `pinia@3.0.3` только внутри peer snapshot модуля. Nitro встроил
`pinia.prod.cjs` в server chunk и преобразовал `require("vue")` в:

```js
import require$$0, { defineComponent /* ... */ } from "vue"
```

ESM-модуль Vue не экспортирует `default`, поэтому каждый SSR-запрос завершался 500. Добавление
прямой зафиксированной зависимости `pinia@3.0.3` позволило Nitro оставить Pinia runtime dependency;
после пересборки default import исчез, а `.output/server/package.json` содержит `pinia: 3.0.3`.

Сценарий соответствует [nuxt/nuxt#33132](https://github.com/nuxt/nuxt/issues/33132): для Nuxt с
`@pinia/nuxt` тот же production-only stack устраняется установкой прямого `pinia`.

## Изменения

- `web/package.json`: добавлены `pinia@3.0.3` и команда `smoke`.
- `pnpm-lock.yaml`: добавлен только importer прямой зависимости Pinia; несвязанные transitive
  ререзолюции не включены.
- `web/scripts/smoke.sh`: запуск production bundle, условное ожидание ответа, проверки `/` и `/en`,
  диагностический лог и cleanup только созданного процесса.
- `.github/workflows/pull_request.yml`: `web-checks` запускает production smoke сразу после build.

`web/nuxt.config.ts` не менялся: отдельный transpile/noExternal workaround не нужен после исправления
peer dependency в источнике.

## TDD: RED → GREEN

### RED — baseline bundle

Команда: `PORT=4315 web/scripts/smoke.sh`.

Результат: exit `1`.

```text
/: 500
SyntaxError: The requested module 'vue' does not provide an export named 'default'
```

До smoke отдельно были получены `/ 500` и `/en 500`; stack указывал на
`web/.output/server/chunks/build/server.mjs:1`, а использование `require$$0` — на встроенный
`pinia.prod.cjs`.

### GREEN — после прямой зависимости Pinia

Команда: `PORT=4319 pnpm --filter nuxt-app run smoke` под Node `24.12.0`.

Результат: exit `0`.

```text
/: 200
/en: 200
✓ production web отвечает на SSR-маршрутах
```

## Как проверено

Все итоговые команды выполнялись из
`/Users/egorbondarenko/WebstormProjects/Altera/.worktrees/t-004-web-prod-build` с Node `24.12.0`
в `PATH`.

| check_id | Команда | Exit | Существенный результат |
| --- | --- | ---: | --- |
| `t004-frozen-install` | `pnpm install --frozen-lockfile` | 0 | lockfile принят без изменения; postinstall завершены |
| `t004-format` | `pnpm format` | 0 | оба workspace formatter-run завершились `All matched files use Prettier code style!` |
| `t004-lint` | `pnpm lint` | 0 | ESLint обоих пакетов без diagnostics |
| `t004-tests` | `pnpm test` | 0 | server: 3 files, 20 passed, 1 todo; web: 6 files, 56 passed |
| `t004-web-typecheck` | `pnpm --filter nuxt-app run typecheck` | 0 | `nuxt prepare` и `vue-tsc -b --noEmit` завершились без diagnostics |
| `t004-web-build` | `pnpm --filter nuxt-app run build` | 0 | Nuxt 4.0.0 / Nitro 2.12.0 создали `.output/server/index.mjs` |
| `t004-direct-http` | `PORT=4318 node web/.output/server/index.mjs` + два `curl` | 0 | `/ 200` (211557 bytes), `/en 200` (171586 bytes) |
| `t004-web-smoke` | `PORT=4319 pnpm --filter nuxt-app run smoke` | 0 | `/ 200`, `/en 200`, cleanup процесса выполнен |
| `t004-shell-syntax` | `bash -n web/scripts/smoke.sh` | 0 | shell syntax корректен |
| `t004-diff` | `git diff --check` | 0 | whitespace errors отсутствуют |

Сборка печатает известное предупреждение об отсутствующем optional `sharp` binary для darwin-arm64.
Это не влияет на проверяемые SSR-маршруты и явно исключено из T-004; `/_ipx/` не проверялся.

## Отклонение формулировки команды

Буквальная команда задачи `pnpm --filter web build` на baseline завершилась exit 0 с сообщением
`No projects matched the filters` и ничего не собрала. Актуальные `web/package.json` и
`docs/development/testing.md` фиксируют имя workspace-пакета `nuxt-app` и прямо запрещают копировать
`--filter web`. Поэтому фактическая сборка и все evidence используют каноническую команду
`pnpm --filter nuxt-app run build`; переименование пакета не входит в scope T-004.

## Ограничения и следующий шаг

- Локально подтверждены AC-1 и исполняемый сценарий AC-2.
- GitHub CI ещё не запускался до публикации PR; окончательный лог CI должен быть привязан к точному
  SHA реализации после push.
- Следующий владелец: тестировщик и независимый ревьюер проверяют PR/SHA, затем релиз-инженер ведёт
  merge. Изменение web/CI не затрагивает backend shared inputs и не требует миграций БД.

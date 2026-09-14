# Отчёт: T-002 — контракт SDL и Playwright smoke

- **Дата**: 2026-09-14
- **План**: docs/plans/2026-09-14-t002-test-infrastructure.md
- **Задача / authorization**: T-002 / ALTE-15, назначение оркестратора на KG-2 и KG-3
- **Ветка**: test/t-002-test-infrastructure
- **Baseline**: `85d3af44b20e4ddae6adc7f67cb87c8192d1d186`, clean
- **Проверенная revision**: `0c0a6f6d924ec378ac105683e3566270c536bb17`, clean
- **Коммиты**: `0c0a6f6d924ec378ac105683e3566270c536bb17`
- **Actor / run**: Altera — разработчик (`b0f3bc32-dd95-471e-b40e-517aaf83edf0`), текущий локальный run ALTE-15 (native run ID в brief не предоставлен)
- **Run outcome**: blocked
- **Stage outcome**: остановлена после частичного результата
- **Task acceptance**: не проверено
- **Результат**: выполнено частично

## 1. Что сделано

- Существующий `test.todo` разделён так, чтобы сборка и `validateSchema` всей SDL выполнялись
  активным Vitest-тестом независимо от отложенного privacy-контракта.
- Privacy-тест временно активирован и запущен как RED: он действительно обнаружил `email` и
  `role` в публично возвращаемом `User`. Красное изменение не сохранено в результате.
- Подтверждено, что baseline уже содержит Playwright-конфигурацию, homepage smoke, скрипт
  `test:e2e` и обязательный CI job `web-smoke`; повторная реализация не добавлялась.
- Работа выполнена в отдельном чистом worktree; грязный checkout T-003 не изменялся.

## 2. Что не сделано и почему

- **AC-T002-KG2-PRIVACY не закрыт**: `server/src/graphql/user/schema.graphql` определяет
  `User.email` и `User.role`, а публичный `Query.author` возвращает `User`. Удаление этих полей из
  публичного контракта принадлежит T-027, который меняет продуктовый код и зависит от T-015/T-026.
  T-002 прямо допускает `todo` этой проверки до T-027.
- PR в `app` не открыт: текущий scoped commit полезен и зелёный, но PR с заявлением о полном
  закрытии KG-2 был бы ложным. Ветка и commit сохранены для решения координатора.

## 3. Отклонения от плана

После аудита выяснилось, что KG-3 уже реализован на baseline. Вместо дублирования выполнена
актуальная локальная проверка. Полный GREEN KG-2 невозможен без scope T-027; стадия остановлена с
точным dependency blocker.

## 4. Затронутые файлы

- `server/tests/public-schema-contract.test.ts`
- `docs/plans/2026-09-14-t002-test-infrastructure.md`
- `docs/reports/2026-09-14-t002-test-infrastructure-report.md`

## 5. Как проверено

Среда всех локальных проверок: macOS, Node `v24.3.0`, pnpm `10.18.3`. Репозиторий требует Node
`24.12.0`; pnpm печатал `Unsupported engine`, поэтому локальный результат не заменяет CI на
закреплённой версии. Cwd, если не указан иной: корень отдельного worktree
`/Users/egorbondarenko/WebstormProjects/Altera/.worktrees/t-002-test-infrastructure`.

### AC-T002-KG2-PRIVACY — RED

- `check_id`: `t002-sdl-public-fields-red`
- actor/run: Altera — разработчик / текущий run ALTE-15
- стадия: разработка
- revision: baseline `85d3af44b20e4ddae6adc7f67cb87c8192d1d186` + временный dirty diff (`test.todo` → `test`)
- command: `pnpm --filter server exec vitest run tests/public-schema-contract.test.ts`
- started_at: 2026-09-14T22:53:11+03:00
- exit code: `1`
- executed: 1 test, 1 failed
- significant output: `expected [ 'email', 'role' ] to deeply equal []`
- result: `failed` (ожидаемый RED, последовательных неуспехов обязательного GREEN: 1)
- trace_ref: tool trace текущего run; отдельный экспорт недоступен
- limits: доказывает чувствительность теста и существующий дефект SDL, но не разрешает продуктовый scope T-027

### AC-T002-KG2-SCHEMA — GREEN

- `check_id`: `t002-sdl-schema-vitest`
- revision: `0c0a6f6d924ec378ac105683e3566270c536bb17`, clean
- command: `pnpm --filter server exec vitest run tests/public-schema-contract.test.ts`
- started_at: 2026-09-14T22:53:37+03:00
- exit code: `0`
- executed: 1 passed, 1 todo
- significant output: `Test Files 1 passed (1); Tests 1 passed | 1 todo (2)`
- result: `passed`
- trace_ref: tool trace текущего run; отдельный экспорт недоступен
- limits: privacy-проверка остаётся todo до T-027

### AC-T002-KG3 — Playwright

- `check_id`: `t002-homepage-playwright-smoke`
- revision: `0c0a6f6d924ec378ac105683e3566270c536bb17`, source поведения неизменён относительно baseline
- command: `pnpm --filter nuxt-app run test:e2e -- tests/e2e/homepage.smoke.spec.ts`
- started_at: 2026-09-14T22:53:47+03:00
- exit code: `0`
- executed: 1 passed, 9 skipped
- significant output: `homepage exposes the required Altera document title ... 1 passed (24.7s)`
- result: `passed`
- trace_ref: tool trace текущего run; отдельный экспорт недоступен
- limits: команда Playwright также собрала девять намеренно skipped сценариев T-112; локальный запуск не является GitHub Actions evidence

### AC-T002-QUALITY — format

- `check_id`: `t002-format`
- revision: dirty source, впоследствии зафиксирован без изменения в `0c0a6f6d924ec378ac105683e3566270c536bb17`
- command: `pnpm format`
- started_at: 2026-09-14T22:54:34+03:00
- exit code: `0`
- significant output: `All matched files use Prettier code style!`
- result: `passed`
- limits: engine warning Node v24.3.0 вместо 24.12.0

### AC-T002-QUALITY — lint

- `check_id`: `t002-lint`
- revision: dirty source, впоследствии зафиксирован без изменения в `0c0a6f6d924ec378ac105683e3566270c536bb17`
- command: `pnpm lint`
- started_at: 2026-09-14T22:54:42+03:00
- exit code: `0`
- significant output: ESLint завершился без диагностик
- result: `passed`
- limits: engine warning Node v24.3.0 вместо 24.12.0

### AC-T002-QUALITY — unit

- `check_id`: `t002-unit`
- revision: dirty source, впоследствии зафиксирован без изменения в `0c0a6f6d924ec378ac105683e3566270c536bb17`
- command: `pnpm test`
- started_at: 2026-09-14T22:54:57+03:00
- exit code: `0`
- executed: server 20 passed + 1 todo; web 56 passed
- significant output: `server Test Files 3 passed; web Test Files 6 passed`
- result: `passed`
- limits: todo — незакрытый privacy-контракт T-027; engine warning Node v24.3.0 вместо 24.12.0

Commit hook повторно выполнил `pnpm format`, `pnpm lint`, `pnpm test` перед созданием
`0c0a6f6d924ec378ac105683e3566270c536bb17`: exit `0`, те же итоги 20+1 todo и 56 passed.

## 6. Что осталось

1. Координатору подтвердить один из двух допустимых путей: дождаться принятого результата T-027 и
   затем активировать privacy-тест в T-002 либо явно расширить scope текущей задачи на часть T-027
   вместе с её зависимостями и независимой проверкой.
2. После GREEN privacy-контракта заново выполнить обязательные проверки на точном output SHA,
   открыть PR в `app` и передать тестировщику.

## 7. Handoff и история попыток

- Цель / задача / стадия: T-002 / ALTE-15 / разработка.
- Ветка / HEAD: `test/t-002-test-infrastructure` / `0c0a6f6d924ec378ac105683e3566270c536bb17`.
- Состояние дерева до отчёта: clean.
- Сделано: активная SDL validation, RED privacy evidence, подтверждение существующего KG-3.
- Осталось: продуктовый GREEN privacy-контракта и последующий PR/review.
- `t002-sdl-public-fields-red → 1` ожидаемый RED; остальные check_id → 0 неуспехов.
- Причина остановки: контракт/scope/dependency — T-027 владеет необходимым изменением SDL и имеет
  незакрытые зависимости T-015/T-026.
- Условие возобновления: принятый output T-027 либо явное решение координатора о расширении scope
  с подтверждёнными зависимостями.
- Активный дубликат не создавался: использованы существующие parent ALTE-12 и child ALTE-15.
- Следующий разрешённый шаг: координатор маршрутизирует dependency blocker; текущий run не
  объявляет задачу принятой.

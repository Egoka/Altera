# Отчёт: T-092 — ядро дизайн-системы, токены и тема

- **Задача**: T-092 / ALTE-22
- **Стадия**: разработка
- **Исполнитель**: Altera — разработчик
- **Baseline commit**: `a39387e089253c5b2918db4329887a51a0e71377`
- **Ревизия реализации**: `ba2c8d0effaca12a1528760f962ae4b3f8a8f4e6`
- **Ветка**: `web/t-092-design-tokens-theme`
- **Worktree**: `/Users/egorbondarenko/WebstormProjects/Altera/.worktrees/t092-design-tokens`
- **Время проверки**: `2026-09-15T12:23:16+03:00`

## Результат

- В `main.css` добавлена единая семантическая палитра для светлой и тёмной тем, удалена
  дублирующая шкала `secondary`, исправлен `success-500` и удалены токены неподключённых шрифтов.
- Включена базовая типографика: Waterway для `h1`–`h2`, Garamond Libre для `h3`–`h6` и `.prose`.
- Добавлены токены контейнеров и горизонтальных отступов.
- Тёмная тема переопределяет только семантические токены через `html.dark`.
- `ThemeToggle.vue` переведён на `useColorMode()`, собственный `useTheme.ts` удалён.
- Добавлен браузерный регрессионный сценарий для `@nuxtjs/color-mode` и семантических токенов.

## Отклонения от плана

`web/app/components/demo/` и `web/app/components/article/featured.vue` уже отсутствовали в
baseline `a39387e`, поэтому удалять их повторно не потребовалось. Остальные компоненты и страницы
не изменялись.

## Как проверено

Среда: Node `v24.3.0`, pnpm `10.18.3`, Playwright Chromium; проект ожидает Node `24.12.0`, поэтому
pnpm печатал предупреждение об engine. Все команды выполнялись из корня worktree.

### TDD RED

`check_id: t092-theme-playwright-red`

```text
LOG_HASH_SECRET=<test-value> pnpm -C web exec playwright test tests/e2e/theme.spec.ts
exit code: 1
Expected: rgb(250, 249, 247)
Received: rgba(0, 0, 0, 0)
1 failed
```

Проверка падала по требуемому поведению: до реализации `html` не получал фон из семантического
токена. Первый подготовительный запуск не дошёл до теста из-за отсутствующего
`LOG_HASH_SECRET`; повтор выполнен с безопасным тестовым значением. После первой реализации один
запуск обнаружил ошибку самого теста: init-script очищал storage и при reload. Тест исправлен без
изменения production-поведения, после чего получен GREEN.

### AC-1 — базовая типографика не закомментирована

`check_id: t092-ac1-typography-grep`

```text
if grep -nE '/\*@layer base|/\*[[:space:]]+(html|h[1-6]|p|a|button|nav a)[[:space:]{,:]' \
  web/app/assets/css/main.css; then exit 1; else echo 'AC-1 PASS: закомментированная базовая типографика не найдена'; fi
exit code: 0
AC-1 PASS: закомментированная базовая типографика не найдена
```

### AC-2 — единый механизм темы

`check_id: t092-ac2-theme-playwright`

```text
LOG_HASH_SECRET=<test-value> pnpm --filter nuxt-app run test:e2e
exit code: 0
Running 14 tests using 5 workers
5 passed, 9 skipped
theme.spec.ts: theme switches through Nuxt color mode and semantic tokens — passed
```

Сценарий на `http://127.0.0.1:4173/components-showcase` проверил светлый фон, сохранение значения
`dark` в `nuxt-color-mode`, класс `dark` на `html` после reload, тёмный фон и отсутствие legacy-ключа
`theme`. Это подтверждает локальный браузерный механизм; production deployment не проверялся.

### Остальные проверки

```text
pnpm --filter nuxt-app run typecheck
exit code: 0
Nuxt types generated; vue-tsc -b --noEmit завершён без диагностик

pnpm lint
exit code: 0
ESLint завершён без ошибок

pnpm test
exit code: 0
server: 11 files, 70 passed, 1 todo
web: 11 files, 75 passed

pnpm format
exit code: 0
All matched files use Prettier code style!

git diff --cached --check
exit code: 0
```

Девять skipped Playwright-сценариев относятся к ещё не реализованным потокам других задач и не
входят в T-092. Целевой AC-2 и четыре существующих активных browser smoke/BFF-сценария выполнены.

## Evidence

```yaml
task: T-092
stage: development
actor: Altera — разработчик
baseline_commit: a39387e089253c5b2918db4329887a51a0e71377
revision_commit: ba2c8d0effaca12a1528760f962ae4b3f8a8f4e6
dirty_fingerprint: clean at revision_commit before adding this report
cwd: /Users/egorbondarenko/WebstormProjects/Altera/.worktrees/t092-design-tokens
environment: Node v24.3.0; pnpm 10.18.3; Playwright Chromium
trace_ref: native trace export unavailable; sanitized essential commands are recorded above
result: passed
limits: local verification only; nine unrelated deferred browser flows skipped; deployment not checked
```

## Передача

Стадия разработки завершена на ревизии `ba2c8d0…`. Следующий исполнитель — тестировщик: повторить
AC-1 и AC-2 на этой ревизии с учётом отдельного report-коммита, затем передать независимому ревьюеру.

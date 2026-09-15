# Отчёт: T-092 — стабилизация Playwright-проверки темы

- **Задача**: T-092 / ALTE-22, возврат после CI PR #46
- **Стадия**: разработка, fix iteration 1
- **Исполнитель**: Altera — разработчик
- **Baseline commit**: `934921ac3ae49b4c9b33ae3444e7e85d6508531f`
- **Ветка**: `web/t-092-fix-playwright`
- **Check ID дефекта**: `t092-ci-theme-playwright-navigation`
- **Время проверки**: `2026-09-15T12:52:51+03:00`

## Причина дефекта

В CI PR #46 тест падал на последнем прямом `page.evaluate` после `page.reload()`:

```text
web/tests/e2e/theme.spec.ts:17
page.evaluate: Execution context was destroyed, most likely because of a navigation
```

Locator assertions класса и фона успевали завершиться, но отдельное чтение `localStorage` могло
попасть в уничтожение JavaScript-контекста при продолжающейся навигации. Локально baseline прошёл
10/10 при двух workers, поэтому источником воспроизведения служит CI-лог PR #46.

## Исправление

До `reload` тест записывает `nuxt-color-mode=dark` и конфликтующий legacy `theme=light`. После
навигации остаются только retrying locator assertions: `html.dark` и тёмный семантический фон.
Таким образом, проверяется наблюдаемое поведение — legacy-ключ не переопределяет Nuxt color mode —
без прямого обращения к нестабильному page execution context после навигации.

Production-код не изменён.

## Как проверено

Среда: Node `v24.3.0`, pnpm `10.18.3`, Playwright `1.63.0`, Chromium. Репозиторий закрепляет Node
`24.12.0`, поэтому pnpm печатал engine warning.

### Baseline, до исправления

```text
LOG_HASH_SECRET=<test-value> pnpm -C web exec playwright test tests/e2e/theme.spec.ts \
  --repeat-each=10 --workers=2
exit code: 0
10 passed (55.2s)
```

Локально флак не воспроизведён; это не отменяет первичный CI-отказ.

### Проверка стабильности после исправления

```text
LOG_HASH_SECRET=<test-value> pnpm -C web exec playwright test tests/e2e/theme.spec.ts \
  --repeat-each=20 --workers=2
exit code: 0
20 passed (1.6m)
```

### Полный browser suite

```text
LOG_HASH_SECRET=<test-value> pnpm --filter nuxt-app run test:e2e
exit code: 0
5 passed, 9 skipped (54.4s)
theme.spec.ts passed (22.2s)
```

Девять skipped-сценариев — ранее отложенные unrelated flows. Активные homepage, BFF и theme
сценарии прошли.

### Проверки репозитория

```text
pnpm format
exit code: 0
All matched files use Prettier code style!

pnpm lint
exit code: 0

pnpm test
exit code: 0
server: 11 files, 70 passed, 1 todo
web: 11 files, 75 passed

pnpm --filter nuxt-app run typecheck
exit code: 0
Nuxt types generated; vue-tsc завершён без диагностик

git diff --check
exit code: 0
```

## Evidence

```yaml
task: T-092
stage: development_fix
actor: Altera — разработчик
baseline_commit: 934921ac3ae49b4c9b33ae3444e7e85d6508531f
check_id: t092-ci-theme-playwright-navigation
ci_failure_count_before_fix: 1
baseline_local_reproduction: not_reproduced (10 passed); primary failure is CI PR #46
fixed_stress_result: passed (20/20, 2 workers)
full_e2e_result: passed (5 active, 9 unrelated skipped)
trace_ref: native trace export unavailable; sanitized commands and outputs are recorded above
limits: local Node differs from pinned version; final GitHub CI and merge are pending
```

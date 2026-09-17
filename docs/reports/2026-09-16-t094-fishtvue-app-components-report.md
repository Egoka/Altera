# Отчёт: T-094 — компоненты приложения на FishtVue

- **Задача**: T-094 / ALTE-45 (`01a0a71b-4a78-7070-a1b7-93f3fb19b3b5`)
- **Источник**: `docs/backlog/tasks/T-094-app-components-fishtvue.md`
- **Source commit**: `bb67f06498463bc3375e7ddff8bea4ad35facad3`
- **Source blob**: `92ea328fdada385a670d44a02fdf9e5d0d6e3f05`
- **Baseline commit**: `1757975a2e0eefabf122635675b26262ce62b586`
- **Ревизия реализации**: `8bb96a8bbf629cdbb63ddcd76d5fc597ef8123a8`
- **Ветка**: `agent/altera/06e901ab4f79`
- **Исполнитель**: Altera — разработчик (`b0f3bc32-dd95-471e-b40e-517aaf83edf0`)
- **Native execution ID**: `01a0a71d-d9d6-74b3-8dc7-06e901ab4f79`

## Результат

- FishtVue настроен на единый outlined-режим и общий порядок CSS-слоёв с темой на `html.dark`.
- Добавлены типизированные обёртки `AppTable`, `AppForm` и `AppDialog` с пробросом props, attrs,
  событий и scoped slots.
- Таблицы существующих административных страниц переведены на `AppTable`.
- Табличные поверхности, текст и границы привязаны к семантическим токенам `--color-surface`,
  `--color-ink` и `--color-rule`; формы и диалоги используют тот же слой токенов.

## Как проверено

Среда: Node `v24.3.0`, pnpm `10.18.3`, Playwright `1.63.0`, Chromium. Репозиторий закрепляет Node
`24.12.0`, поэтому pnpm печатал engine warning.

### TDD RED/GREEN и критерий T-094

```text
pnpm --filter nuxt-app exec playwright test tests/e2e/app-components-theme.spec.ts
RED: exit code 1 — [data-app-table] отсутствовал в light и dark
GREEN: exit code 0 — 2 passed
```

Сценарий открывает `/admin/tags` в обеих темах, затем меняет семантические CSS-токены во время
выполнения и проверяет вычисленные фон, текст и границу ячейки. Поэтому тест подтверждает именно
зависимость FishtVue-таблицы от токенов, а не совпадение захардкоженных цветов.

### Финальные проверки ревизии реализации

```text
pnpm format
exit code: 0

pnpm lint
exit code: 0

pnpm test
exit code: 0
server: 17 passed, 2 skipped; 109 passed, 6 skipped
web: 15 passed; 120 passed

pnpm --filter nuxt-app run typecheck
exit code: 0

pnpm --filter nuxt-app exec playwright test tests/e2e/theme.spec.ts tests/e2e/app-components-theme.spec.ts
exit code: 0
3 passed
```

Playwright при запуске также выполнил production-сборку Nuxt. Сборка сообщила существующие
предупреждения о sourcemap Tailwind, устаревшем browserslist и отсутствующем локальном `sharp` для
darwin-arm64; ошибок сборки не было. Шесть server-тестов имеют существующий статус skipped и не
относятся к web-scope T-094.

## Передача

Критерий разработки выполнен на `8bb96a8bbf629cdbb63ddcd76d5fc597ef8123a8`. Следующие стадии —
дизайн-review и независимое code review точного PR head; merge и Done выполняет controller.

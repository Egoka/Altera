# План: T-092 — стабилизация Playwright-проверки темы

- **Задача**: T-092 / ALTE-22, возврат после CI PR #46
- **Baseline commit**: `934921ac3ae49b4c9b33ae3444e7e85d6508531f`
- **Ветка**: `web/t-092-fix-playwright`
- **Worktree**: `/Users/egorbondarenko/WebstormProjects/Altera/.worktrees/t092-fix-playwright`
- **Check ID дефекта**: `t092-ci-theme-playwright-navigation`
- **Дата**: 2026-09-15

## Причина возврата

В CI PR #46 последний `page.evaluate` в `web/tests/e2e/theme.spec.ts` выполнялся после
`page.reload()` и иногда попадал в уничтожение JavaScript-контекста продолжающейся навигацией.
Предшествующие locator assertions успевали пройти, но прямое чтение `localStorage` не имело
retrying-семантики locator assertion.

Исходный тест локально прошёл 10/10 при `--repeat-each=10 --workers=2`; флак подтверждён первичным
CI-логом PR #46, а не воспроизведён локально.

## Исправление

1. До `reload` записать одновременно `nuxt-color-mode=dark` и конфликтующий legacy `theme=light`.
2. После `reload` не читать `localStorage` через `page.evaluate`.
3. Проверить locator assertions, что `html` получил класс `dark` и тёмный семантический фон.

Так тест проверяет пользовательски наблюдаемое правило «тема управляется только Nuxt color mode»:
legacy-ключ не может переопределить выбранную тёмную тему. Production-код не меняется.

## Затрагиваемые файлы

- `web/tests/e2e/theme.spec.ts`
- `docs/plans/2026-09-15-t092-fix-playwright-navigation.md`
- `docs/reports/2026-09-15-t092-fix-playwright-navigation-report.md`

## Проверка

- целевой Playwright-тест несколько раз подряд и параллельно;
- полный `pnpm --filter nuxt-app run test:e2e`;
- `pnpm format`, `pnpm lint`, `pnpm test`, `pnpm --filter nuxt-app run typecheck`;
- CI PR в `app`, затем merge по актуальному head.

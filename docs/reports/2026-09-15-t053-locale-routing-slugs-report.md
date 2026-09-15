# T-053: отчёт по адресации локалей и переключателю языка

- **Дата**: 2026-09-15
- **Задача**: T-053 / ALTE-34, AC-T053-1
- **План**: `docs/plans/2026-09-15-t053-locale-routing-slugs.md`
- **Baseline**: `bf5931670fc7145ac7a4a8994afb735dff83b3c4`
- **Ветка**: `docs/t-053-locale-routing`
- **Worktree**: `/Users/egorbondarenko/WebstormProjects/Altera/.worktrees/t053-locale-routing`
- **Статус**: AC-T053-1 реализован; AC-T053-2 не выполнялся и остаётся заблокированным на T-013/T-014/T-015

## Выполнено

- Nuxt i18n переведён на `defaultLocale: "ru"`, `prefix_except_default` и детерминированный root без browser redirect.
- Nitro route rule возвращает прямой HTTP 301 с `/ru` на `/`.
- Все существующие страницы `/me/**` и `/admin/**` помечены `definePageMeta({ i18n: false })`; остальные noindex routes не исключались из i18n.
- `LanguageToggle` стал одной SSR-safe ссылкой. Для статической страницы используется `useSwitchLocalePath`, для динамического материала — точный внутренний `publishedSiblingPath`, для отсутствующей/небезопасной пары — главная целевой локали.
- Production smoke проверяет `/`, `/en`, прямой redirect `/ru` и обе SSR-ссылки переключателя.

## TDD и проверки

RED до реализации:

- `tests/locale-routing.test.ts`: 17/17 ожидаемо упали на default `en`, включённой browser detection, отсутствии redirect и page opt-out.
- `tests/locale-route.test.ts`: suite ожидаемо упал из-за отсутствующего `~/utils/localeRoute`.
- `tests/language-toggle.test.ts`: 2/2 ожидаемо упали, поскольку исходный компонент был кнопочным и не имел tri-state prop/resolver.
- `tests/smoke-script.test.ts`: новые redirect и SSR-content assertions ожидаемо падали до расширения smoke.
- отдельный header integration assertion выявил отсутствующий явный import: Nuxt зарегистрировал файл как `FunctionalLanguageToggle`, поэтому `<LanguageToggle />` не рендерился; после явного import assertion стал GREEN.

GREEN и обязательные проверки:

- `pnpm --filter nuxt-app exec vitest run tests/locale-routing.test.ts` — exit 0, 17 tests passed.
- `pnpm --filter nuxt-app exec vitest run tests/locale-route.test.ts` — exit 0, 9 tests passed.
- `pnpm --filter nuxt-app exec vitest run tests/language-toggle.test.ts tests/smoke-script.test.ts` — exit 0, 6 tests passed.
- `pnpm --filter nuxt-app run typecheck` — exit 0.
- `pnpm --filter nuxt-app run build` — exit 0, Nitro node-server output создан.
- `pnpm --filter nuxt-app run smoke` — exit 0: `/` 200, `/en` 200, `/ru` 301 → `/`; обе SSR language-switch ссылки найдены.
- `pnpm format` — exit 0, все файлы соответствуют Prettier.
- `pnpm lint` — exit 0.
- `pnpm test` — exit 0: server 81 passed + 1 todo, web 106 passed.

## Ограничения проверки

- `mountSuspended` component check остановлен после двух environment failures: установленный `@nuxt/test-utils@3.19.2` импортирует `vitest/environments`, отсутствующий в `vitest@5.0.0`. Зависимости вне scope не обновлялись; компонент покрыт resolver/source-contract тестами и production SSR smoke.
- Targeted Playwright check остановлен после двух запусков по бюджету. Первый запуск не поднял baseline backend без `LOG_HASH_SECRET`; тестовое значение добавлено в Playwright webServer command. Второй запуск подтвердил HTTP assertions, но нашёл неотрендеренный неявно подключённый компонент. Причина исправлена явным import и подтверждена отдельным RED→GREEN assertion и production SSR smoke; третий Playwright запуск не выполнялся.
- Среда использовала Node `24.3.0` при заявленном engine `24.12.0`; все завершённые проверки дали exit 0, предупреждение сохранено как environment variance.

## Незавершённое

- AC-T053-2 и любые schema/delete/reservation изменения не выполнялись. Для продолжения нужны принятые выходы T-013/T-014/T-015 и решение владельца по ordering.
- Результат developer stage требует независимого тестирования и ревью актуального commit SHA.

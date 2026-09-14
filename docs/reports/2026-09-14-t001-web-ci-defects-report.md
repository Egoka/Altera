# Отчёт: исправление web-дефектов, выявленных полным CI T-001

- **Дата**: 2026-09-14
- **План**: docs/plans/2026-09-14-t001-web-ci-defects.md
- **Задача / authorization**: T-001 / ALTE-10; прямое поручение владельца в комментарии `01a0a072-2e55-72ac-8a01-c84345189d73`, уточнённый scope в `01a0a073-7550-7a69-9914-a4665b20ec02`
- **Ветка**: codex/autopilot-start
- **Baseline**: e6a4e1b6ee46110554107cb4539aaad52cf7dcf1; исходное постороннее изменение `AGENTS.md`, SHA-256 `2571d72d60e279265cfdaa83528f3325d3ca9877e3f17e135e8603a9544f60b4`
- **Проверенная revision**: 86dfb06e07c2a5dfe2430fadeae15204d0ec3a03; `AGENTS.md` остаётся вне коммита с тем же SHA-256
- **Коммиты**: 86dfb06e07c2a5dfe2430fadeae15204d0ec3a03
- **Actor / run**: Altera — разработчик / local run по trigger `01a0a073-7550-7a69-9914-a4665b20ec02`
- **Run outcome**: success
- **Stage outcome**: завершена
- **Task acceptance**: не проверено
- **Результат**: выполнено полностью

## Что сделано

- Route props `ShowAuthor` и `ShowType` сужены до фактически используемого строкового типа.
- Error page использует типизированный `useRouter()` вместо `$router` из template proxy.
- Параметр `slugArticle` читается через Nuxt `useRoute()` и преобразуется в строку; контракт
  `HeaderTag` сужен до реально потребляемого поля `name`.
- Optional `mockUser.photoUrl` нормализуется при создании `ArticleResponse`, не расширяя общий
  контракт карточек.
- Страницы `/me` помечены `requiresAuth: true`; несуществующая ссылка на named middleware
  `auth` удалена, поскольку `auth.global.ts` подключается Nuxt глобально.
- Главная страница устанавливает document title `Altera` через `useHead()`.

## Что не сделано и почему

- GraphQL, сервер, CI workflow и реализация проверки сессии в `auth.global.ts` не менялись:
  это не требовалось для двух порученных дефектов.
- Слияние и релиз не выполнялись: текущая кодовая ревизия должна пройти независимое review.

## Отклонения от плана

После первого исправления исходных десяти ошибок typecheck выявил один следующий дефект:
`HeaderTag` требовал полный `SectionTag`, хотя использует только `name`. Вместо фиктивного
заполнения полей контракт компонента сужен до `Pick<SectionTag, "name">`; после этого повторная
проверка успешна.

## Затронутые файлы

- `web/app/components/header/tag.vue`
- `web/app/components/show/Author.vue`
- `web/app/components/show/Type.vue`
- `web/app/error-t.vue`
- `web/app/pages/[slugTypeContent]/[slugArticle].vue`
- `web/app/pages/authors/[slug].vue`
- `web/app/pages/index.vue`
- пять страниц в `web/app/pages/me/`
- план и этот отчёт

## Как проверено

Все команды выполнены из корня репозитория. Проверяемое содержимое web-файлов соответствует
коммиту `86dfb06e07c2a5dfe2430fadeae15204d0ec3a03`; посторонний dirty-файл `AGENTS.md` не входит в
коммит и сохраняет исходный SHA-256.

### AC-WEB-TYPES

- `check_id`: `t001-web-typecheck-red`
- Команда: `pnpm --filter nuxt-app run typecheck`
- До исправления: exit 2; воспроизведены все 10 заявленных ошибок — два route prop,
  `$router`, route param, `photoUrl` и пять ссылок на middleware `auth`.
- `check_id`: `t001-web-typecheck-green`
- Промежуточная попытка: exit 2; единственная ошибка TS2739 показала слишком широкий контракт
  `HeaderTag`. Между попытками контракт изменён на `Pick<SectionTag, "name">`.
- Финальная команда: `pnpm --filter nuxt-app run typecheck`
- Результат: exit 0; Nuxt types generated, ошибок `vue-tsc` нет.
- `trace_ref`: локальный вывод текущего run; persistent failures после финальной проверки: 0.

### AC-HOME-TITLE

- `check_id`: `t001-home-title-smoke`
- Команда: `pnpm --filter nuxt-app run test:e2e -- tests/e2e/homepage.smoke.spec.ts`
- До исправления: exit 1; `Expected: "Altera"`, `Received: ""`; 1 failed, 9 skipped.
- После исправления: exit 0; 1 passed, 9 skipped. Сценарий подтвердил видимую ссылку Altera,
  URL `/` и document title `Altera`.
- Ограничение: Playwright вывел не блокирующие предупреждения `NO_COLOR` и устаревшего
  `caniuse-lite`; остальные девять E2E-сценариев имеют собственные условия и были skipped.
- `trace_ref`: локальный вывод текущего run.

### AC-REGRESSION

- `check_id`: `t001-format`; `pnpm format` → exit 0, оба workspace сообщили
  `All matched files use Prettier code style!`.
- `check_id`: `t001-lint`; `pnpm lint` → exit 0, ESLint ошибок не вывел.
- `check_id`: `t001-vitest`; `pnpm test` → exit 0: server — 2 test files passed,
  1 skipped, 19 tests passed, 1 todo; web — 6 test files и 56 tests passed.
- `check_id`: `t001-web-build`; `pnpm --filter nuxt-app run build` → exit 0:
  Nuxt 4.0.0 / Nitro 2.12.0, 3119 client modules transformed, server bundle built,
  preview command emitted. Не блокирующие предупреждения: устаревший `caniuse-lite` и
  отсутствие sharp binaries для darwin-arm64.
- Commit hook дополнительно повторил `pnpm format`, `pnpm lint` и `pnpm test` успешно;
  test counts совпали: server 19 passed + 1 todo, web 56 passed.
- `trace_ref`: локальный вывод текущего run.

### AC-SCOPE

- `git diff --cached --check` перед implementation commit → exit 0.
- Implementation commit содержит 13 файлов: план и 12 web-файлов; `AGENTS.md` не staged и не
  включён. Серверные, workflow и lockfile-файлы не менялись.

## Что осталось

- Запушить implementation и evidence commits в `origin/codex/autopilot-start`.
- Получить CI evidence и независимую приёмку актуальной revision; после этого релиз-инженер
  может выполнить merge в `app` по штатному маршруту.

## Handoff и история попыток

Проверка `t001-web-typecheck-green` имела одну неуспешную промежуточную попытку и затем успешную;
лимит двух последовательных неуспехов не достигнут и успешный прогон обнулил счёт. Homepage
smoke прошёл с первой post-fix попытки. Следующий владелец — оркестратор: направить новую
ревизию на независимое тестирование/review и затем релиз-инженеру для merge.

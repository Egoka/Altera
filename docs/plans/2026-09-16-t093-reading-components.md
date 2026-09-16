# T-093 Reading Components Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Собрать единый набор компонентов чтения, подключить публичные рубрики к шапке и заменить шаблонный футер реальными маршрутами Altera.

**Architecture:** Публичная навигация получает отдельный GraphQL-контракт без административных аргументов и возвращает только активные рубрики с опубликованными материалами. Web-слой сводит прежние карточки к одному `ArticleCard` с вариантами `lede`, `large`, `small`, `rank`; атомы метаданных, состояния, закладка, шапка и футер остаются небольшими независимыми компонентами. Существующие имена карточек сохраняются тонкими адаптерами, чтобы не менять вне scope страницы лент.

**Tech Stack:** Node 24.12.0, pnpm 10.18.3, TypeScript 5.8, Vue 3.5, Nuxt 4, GraphQL Yoga, Prisma 6.12, Vitest 5, `@nuxt/test-utils`, Playwright 1.63, Tailwind CSS 4.

**Spec:** `docs/backlog/tasks/T-093-reading-components.md`, `docs/vision/06-design-system.md` §4, `docs/spec/20-public/home.md`, `docs/decisions/ADR-0021-ui-libraries-reading-vs-application.md`.

## Global Constraints

- Публичные компоненты чтения не используют FishtVue.
- Шапка показывает только активные непустые рубрики из API; административный `sections` остаётся закрыт ролями `admin`/`owner`.
- Первый SSR/client render детерминирован: навигация загружается как некритичный client-side ресурс с явными loading/empty состояниями.
- Компоненты используют текущие токены, локальные гарнитуры, контейнер `max-w-7xl` и доступный keyboard focus.
- Изменения идут test-first; сгенерированные GraphQL-файлы обновляются штатным `pnpm codegen`.

---

### Task 1: Публичный API рубрик

**Files:**

- Modify: `server/src/graphql/section/schema.graphql`
- Modify: `server/src/graphql/section/resolver.ts`
- Create: `server/tests/public-sections.test.ts`
- Modify: `web/app/graphql/operations/common/navigation.graphql`
- Generated: `web/app/graphql/generated/gql.ts`
- Generated: `web/app/graphql/generated/graphql.ts`
- Generated: `web/app/graphql/generated/schema.graphql`

**Interfaces:**

- Produces: `Query.publicSections: [Section!]!`; результат упорядочен по `order`, содержит только `status = active` и рубрики, где есть `published` article.
- Preserves: `Query.sections(...)` по-прежнему требует `admin` или `owner`.

- [ ] Написать unit-тест резолвера: гость получает только выборку с `status: "active"`, `articles.some.status: "published"`, `orderBy: { order: "asc" }`.
- [ ] Запустить `pnpm --filter server test -- public-sections.test.ts` и подтвердить RED из-за отсутствующего `publicSections`.
- [ ] Добавить поле схемы и минимальный резолвер без пользовательских аргументов.
- [ ] Проверить GREEN тем же тестом и существующими contract-тестами схемы.
- [ ] Перевести `GetNavigation` на `publicSections`, выполнить `pnpm codegen` и проверить GraphQL operation test.

### Task 2: Единая модель карточки и атомы чтения

**Files:**

- Create: `web/app/types/reading.ts`
- Create: `web/app/components/reading/Byline.vue`
- Create: `web/app/components/reading/SectionKicker.vue`
- Create: `web/app/components/reading/DateStamp.vue`
- Create: `web/app/components/reading/ProBadge.vue`
- Create: `web/app/components/reading/BookmarkButton.vue`
- Create: `web/app/components/article/Card.vue`
- Modify: `web/app/components/article/base.vue`
- Modify: `web/app/components/article/large.vue`
- Modify: `web/app/components/article/small.vue`
- Modify: `web/app/components/article/lede.vue`
- Modify: `web/app/components/article/text.vue`
- Create: `web/tests/reading-components.nuxt.test.ts`

**Interfaces:**

- Produces: `ReadingArticle`, `ArticleCard` props `article`, `variant`, optional `media`, `rank`, `bookmarked`, `bookmarkState`, `canBookmark`, `loginPath`.
- Produces: `BookmarkButton` event `toggle(nextValue: boolean)`; guest state links to login, busy state is disabled and carries `aria-busy`.
- Preserves: прежние `ArticleBase`, `ArticleLarge`, `ArticleSmall`, `ArticleLede`, `ArticleText` props as adapters.

- [ ] Добавить Nuxt component-test project and required test dependencies.
- [ ] Написать snapshots для четырёх вариантов карточки, отсутствующего изображения, pro/translation metadata и состояний bookmark; назвать поломку, которую ловит каждый тест.
- [ ] Запустить только `reading-components.nuxt.test.ts`, подтвердить RED из-за отсутствующих компонентов.
- [ ] Реализовать типы, атомы и `ArticleCard` с семантическими ссылками, `alt`, focus-visible и reduced-motion-safe transitions.
- [ ] Перевести старые карточки на тонкие адаптеры и добиться GREEN без изменения их публичных props.

### Task 3: Состояния списков

**Files:**

- Create: `web/app/components/reading/EmptyState.vue`
- Create: `web/app/components/reading/ErrorState.vue`
- Create: `web/app/components/reading/LoadingSkeleton.vue`
- Modify: `web/tests/reading-components.nuxt.test.ts`

**Interfaces:**

- Produces: `EmptyState` с опциональным CTA; `ErrorState` с `requestId` и контактной ссылкой; `LoadingSkeleton` с `aria-busy` и скрытым визуальным декором.

- [ ] Добавить snapshots трёх состояний и проверить RED.
- [ ] Реализовать минимальные доступные компоненты и проверить GREEN.

### Task 4: API-driven AppHeader и реальный AppFooter

**Files:**

- Create: `web/app/composables/usePublicNavigation.ts`
- Modify: `web/app/components/app/header.vue`
- Modify: `web/app/components/visual/MegaMenu.vue`
- Modify: `web/app/components/app/footer.vue`
- Create: `web/tests/navigation.nuxt.test.ts`
- Create: `web/tests/e2e/navigation.spec.ts`

**Interfaces:**

- Consumes: `GET_NAVIGATION` with `publicSections` and `popularTags`.
- Produces: `usePublicNavigation()` with normalized `sections`, `popularTags`, `status`; header renders section links from this response and an explicit empty state.

- [ ] Написать Nuxt test с зарегистрированным `/api/graphql`: названия/slug ответа появляются в menu, отсутствующие данные дают пустое меню.
- [ ] Написать Playwright RED: browser route отвечает двумя рубриками, пользователь открывает меню и видит обе ссылки.
- [ ] Реализовать client-side lazy navigation fetch through same-origin BFF; заменить статический MegaMenu данными.
- [ ] Заменить футер на `/about`, `/legal/content-rules`, `/legal/paid-services`, `/legal/privacy`, `/legal/refunds`, `/contact`, `/rss.xml` и текущий год без недетерминированной гидрации.
- [ ] Проверить GREEN для Nuxt snapshots и Playwright navigation scenario.

### Task 5: Проверки, отчёт и delivery

**Files:**

- Create: `docs/reports/2026-09-16-t093-reading-components-report.md`
- Create: `docs/reports/tasks/T-093.json`
- Create: `docs/reports/tasks/T-093.md`

**Interfaces:**

- Produces: evidence точного tested SHA, команд, критериев и известных ограничений; поля controller-only не выставляются.

- [ ] Выполнить targeted tests, `pnpm format`, `pnpm lint`, `pnpm test`, `pnpm --filter nuxt-app typecheck`, `pnpm --filter nuxt-app build`, browser Playwright scenario.
- [ ] Зафиксировать реальный вывод, версии Node/pnpm и отсутствие миграций в web build.
- [ ] Провести визуальную самопроверку desktop/mobile и исправить только выявленные дефекты T-093.
- [ ] Обновить отчёт и канонический receipt, сделать scoped commit, push и PR в `app`.
- [ ] Передать PR текущего SHA контроллеру для CI и независимого review; не выполнять merge/Done напрямую.

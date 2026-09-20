# План T-054: главная `/` и `/en` на резолвере `feed`

- **Задача**: ALTE-91 / T-054 (`docs/backlog/tasks/T-054-home-page-launch.md`)
- **Baseline**: `4ea27a63d0fac9ccc9eb38cde522d9b17b58799b` (`origin/app`), ветка `web/t054-home`,
  рабочее дерево `.worktrees/t054-home`
- **Источники**: журнал §20.1–5, §22.1–4, §25.1; `docs/spec/20-public/home.md`,
  `docs/spec/60-ranking/home-sections.md`, `docs/spec/60-ranking/feed-principles.md`,
  `docs/spec/00-registries/pages.md` #1

## 1. Что меняется

### Сервер

1. Новый домен `server/src/graphql/feed/` парой `schema.graphql` + `resolver.ts`:
   `feed(scope: FeedScope! = home, locale: Locale!): Feed!`. Ответ — `sections[]` в
   фиксированном порядке топ → новое → популярное; пустая подборка в ответ не попадает
   (`home.md` §5: «пусто — зона скрыта»), поэтому «Популярное» на первом этапе отсутствует.
2. Правила первого этапа: топ — пять последних по дате первой публикации с подписью
   «по дате публикации» (§20.4); «Новое» — окно новизны, до 12 карточек, без материалов,
   занятых топом (§22.4); «Популярное» — до контура вовлечённости пусто (F-02).
3. Кеш: `buildCacheKey("query.feed", { scope, locale })`, тег `home`, TTL `publicList`.
   Инвалидация уже приходит от `buildArticleCacheTags` (публикация, снятие, массовые
   операции) и от таксономии.
4. Удаляются заменённые `featuredArticles`, `latestArticles`, `popularArticles`: это
   доспецификационные запросы главной, `popularArticles` возвращал не популярность, а дату.

### Веб

5. Операция `web/app/graphql/operations/pages/home.graphql` переписывается на `feed`;
   `pnpm codegen` обновляет сгенерированный клиент.
6. `pages/index.vue` получает подборки через `useAsyncData` + `useGraphQL` (SSR), различает
   строки состояний `home.md` §8: готовая страница, «Пусто» (приглашение авторам), «Ошибка
   данных» (`ErrorState` с `requestId`), скелеты при клиентской навигации.
7. Компоненты `pages/start/Featured|Latest|Popular` становятся props-driven, фикстуры из них
   уходят: `Featured` — `lede` плюс четыре `large`, `Latest` — группы `buildFeedGroups`,
   `Popular` — карточки `rank`.
8. Блок «Востребованное» с главной снимается: `home.md` §5 фиксирует шесть зон без него,
   журнал §20.1, §20.3 запрещает дополнительные блоки на стартовой главной. Компонент и
   его ритм удаляются, `DEMO_DEMANDED` остаётся для страниц рубрики, тега и автора (T-055).
9. «Писать» в шапке ведёт в `/me/articles/new` (§7, журнал §25.1); гостя дальше
   перекладывает на `/login?next=…` уже существующий `createArticleDraftAndOpenEditor`.
10. Словари ru/en получают подписи подборок и текст приглашения — парность ключей
    охраняет `i18n-locales.test.ts`.

## 2. Проверки

| Проверка | Что доказывает |
| --- | --- |
| `pnpm --filter server test` | правила отбора, отсутствие повторов, локаль, кеш и инвалидация `feed` |
| `pnpm --filter nuxt-app test` | отображение подборок в карточки, строки состояний страницы, отсутствие фикстур |
| `pnpm codegen --check`, `pnpm format`, `pnpm lint` | контракт схемы и стиль |
| `pnpm --filter nuxt-app run typecheck`, `build` | типы и сборка |
| `grep` по `web/app` | фикстуры главной удалены |
| Playwright `tests/e2e/homepage.spec.ts` | `/` и `/en` на пустой базе CI: шапка, приглашение, отсутствие фикстур |

Локальная граница: PostgreSQL и Docker в рабочей среде недоступны, миграции для проверки
доступа не запускаются, поэтому Playwright выполняется джобом `web-smoke` в CI, а не локально.

## 3. Границы

- Не входит: топ по рейтингу и «Популярное» за неделю (F-02), мутации закладок (T-033),
  `useSeoMeta`, sitemap и RSS (T-099, T-100), страница `/pricing` (T-060).
- Реестр `pages.md` #1 упоминает `topAuthors`, чего нет в `home.md` §5 и что запрещает
  журнал §20.1: расхождение выносится в отчёт, синхронизация реестров — T-110.

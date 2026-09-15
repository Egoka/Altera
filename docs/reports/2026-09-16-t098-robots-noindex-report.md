# T-098: robots.txt с запретом обучения ИИ; noindex служебных страниц

**Задача:** T-098 / ALTE-24  
**PR:** #59 (`web/t-098-robots-noindex`)  
**Tested SHA:** `add175d44f03108589d01bce46a2f5ad4db206d9`  
**Merge SHA:** `fd8d703fa07df9a8489febbe60e3e8ef244eb68c`  
**Дата:** 2026-09-16

## Что сделано

- `web/public/robots.txt`: разрешает поисковые боты, закрывает `/me`, `/admin`, `/preview`, `/_nuxt/`, `/_ipx/`, `/api/`; запрещает 8 AI-ботов (GPTBot, CCBot, anthropic-ai, Claude-Web, Omgilibot, FacebookBot, Applebot-Extended, DataForSeoBot).
- `web/app/layouts/auth.vue`: `useHead()` с `noindex, nofollow` — все страницы `/me/*`.
- `web/app/layouts/admin.vue`: `useHead()` с `noindex, nofollow` — все страницы `/admin/*`.
- `web/tests/robots-txt.test.ts`: 15 unit-тестов на содержимое `robots.txt`.
- `web/tests/e2e/noindex-meta.spec.ts`: Playwright-тесты на тег `noindex` для `/me` и `/admin`.

## Критерии готовности

| AC | Критерий | Статус | Доказательство |
|----|----------|--------|----------------|
| AC-1 | `/robots.txt` содержит правила по спецификации | пройден | 15 unit-тестов; CI: все проверки зелёные |
| AC-2 | Страницы `/me/*` отдают `noindex` | пройден | Playwright E2E; CI: все проверки зелёные |

## Как проверено

- `pnpm format` — exit 0
- `pnpm lint` — exit 0
- `pnpm -F nuxt-app typecheck` — exit 0
- `pnpm test` — web: 120 passed, server: 109 passed + 6 skipped
- CI PR #59: все проверки SUCCESS

## Независимое ревью

Ревьюер: agent `db94a617-807c-4eec-981f-51fd4b3217d4`  
Run: `01a0a6df-4e60-75e1-a39f-975b8aa5bea7`  
Вердикт: **approved** (`ALTERA_REVIEW_V1 {"sha": "add175d44f03108589d01bce46a2f5ad4db206d9", "verdict": "approved"}`)

## Замечания ревьюера (не блокеры)

Спецификация упоминает `/auth/` и `/search` — добавить при создании этих страниц. `Sitemap:` — Phase 3.

## Ссылки

- ALTE-24: задача в Multica
- PR #59: https://github.com/Egoka/Altera/pull/59
- Источник задачи: `docs/backlog/tasks/T-098-robots-noindex.md`

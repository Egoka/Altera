# Спецификации Altera

Здесь лежат поштучные проектные спецификации второй фазы: каждая страница, кабинет каждой
роли, каждый раздел админки, каждый пользовательский маршрут, каждая роль, каждый компонент
рейтинга, каждый план подписки, каждая политика доступа, логирования и хранения — отдельным
файлом по единому шаблону.

Спецификация описывает **целевое поведение** и ссылается на решения (`docs/decisions/`) по
номеру, не пересказывая их. Про существующий код она говорит только со ссылкой на
`docs/vision/00-reality-check.md` или `файл:строка`.

## Принципы папки

1. **Одна сущность — один файл.** Объединять «похожие» страницы или разделы запрещено; общее
   выносится в политику (`50-access/`, `60-ranking/README.md`) и цитируется ссылкой.
2. **Реестр главнее файлов.** Сначала утверждается реестр в `00-registries/`, потом каждая его
   строка получает файл. Строка со статусом выше «черновик» без файла — недоделка; файл, не
   упомянутый ни в одном реестре, — сирота. Правило проверки — в `00-registries/README.md`.
3. **Шаблоны обязательны.** Каждый файл следует своему шаблону из `_templates/` целиком: пустой
   раздел заполняется одним предложением-обоснованием («не применимо, потому что …»), а не
   пропускается.
4. **Ни оценок, ни приоритизации.** В спецификациях нет человеко-дней, разделов «что не
   делаем», сценариев сокращения. Порядок и объём работ живут в `docs/issues/`.
5. **Пометки:** `[ФАКТ: файл:строка]` — утверждение о коде; `[ДОПУЩЕНИЕ]` — всё непроверенное
   (значения по умолчанию, лимиты, тексты); `[ВОПРОС ВЛАДЕЛЬЦУ]` — только с последствием
   («если да — …, если нет — …»). Вопросы каждого файла собираются в его последнем разделе и
   сводятся в `OPEN-QUESTIONS.md` при приёмке фазы.
6. **Словарь** — `docs/vision/01-product.md` ревизии 2; при расхождении главнее журнал
   решений Г1 `docs/decisions/role-review-working-log-2026-09-08.md` и реестры. Слова «контур», «витрина»,
   «отбор», «правило-арбитр» допустимы лишь в историческом контексте.

## Статусы файла

В шапке каждого файла: `черновик` → `на утверждении` → `утверждён` → `заменён` (с указанием
файла-преемника). Статус меняет только владелец или заход по его поручению.

## Карта папок

```
_templates/            шаблоны: page, admin-section, flow, role, ranking, policy
OPEN-QUESTIONS.md      свод открытых вопросов владельцу и отложенных проходов (фаза 2 завершена
                       2026-09-09 — журнал §29; заходы 1–9, гейты Г1–Г9)
00-registries/         реестры: routes, pages, admin-sections, access-matrix,
                       events-and-logs, plans, flows, roles
10-flows/              пользовательские маршруты (register-and-login, become-author,
                       write-and-publish, pay-and-upgrade, subscription-expires,
                       moderation, appoint-admin, complaint, …)
20-public/             публичные страницы (home, section-feed, tag-feed, article, author,
                       authors-index, sections-index, tags-index, search, login, verify,
                       pricing, about, contact, legal-*, not-found, gone, error, offline)
30-account/reader/     кабинет читателя (profile-edit, bookmarks, sessions, subscription,
                       email-change, delete-account)
30-account/author/     кабинет автора (articles, article-new, article-edit, article-stats,
                       stats-overview, review-history)
40-admin/              разделы админки (dashboard, categories, tags, articles, review-queue,
                       users, admins, statistics, subscriptions, payments-and-refunds,
                       complaints, ai-reviews, ranking-config, audit-log, media-library,
                       legal-texts, system-settings, …)
50-access/             роли (roles/*.md) и политики (visibility, permission-checks,
                       permission-exceptions, session-lifecycle, rate-limits,
                       escalation-and-demotion)
60-ranking/            рейтинг (article-score, author-score, views-counting, ai-review,
                       pro-score (бывший pro-boost), freshness-decay, topic-relevance, home-sections,
                       feed-principles, anti-fraud, explainability)
70-plans-and-billing/  планы и биллинг (plan-free, plan-standard, plan-pro,
                       subscription-lifecycle, role-derivation, payment-provider,
                       receipts-54fz, refunds, grants-and-promo)
80-observability/      logging-policy, error-dictionary, log-event-registry, request-tracing,
                       health-and-alerts, error-collector, audit-vs-logs, retention-and-pd
85-media-and-binary/   storage-layout, upload-pipeline, image-variants, avatars, article-covers,
                       exports, receipts-and-documents, retention-and-orphans, backups,
                       access-and-signed-urls
90-business-model/     overview, unit-economics, pricing-hypotheses, funnel, revenue-streams,
                       costs, metrics, risks, legal-152-54 — бизнес-модель: обзор, юнит-экономика, ценовые гипотезы, воронка,
                       потоки выручки, расходы, метрики, риски, 152-ФЗ и 54-ФЗ
95-blocks/             зарезервировано: каталог блоков конструктора — отдельный проход
```

Точный состав файлов в каждой папке задают реестры; список выше — ориентир, а не реестр.

## Имена файлов

Латиница, `kebab-case`, без даты (история — в git и в шапке файла). Заголовок первой строки —
русский. Файлы ролей — `50-access/roles/{guest,reader,author,editor,moderator,analyst,admin,owner}.md`.

## Как читать

Начинать с `00-registries/` — там видно, что существует, в каком статусе и где лежит. Затем
`50-access/` (кто что может), затем нужный контур. Открытые вопросы фазы — `OPEN-QUESTIONS.md`
(появляется при приёмке).

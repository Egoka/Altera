# Реестр маршрутов

- **Заход**: 1 (2026-09-06); **гейт Г1**: 2026-09-08 по журналу
  `docs/decisions/role-review-working-log-2026-09-08.md`. **Основание**:
  `docs/vision/06-design-system.md` §5, ADR-0004, ADR-0034, ADR-0035, ADR-0041; журнал §3–5,
  §12–16. Колонки — `README.md`.
- Состояния: З — загрузка, П — пусто, О — ошибка, Д — нет доступа, Н — не найдено/снято,
  Пл — ограничение плана, А — аккаунт в архиве, Pw — paywall (зарезервировано, ADR-0036).
- SEO: `index` / `noindex`; `c` — canonical; `h` — hreflang для опубликованных пар.
- Роли: все = посетитель и любой аккаунт; акк. = любой аккаунт; автор = активная подписка или
  выдача плана (журнал #5); служебные роли — по дефолтным наборам `roles.md`.

## Публичные

| # | Маршрут (ru / en) | Тип | Роли с доступом | Состояния | SEO | Файл спецификации | Этап | Статус |
|---|---|---|---|---|---|---|---|---|
| 1 | `/`, `/en` | public | все | З, П, О | index, c, h | `20-public/home.md` | 1 | утверждён |
| 2 | `/{рубрика}`, `/en/{section}` | public | все | З, П, О, Н | index, c, h | `20-public/section-feed.md` | 1 | утверждён |
| 3 | `/{рубрика}/{слаг}`, `/en/{section}/{slug}` | public | все (опубликованные версии) | З, О, Н (404 черновик, 410 снято или архив), Pw | index, c, h | `20-public/article.md` | 1 | утверждён |
| 4 | `/{рубрика}/{слаг}?preview=<token>` | public | автор версии, moderator, admin (чтение), owner | З, О, Д, Н | noindex | `20-public/article.md` §3 | 1 | утверждён |
| 5 | `/sections`, `/en/sections` | public | все | З, П, О | index, c, h | `20-public/sections-index.md` | 1 | утверждён |
| 6 | `/authors`, `/en/authors` | public | все | З, П, О | index, c, h | `20-public/authors-index.md` | 1 | утверждён |
| 7 | `/authors/{handle}`, `/en/authors/{handle}` | public | все | З, П, О, Н (301 по истории хэндлов) | index, c, h | `20-public/author.md` | 1 | утверждён |
| 8 | `/tags`, `/en/tags` | public | все | З, П, О | index, c, h | `20-public/tags-index.md` | 1 | утверждён |
| 9 | `/tags/{слаг}`, `/en/tags/{slug}` | public | все | З, П, О, Н | index, c, h | `20-public/tag-feed.md` | 1 | утверждён |
| 10 | `/search?q=`, `/en/search?q=` | public | все | З, П, О | noindex | `20-public/search.md` | 3 | утверждён |
| 11 | `/pricing`, `/en/pricing` | public | все | З, О, Пл (уже на плане) | index, c, h | `20-public/pricing.md` | 1 | утверждён |
| 12 | `/login`, `/en/login` | public | посетитель (аккаунт → редирект в `/me`) | З, О, лимит | noindex | `20-public/login.md` | 1 | утверждён |
| 13 | `/auth/verify?token=` | public | посетитель по ссылке | З, О, Н (ссылка), А (самостоятельный архив → `/me/archived`; административный → `/auth/appeal`) | noindex | `20-public/verify.md` | 1 | утверждён; Г2: оспаривание; Г3: экран состояния (журнал §5.2) |
| 14 | `/about`, `/en/about` | public | все | З, О | index, c, h | `20-public/about.md` | 1 | утверждён |
| 15 | `/contact`, `/en/contact` | public | все | З, О, лимит | index, c, h | `20-public/contact.md` | 1 | утверждён |
| 16 | `/legal/terms`, `/en/legal/terms` | public | все | З, О | index, c, h | `20-public/legal-terms.md` | 1 | утверждён |
| 17 | `/legal/privacy`, `/en/legal/privacy` | public | все | З, О | index, c, h | `20-public/legal-privacy.md` | 1 | утверждён |
| 18 | `/legal/content-rules`, `/en/legal/content-rules` | public | все | З, О | index, c, h | `20-public/legal-content-rules.md` | 1 | утверждён |
| 19 | `/legal/license`, `/en/legal/license` | public | все | З, О | index, c, h | `20-public/legal-license.md` | 1 | утверждён |
| 20 | `/legal/paid-services`, `/en/legal/paid-services` | public | все | З, О | index, c, h | `20-public/legal-paid-services.md` | 1 | утверждён |
| 21 | `/legal/refunds`, `/en/legal/refunds` | public | все | З, О | index, c, h | `20-public/legal-refunds.md` | 1 | утверждён |
| 22 | страница 404 | public | все | — | noindex | `20-public/not-found.md` | 1 | утверждён |
| 23 | страница 410 (снятый или архивированный материал) | public | все | — | noindex | `20-public/gone.md` | 1 | утверждён |
| 24 | страница 500 | public | все | — | noindex | `20-public/error.md` | 1 | утверждён |
| 25 | офлайн-страница | public | все | — | noindex | `20-public/offline.md` | 3 | утверждён |

## Кабинет

| # | Маршрут (ru / en) | Тип | Роли с доступом | Состояния | SEO | Файл спецификации | Этап | Статус |
|---|---|---|---|---|---|---|---|---|
| 26 | `/me` | account | акк. | З, О, Д (→ `/login`), Пл (истёк) | noindex | `30-account/reader/dashboard.md` | 1 | утверждён |
| 27 | `/me/settings` | account | акк. | З, О, Д | noindex | `30-account/reader/profile-edit.md` | 1 | утверждён |
| 28 | `/me/sessions` | account | акк. | З, П, О, Д | noindex | `30-account/reader/sessions.md` | 1 | утверждён |
| 29 | `/me/email`, `/me/email/confirm?token=` | account | акк. | З, О, Д, Н (ссылка) | noindex | `30-account/reader/email-change.md` | 1 | утверждён |
| 30 | `/me/bookmarks` | account | акк. | З, П, О, Д | noindex | `30-account/reader/bookmarks.md` | 1 | утверждён |
| 31 | `/me/subscription` | account | акк. | З, О, Д, Пл (все состояния; без льготного периода — журнал #20) | noindex | `30-account/reader/subscription.md` | 1 | утверждён |
| 32 | `/me/subscription/checkout?plan=&interval=&promo=` | account | акк. | З, О, Д, Пл (уже на плане) | noindex | `30-account/reader/checkout.md` | 1 | утверждён |
| 33 | `/me/subscription/result?payment=` | account | акк. | З (ожидание вебхука), О (отказ → план не включён), Д | noindex | `30-account/reader/checkout.md` §8 | 1 | утверждён |
| 34 | `/me/articles` (фильтры `?status=archived`, `?status=rejected`) | account | автор; бывший автор — чтение и архивирование; `editor` — свои | З, П, О, Д, Пл | noindex | `30-account/author/articles.md` | 1 | утверждён |
| 35 | `/me/articles/new` | account | автор, `editor` | З, О, Д, Пл (→ `/pricing`) | noindex | `30-account/author/article-new.md` | 1 | утверждён |
| 36 | `/me/articles/{id}/edit` | account | автор-владелец; `editor` — свои; только чтение при истёкшем плане и для отклонённой | З, О, Д, Н, Пл | noindex | `30-account/author/article-edit.md` | 1 | утверждён |
| 37 | `/me/articles/{id}/review` | account | автор-владелец | З, П (ещё не подавалась), О, Д, Н | noindex | `30-account/author/review-history.md` | 1 | утверждён |
| 38 | `/me/articles/{id}/stats` | account | автор-владелец (standard — сумма, pro — по дням) | З, П, О, Д, Н, Пл | noindex | `30-account/author/article-stats.md` | 2 | утверждён |
| 39 | `/me/export` | account | акк. (и при истёкшем плане) | З, О, Д | noindex | `30-account/reader/export.md` | 3 | утверждён |
| 40 | `/me/delete`, `/me/delete/confirm?token=` | account | акк. (= архивирование аккаунта) | З, О, Д, Н (ссылка), конфликт для последнего `owner` | noindex | `30-account/reader/delete-account.md` | 3 | утверждён |

## Админка

| # | Маршрут | Тип | Роли с доступом | Состояния | SEO | Файл спецификации | Этап | Статус |
|---|---|---|---|---|---|---|---|---|
| 41 | `/admin` | admin | все служебные роли — своя картина (журнал #38) | З, О, Д | noindex | `40-admin/dashboard.md` | 1 | утверждён |
| 42 | `/admin/sections`, `/admin/sections/{id}` | admin | admin, owner (журнал #29) | З, П, О, Д, Н | noindex | `40-admin/categories.md` | 1 | утверждён |
| 43 | `/admin/tags` | admin | admin, owner | З, П, О, Д | noindex | `40-admin/tags.md` | 1 | утверждён |
| 44 | `/admin/articles`, `/admin/articles/{translationId}` | admin | editor — свои; moderator; admin — чтение; owner | З, П, О, Д, Н | noindex | `40-admin/articles.md` | 1 | утверждён |
| 45 | `/admin/review`, `/admin/review/{translationId}` | admin | moderator, owner; admin — чтение | З, П, О, Д, Н | noindex | `40-admin/review-queue.md` | 1 | утверждён |
| 46 | `/admin/users`, `/admin/users/{id}` | admin | analyst (чтение с аудитом), admin, owner | З, П, О, Д, Н | noindex | `40-admin/users.md` | 1 | утверждён |
| 47 | `/admin/admins` | admin | owner; admin — чтение | З, П, О, Д | noindex | `40-admin/admins.md` | 1 | утверждён |
| 48 | `/admin/subscriptions`, `/admin/subscriptions/{id}` | admin | analyst, admin, owner | З, П, О, Д, Н | noindex | `40-admin/subscriptions.md` | 1 | утверждён |
| 49 | `/admin/payments`, `/admin/payments/{id}` | admin | analyst, admin, owner | З, П, О, Д, Н | noindex | `40-admin/payments-and-refunds.md` | 1 | утверждён |
| 50 | `/admin/grants` | admin | analyst, admin, owner | З, П, О, Д | noindex | `40-admin/grants-and-promo.md` | 1 | утверждён |
| 51 | `/admin/statistics` | admin | analyst, admin, owner | З, П, О, Д | noindex | `40-admin/statistics.md` | 1 | утверждён |
| 52 | `/admin/reports`, `/admin/reports/{id}` | admin | moderator, owner | З, П, О, Д, Н | noindex | `40-admin/complaints.md` | 1 | отложено: жалобы — отдельный разбор |
| 53 | `/admin/jobs` | admin | admin (чтение), owner | З, П, О, Д | noindex | `40-admin/jobs.md` | 1 | утверждён |
| 54 | `/admin/ai`, `/admin/ai/{id}` | admin | moderator (своя зона), admin (чтение), owner | З, П, О, Д, Н | noindex | `40-admin/ai-processes.md` | 1 | утверждён (перенесён с этапа 2, бывший `/admin/ai-reviews`) |
| 55 | `/admin/ranking` | admin | owner; analyst, admin — чтение | З, О, Д | noindex | `40-admin/ranking-config.md` | 2 | утверждён; параметры — Г4 |
| 56 | `/admin/audit` | admin | все служебные роли — своя зона; admin, owner — полный | З, П, О, Д | noindex | `40-admin/audit-log.md` | 1 | утверждён (перенесён с этапа 4, журнал #37) |
| 57 | `/admin/media`, `/admin/media/{id}` | admin | — | — | — | — | 4 | отменено: медиа привязано к статье (журнал #28) |
| 58 | `/admin/legal` | admin | owner; admin — чтение | З, П, О, Д | noindex | `40-admin/legal-texts.md` | 4 | утверждён |
| 59 | `/admin/newsletter`, `/admin/newsletter/{id}` | admin | — | — | — | `40-admin/newsletter.md` | 4 | отложено: правила рассылок — отдельный разбор |
| 60 | `/admin/settings` | admin | owner | З, О, Д | noindex | `40-admin/system-settings.md` | 4 | утверждён (настройки провайдеров — этап 4, журнал #36) |
| 70 | `/admin/mail`, `/admin/mail/{id}` | admin | admin (чтение), owner; editor, moderator — письма по своим статьям | З, П, О, Д, Н | noindex | `40-admin/mail.md` | 1 | утверждён (новый — журнал #34) |
| 71 | `/auth/appeal?token=`, `/en/auth/appeal?token=` | public | пользователь архивированного аккаунта по токену входа | З, О, Н (токен), лимит, конфликт (оспаривание уже подано) | noindex | `20-public/blocked-appeal.md` | 1 | утверждён (новый — Г2, журнал #48) |
| 72 | `/admin/errors`, `/admin/errors/{id}` | admin | admin (чтение), owner | З, П, О, Д, Н | noindex | `40-admin/errors-and-health.md` | 1 `[ДОПУЩЕНИЕ]` | утверждён (новый — Г3, журнал §20.19) |
| 73 | `/me/archived` | account | пользователь самостоятельно архивированного аккаунта (ограниченная сессия); остальным — редирект в `/me` | З, О, Д | noindex | `30-account/reader/archived-state.md` | 1 | утверждён (новый — Г3, журнал §5.2) |

## Инфраструктура и API

| # | Маршрут | Тип | Роли с доступом | Состояния | SEO | Файл спецификации | Этап | Статус |
|---|---|---|---|---|---|---|---|---|
| 61 | `/rss.xml`, `/en/rss.xml` | infra | все | О | — | `20-public/feeds-and-sitemap.md` | 3 | утверждён |
| 62 | `/sitemap.xml`, `/sitemap-{locale}.xml` | infra | все | О | — | `20-public/feeds-and-sitemap.md` | 3 | утверждён |
| 63 | `/robots.txt` | infra | все | — | — | `20-public/feeds-and-sitemap.md` | 1 | утверждён |
| 64 | `/health` (Nuxt) и `GET /health` (API) | infra | все (без данных) | О | — | `80-observability/health-and-alerts.md` | 0 | утверждён |
| 65 | `POST /api/graphql` (BFF-прокси Nuxt → API) | infra | по роли запроса | — | — | `50-access/permission-checks.md` | 0 | утверждён |
| 66 | `POST /api/webhooks/psp/{provider}` (API) | infra | провайдер по подписи | О (подпись), Д | — | `70-plans-and-billing/payment-provider.md` | 1 | утверждён |
| 67 | `POST /api/read` (маяк прочтения) | infra | все | О, лимит | — | `60-ranking/views-counting.md` | 2 | утверждён |
| 68 | `/me/articles/{id}/edit?token=` (ссылка из письма о снятии на доработку) | infra | автор по ссылке | Н | noindex | `30-account/author/article-edit.md` §3 | 1 | утверждён |

## Только в dev

| # | Маршрут | Тип | Роли с доступом | Состояния | SEO | Файл спецификации | Этап | Статус |
|---|---|---|---|---|---|---|---|---|
| 69 | `/fonts-showcase`, `/components-showcase`, `/test-error` | dev | разработчик | — | недоступны в prod | `docs/vision/06-design-system.md` §11 | 0 | утверждён |

## Правила

- Русские адреса без префикса, английские под `/en` (ADR-0002, ADR-0004); кабинет и админка
  без языкового префикса, язык интерфейса — из профиля.
- Смена рубрики или слага — 301 по истории (ADR-0004); снятый или архивированный материал —
  410, черновик посетителю — 404 (без утечки существования).
- Все `account` и `admin` маршруты — `noindex` и вне `sitemap.xml`.
- Изменения Г1: #54 `/admin/ai` — этап 1; #56 `/admin/audit` — этап 1; #57 отменён;
  #52, #59 — отложены; #70 `/admin/mail` — новый; #37 — файл `review-history.md`.

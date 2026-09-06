# Реестр маршрутов

- **Заход**: 1 (2026-09-06). **Основание**: `docs/vision/06-design-system.md` §5, ADR-0004,
  ADR-0034, ADR-0035, ADR-0041, ADR-0042. Колонки — `README.md`.
- Состояния: З — загрузка, П — пусто, О — ошибка, Д — нет доступа, Н — не найдено/снято,
  Пл — ограничение плана, Б — заблокирован, Pw — paywall (зарезервировано, ADR-0036).
- SEO: `index` / `noindex`; `c` — canonical; `h` — hreflang для опубликованных пар.
- Роли: все = посетитель и любой аккаунт; акк. = любой аккаунт; автор = активная подписка или
  грант (ADR-0044); admin-роли по `04-roles-and-access.md` §1.

## Публичные

| # | Маршрут (ru / en) | Тип | Роли с доступом | Состояния | SEO | Файл спецификации | Этап | Статус |
|---|---|---|---|---|---|---|---|---|
| 1 | `/`, `/en` | public | все | З, П, О | index, c, h | `20-public/home.md` | 1 | на утверждении |
| 2 | `/{рубрика}`, `/en/{section}` | public | все | З, П, О, Н | index, c, h | `20-public/section-feed.md` | 1 | на утверждении |
| 3 | `/{рубрика}/{слаг}`, `/en/{section}/{slug}` | public | все (опубликованные версии) | З, О, Н (404 черновик, 410 снято), Pw | index, c, h | `20-public/article.md` | 1 | на утверждении |
| 4 | `/{рубрика}/{слаг}?preview=<token>` | public | автор версии, editor+ | З, О, Д, Н | noindex | `20-public/article.md` §3 | 1 | на утверждении |
| 5 | `/sections`, `/en/sections` | public | все | З, П, О | index, c, h | `20-public/sections-index.md` | 1 | на утверждении |
| 6 | `/authors`, `/en/authors` | public | все | З, П, О | index, c, h | `20-public/authors-index.md` | 1 | на утверждении |
| 7 | `/authors/{handle}`, `/en/authors/{handle}` | public | все | З, П, О, Н (301 по истории хэндлов) | index, c, h | `20-public/author.md` | 1 | на утверждении |
| 8 | `/tags`, `/en/tags` | public | все | З, П, О | index, c, h | `20-public/tags-index.md` | 1 | на утверждении |
| 9 | `/tags/{слаг}`, `/en/tags/{slug}` | public | все | З, П, О, Н | index, c, h | `20-public/tag-feed.md` | 1 | на утверждении |
| 10 | `/search?q=`, `/en/search?q=` | public | все | З, П, О | noindex | `20-public/search.md` | 3 | на утверждении |
| 11 | `/pricing`, `/en/pricing` | public | все | З, О, Пл (уже на плане) | index, c, h | `20-public/pricing.md` | 1 | на утверждении |
| 12 | `/login`, `/en/login` | public | посетитель (аккаунт → редирект в `/me`) | З, О, Б (лимит) | noindex | `20-public/login.md` | 1 | на утверждении |
| 13 | `/auth/verify?token=` | public | посетитель по ссылке | З, О, Н (ссылка недействительна) | noindex | `20-public/verify.md` | 1 | на утверждении |
| 14 | `/about`, `/en/about` | public | все | З, О | index, c, h | `20-public/about.md` | 1 | на утверждении |
| 15 | `/contact`, `/en/contact` | public | все | З, О, Б (лимит) | index, c, h | `20-public/contact.md` | 1 | на утверждении |
| 16 | `/legal/terms`, `/en/legal/terms` | public | все | З, О | index, c, h | `20-public/legal-terms.md` | 1 | на утверждении |
| 17 | `/legal/privacy`, `/en/legal/privacy` | public | все | З, О | index, c, h | `20-public/legal-privacy.md` | 1 | на утверждении |
| 18 | `/legal/content-rules`, `/en/legal/content-rules` | public | все | З, О | index, c, h | `20-public/legal-content-rules.md` | 1 | на утверждении |
| 19 | `/legal/license`, `/en/legal/license` | public | все | З, О | index, c, h | `20-public/legal-license.md` | 1 | на утверждении |
| 20 | `/legal/paid-services`, `/en/legal/paid-services` | public | все | З, О | index, c, h | `20-public/legal-paid-services.md` | 1 | на утверждении |
| 21 | `/legal/refunds`, `/en/legal/refunds` | public | все | З, О | index, c, h | `20-public/legal-refunds.md` | 1 | на утверждении |
| 22 | страница 404 (любой несуществующий адрес) | public | все | — | noindex | `20-public/not-found.md` | 1 | на утверждении |
| 23 | страница 410 (снятый или архивированный материал) | public | все | — | noindex | `20-public/gone.md` | 1 | на утверждении |
| 24 | страница 500 (ошибка сервера, с идентификатором запроса) | public | все | — | noindex | `20-public/error.md` | 1 | на утверждении |
| 25 | офлайн-страница (нет сети, service worker) | public | все | — | noindex | `20-public/offline.md` | 3 | на утверждении |

## Кабинет

| # | Маршрут (ru / en) | Тип | Роли с доступом | Состояния | SEO | Файл спецификации | Этап | Статус |
|---|---|---|---|---|---|---|---|---|
| 26 | `/me` | account | акк. | З, О, Д (→ `/login`), Пл (истекла), Б | noindex | `30-account/reader/dashboard.md` | 1 | на утверждении |
| 27 | `/me/settings` | account | акк. | З, О, Д, Б | noindex | `30-account/reader/profile-edit.md` | 1 | на утверждении |
| 28 | `/me/sessions` | account | акк. | З, П, О, Д | noindex | `30-account/reader/sessions.md` | 1 | на утверждении |
| 29 | `/me/email`, `/me/email/confirm?token=` | account | акк. | З, О, Д, Н (ссылка) | noindex | `30-account/reader/email-change.md` | 1 | на утверждении |
| 30 | `/me/bookmarks` | account | акк. | З, П, О, Д | noindex | `30-account/reader/bookmarks.md` | 1 | на утверждении |
| 31 | `/me/subscription` | account | акк. | З, О, Д, Пл (все состояния подписки) | noindex | `30-account/reader/subscription.md` | 1 | на утверждении |
| 32 | `/me/subscription/checkout?plan=&interval=&promo=` | account | акк. | З, О, Д, Пл (уже на плане) | noindex | `30-account/reader/checkout.md` | 1 | на утверждении |
| 33 | `/me/subscription/result?payment=` | account | акк. | З (ожидание вебхука), О (отказ), Д | noindex | `30-account/reader/checkout.md` §8 | 1 | на утверждении |
| 34 | `/me/articles` | account | автор; бывший автор — только чтение и экспорт | З, П, О, Д, Пл | noindex | `30-account/author/articles.md` | 1 | на утверждении |
| 35 | `/me/articles/new` | account | автор | З, О, Д, Пл (→ `/pricing`) | noindex | `30-account/author/article-new.md` | 1 | на утверждении |
| 36 | `/me/articles/{id}/edit` | account | автор-владелец; editor+ в `review` | З, О, Д, Н, Пл (только чтение) | noindex | `30-account/author/article-edit.md` | 1 | на утверждении |
| 37 | `/me/articles/{id}/review` | account | автор-владелец | З, П (ещё не отправлялась), О, Д, Н | noindex | `30-account/author/ai-review-view.md` | 1 | на утверждении |
| 38 | `/me/articles/{id}/stats` | account | автор-владелец (standard — сумма, pro — по дням) | З, П, О, Д, Н, Пл | noindex | `30-account/author/article-stats.md` | 2 | на утверждении |
| 39 | `/me/export` | account | акк. (и после истечения подписки) | З, О, Д | noindex | `30-account/reader/export.md` | 3 | на утверждении |
| 40 | `/me/delete`, `/me/delete/confirm?token=` | account | акк. | З, О, Д, Н (ссылка) | noindex | `30-account/reader/delete-account.md` | 3 | на утверждении |

## Админка

| # | Маршрут | Тип | Роли с доступом | Состояния | SEO | Файл спецификации | Этап | Статус |
|---|---|---|---|---|---|---|---|---|
| 41 | `/admin` | admin | editor, moderator, analyst, admin, owner | З, О, Д | noindex | `40-admin/dashboard.md` | 1 | на утверждении |
| 42 | `/admin/sections`, `/admin/sections/{id}` | admin | editor+ (analyst — нет) | З, П, О, Д, Н | noindex | `40-admin/categories.md` | 1 | на утверждении |
| 43 | `/admin/tags` | admin | editor+, moderator | З, П, О, Д | noindex | `40-admin/tags.md` | 1 | на утверждении |
| 44 | `/admin/articles`, `/admin/articles/{translationId}` | admin | editor, moderator, admin, owner | З, П, О, Д, Н | noindex | `40-admin/articles.md` | 1 | на утверждении |
| 45 | `/admin/review`, `/admin/review/{translationId}` | admin | moderator, admin, owner; editor — правка | З, П, О, Д, Н | noindex | `40-admin/review-queue.md` | 1 | на утверждении |
| 46 | `/admin/users`, `/admin/users/{id}` | admin | moderator (без e-mail), admin, owner | З, П, О, Д, Н | noindex | `40-admin/users.md` | 1 | на утверждении |
| 47 | `/admin/admins` | admin | admin, owner | З, П, О, Д | noindex | `40-admin/admins.md` | 1 | на утверждении |
| 48 | `/admin/subscriptions`, `/admin/subscriptions/{id}` | admin | admin, owner; analyst — агрегаты | З, П, О, Д, Н | noindex | `40-admin/subscriptions.md` | 1 | на утверждении |
| 49 | `/admin/payments`, `/admin/payments/{id}` | admin | admin, owner | З, П, О, Д, Н | noindex | `40-admin/payments-and-refunds.md` | 1 | на утверждении |
| 50 | `/admin/grants` | admin | admin, owner | З, П, О, Д | noindex | `40-admin/grants-and-promo.md` | 1 | на утверждении |
| 51 | `/admin/statistics` | admin | analyst, moderator, admin, owner | З, П, О, Д | noindex | `40-admin/statistics.md` | 1 | на утверждении |
| 52 | `/admin/reports`, `/admin/reports/{id}` | admin | moderator, admin, owner | З, П, О, Д, Н | noindex | `40-admin/complaints.md` | 1 | на утверждении |
| 53 | `/admin/jobs` | admin | admin, owner | З, П, О, Д | noindex | `40-admin/jobs.md` | 1 | на утверждении |
| 54 | `/admin/ai-reviews`, `/admin/ai-reviews/{id}` | admin | moderator, admin, owner; analyst — агрегаты | З, П, О, Д, Н | noindex | `40-admin/ai-reviews.md` | 2 | на утверждении |
| 55 | `/admin/ranking` | admin | admin, owner; analyst — чтение | З, О, Д | noindex | `40-admin/ranking-config.md` | 2 | на утверждении |
| 56 | `/admin/audit` | admin | moderator, admin, owner | З, П, О, Д | noindex | `40-admin/audit-log.md` | 4 | на утверждении |
| 57 | `/admin/media`, `/admin/media/{id}` | admin | editor, moderator, admin, owner | З, П, О, Д, Н | noindex | `40-admin/media-library.md` | 4 | на утверждении |
| 58 | `/admin/legal` | admin | admin, owner | З, П, О, Д | noindex | `40-admin/legal-texts.md` | 4 | на утверждении |
| 59 | `/admin/newsletter`, `/admin/newsletter/{id}` | admin | editor, admin, owner | З, П, О, Д, Н | noindex | `40-admin/newsletter.md` | 4 | на утверждении |
| 60 | `/admin/settings` | admin | owner | З, О, Д | noindex | `40-admin/system-settings.md` | 4 | на утверждении |

## Инфраструктура и API

| # | Маршрут | Тип | Роли с доступом | Состояния | SEO | Файл спецификации | Этап | Статус |
|---|---|---|---|---|---|---|---|---|
| 61 | `/rss.xml`, `/en/rss.xml` | infra | все | О | — | `20-public/feeds-and-sitemap.md` | 3 | на утверждении |
| 62 | `/sitemap.xml`, `/sitemap-{locale}.xml` | infra | все | О | — | `20-public/feeds-and-sitemap.md` | 3 | на утверждении |
| 63 | `/robots.txt` | infra | все | — | — | `20-public/feeds-and-sitemap.md` | 1 | на утверждении |
| 64 | `/health` (Nuxt) и `GET /health` (API) | infra | все (без данных) | О | — | `80-observability/health-and-alerts.md` | 0 | на утверждении |
| 65 | `POST /api/graphql` (BFF-прокси Nuxt → API) | infra | по роли запроса | — | — | `50-access/permission-checks.md` | 0 | на утверждении |
| 66 | `POST /api/webhooks/psp/{provider}` (API) | infra | провайдер по подписи | О (подпись), Д | — | `70-plans-and-billing/payment-provider.md` | 1 | на утверждении |
| 67 | `POST /api/read` (маяк прочтения) | infra | все | О, Б (лимит) | — | `60-ranking/views-counting.md` | 2 | на утверждении |
| 68 | `/me/articles/{id}/edit?token=` (короткоживущая ссылка из письма «вернуть на доработку») | infra | автор по ссылке | Н | noindex | `30-account/author/article-edit.md` §3 | 1 | на утверждении |

## Только в dev

| # | Маршрут | Тип | Роли с доступом | Состояния | SEO | Файл спецификации | Этап | Статус |
|---|---|---|---|---|---|---|---|---|
| 69 | `/fonts-showcase`, `/components-showcase`, `/test-error` | dev | разработчик | — | недоступны в prod | `docs/vision/06-design-system.md` §11 | 0 | на утверждении |

## Правила

- Русские адреса без префикса, английские под `/en` (ADR-0002, ADR-0004); кабинет и админка
  без языкового префикса, язык интерфейса — из профиля.
- Смена рубрики или слага — 301 по истории (ADR-0004); снятый материал — 410, черновик
  посетителю — 404 (без утечки существования).
- Все `account` и `admin` маршруты — `noindex` и вне `sitemap.xml`.
- Предложено сверх карты `06-design-system.md` §5: `/me/export`, `/me/delete` (были в
  ревизии 1 как функции), `/admin/grants`, `/admin/jobs`, `/admin/newsletter`, маяк `/api/read`,
  вебхук провайдера, ссылка возврата на доработку (#68) — обоснование в отчёте захода.

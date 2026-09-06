# Реестр событий, логов и ошибок

- **Заход**: 1 (2026-09-06) — скелет; заходы 2–9 дополняют, 8b закрывает. **Основание**:
  ADR-0032 (словарь ошибок, pino, `audit_log`), ADR-0027 и ADR-0038 (прочтения),
  `docs/vision/04-roles-and-access.md` §5 (аудит), ADR-0039, ADR-0040, ADR-0045. Колонки —
  `README.md`.
- Тип: `error` — код ошибки API; `audit` — запись `audit_log`; `log` — структурированная запись
  pino; `metric` — счётчик или событие для статистики (без ПДн, без привязки к пользователю там,
  где указано).
- Префиксы кодов по подсистемам: `auth.`, `session.`, `user.`, `plan.`, `subscription.`,
  `payment.`, `webhook.`, `article.`, `translation.`, `revision.`, `media.`, `ai.`, `ranking.`,
  `read.`, `boost.`, `bookmark.`, `follow.`, `report.`, `tag.`, `section.`, `admin.`, `job.`,
  `newsletter.`, `legal.`, `settings.`, `system.`. Код — нижний регистр, точки, без ПДн в
  значениях.
- Ретенция: аудит — бессрочно; логи — 30 дней у хостинга; события прочтений — 8 дней, агрегаты —
  бессрочно; метрики — бессрочно в агрегатах.

## Ошибки API (словарь ADR-0032)

| # | Код события | Тип | Уровень | Источник | Кто инициирует | Поля (без ПДн) | Ретенция | Где смотреть | Файл |
|---|---|---|---|---|---|---|---|---|---|
| 1 | `UNAUTHENTICATED` | error | — | api | любой | `requestId` | — | ответ клиенту | `80-observability/error-dictionary.md` |
| 2 | `FORBIDDEN` | error | — | api | любой | `requestId`, `action` | — | ответ клиенту | `80-observability/error-dictionary.md` |
| 3 | `NOT_FOUND` | error | — | api | любой | `requestId`, `entity` | — | ответ клиенту | `80-observability/error-dictionary.md` |
| 4 | `VALIDATION_ERROR` | error | — | api | любой | `requestId`, `field`, `rule` | — | ответ клиенту | `80-observability/error-dictionary.md` |
| 5 | `CONFLICT` | error | — | api | любой | `requestId`, `entity`, `expected`, `actual` | — | ответ клиенту | `80-observability/error-dictionary.md` |
| 6 | `RATE_LIMITED` | error | — | api | любой | `requestId`, `retryAfter` | — | ответ клиенту | `50-access/rate-limits.md` |
| 7 | `CONTENT_INVALID` | error | — | api | автор | `requestId`, `path`, `node` | — | ответ клиенту | `80-observability/error-dictionary.md` |
| 8 | `DUPLICATE` | error | — | api | любой | `requestId`, `entity`, `field` | — | ответ клиенту | `80-observability/error-dictionary.md` |
| 9 | `INTERNAL_ERROR` | error | error | api | система | `requestId` (детали — только в логе) | — | ответ клиенту + сборщик ошибок | `80-observability/error-collector.md` |
| 10 | `PLAN_LIMIT` **(новый)** | error | — | api | автор | `requestId`, `requiredTier`, `limit`, `current` | — | ответ клиенту | `80-observability/error-dictionary.md` |
| 11 | `PROVIDER_UNAVAILABLE` **(новый)** | error | warn | api | система | `requestId`, `provider` (psp / ai / mail) | — | ответ клиенту + алерт | `80-observability/error-dictionary.md` |

## Аудит (`audit_log`, бессрочно, `04-roles-and-access.md` §5)

| # | Код события | Тип | Уровень | Источник | Кто инициирует | Поля (без ПДн) | Ретенция | Где смотреть | Файл |
|---|---|---|---|---|---|---|---|---|---|
| 12 | `user.role.change` | audit | — | api | admin, owner | `targetId`, `before`, `after` | бессрочно | `/admin/audit` (4) | `40-admin/admins.md` |
| 13 | `owner.transfer` | audit | — | api | owner | `from`, `to` | бессрочно | `/admin/audit` | `10-flows/appoint-admin.md` |
| 14 | `user.block` / `user.unblock` | audit | — | api | moderator+ | `targetId`, `reason` | бессрочно | `/admin/audit` | `10-flows/block-user.md` |
| 15 | `user.sessions.revoke` | audit | — | api | moderator+ | `targetId`, `count` | бессрочно | `/admin/audit` | `50-access/session-lifecycle.md` |
| 16 | `user.delete` | audit | — | api | сам / admin | `targetId`, `mode` (архив / оставить) | бессрочно | `/admin/audit` | `10-flows/delete-account.md` |
| 17 | `user.email.change` | audit | — | api | сам / admin | `targetId`, `via` (self / recovery) | бессрочно | `/admin/audit` | `10-flows/email-change-and-recovery.md` |
| 18 | `plan.grant` / `plan.revoke` | audit | — | api | admin+ | `targetId`, `tier`, `until`, `reason` | бессрочно | `/admin/audit` | `70-plans-and-billing/grants-and-promo.md` |
| 19 | `plan.update` | audit | — | api | admin+ | `planId`, `diff` | бессрочно | `/admin/audit` | `40-admin/subscriptions.md` |
| 20 | `subscription.cancel` / `subscription.change` (админом) | audit | — | api | admin+ | `subscriptionId`, `reason` | бессрочно | `/admin/audit` | `40-admin/subscriptions.md` |
| 21 | `payment.refund` | audit | — | api | admin+ | `paymentId`, `amountMinor`, `reason` | бессрочно | `/admin/audit` | `70-plans-and-billing/refunds.md` |
| 22 | `promo.create` / `promo.disable` | audit | — | api | admin+ | `promoId` | бессрочно | `/admin/audit` | `70-plans-and-billing/grants-and-promo.md` |
| 23 | `webhook.replay` | audit | — | api | admin+ | `eventId` | бессрочно | `/admin/audit` | `70-plans-and-billing/payment-provider.md` |
| 24 | `translation.approve` / `translation.reject` | audit | — | api | moderator+ | `translationId`, `revisionId`, `reason` | бессрочно | `/admin/audit`; автору — история | `10-flows/moderation.md` |
| 25 | `translation.unpublish` | audit | — | api | moderator+ | `translationId`, `reason`, `toDraft` | бессрочно | `/admin/audit` | `40-admin/articles.md` |
| 26 | `translation.status.set` | audit | — | api | admin+ | `translationId`, `before`, `after`, `reason` | бессрочно | `/admin/audit` | `40-admin/articles.md` |
| 27 | `article.delete` / `article.taxonomy.change` | audit | — | api | editor+ | `articleId`, `diff` | бессрочно | `/admin/audit` | `40-admin/articles.md` |
| 28 | `revision.restore` (не автором) | audit | — | api | editor+ | `translationId`, `fromRevisionId` | бессрочно | `/admin/audit` | `50-access/permission-checks.md` |
| 29 | `ai.score.override` | audit | — | api | moderator+ | `reviewId`, `before`, `after`, `reason` | бессрочно | `/admin/audit` | `40-admin/ai-reviews.md` |
| 30 | `ai.review.rerun` | audit | — | api | moderator+ | `translationId`, `costMinor` | бессрочно | `/admin/audit` | `40-admin/ai-reviews.md` |
| 31 | `ranking.config.change` / `ranking.recompute` | audit | — | api | admin+ | `version`, `diff` | бессрочно | `/admin/audit` | `40-admin/ranking-config.md` |
| 32 | `reads.exclude` / `boost.end` | audit | — | api | moderator+ | `articleId`, `days` / `boostId`, `reason` | бессрочно | `/admin/audit` | `60-ranking/anti-fraud.md` |
| 33 | `report.resolve` | audit | — | api | moderator+ | `reportId`, `resolution` | бессрочно | `/admin/audit` | `10-flows/complaint.md` |
| 34 | `media.hide` / `media.replace` / `media.delete` | audit | — | api | moderator+ / editor+ / admin+ | `assetId`, `reason` | бессрочно | `/admin/audit` | `40-admin/media-library.md` |
| 35 | `section.update` / `section.archive` / `format.update` / `tag.merge` / `tag.delete` | audit | — | api | editor+ | `id`, `diff` | бессрочно | `/admin/audit` | `40-admin/categories.md`, `40-admin/tags.md` |
| 36 | `job.retry` / `job.cancel` | audit | — | api | admin+ | `jobId`, `kind` | бессрочно | `/admin/audit` | `40-admin/jobs.md` |
| 37 | `legal.update` | audit | — | api | admin+ | `kind`, `version` | бессрочно | `/admin/audit` | `40-admin/legal-texts.md` |
| 38 | `newsletter.send` | audit | — | api | editor+ | `issueId`, `recipientCount` | бессрочно | `/admin/audit` | `40-admin/newsletter.md` |
| 39 | `settings.change` / `secrets.rotate` | audit | — | api | owner | `key` (без значения) | бессрочно | `/admin/audit` | `40-admin/system-settings.md` |
| 40 | `stats.export` | audit | — | api | analyst+ | `report`, `rows` | бессрочно | `/admin/audit` | `40-admin/statistics.md` |

## Логи (pino, 30 дней)

| # | Код события | Тип | Уровень | Источник | Кто инициирует | Поля (без ПДн) | Ретенция | Где смотреть | Файл |
|---|---|---|---|---|---|---|---|---|---|
| 41 | `http.request` | log | info | api, web | любой | `requestId`, `method`, `operation`, `status`, `durationMs`, `role` | 30 дней | логи хостинга | `80-observability/request-tracing.md` |
| 42 | `auth.link.requested` / `auth.login` / `auth.login.failed` | log | info / warn | api | посетитель | `requestId`, `emailHash`, `reason` | 30 дней | логи | `50-access/session-lifecycle.md` |
| 43 | `session.refresh` / `session.revoked` / `session.reuse_detected` | log | info / warn | api | пользователь / система | `sessionId`, `userId` | 30 дней | логи; алерт на reuse | `50-access/session-lifecycle.md` |
| 44 | `rate_limit.hit` | log | warn | api | любой | `bucket`, `ipHash` | 30 дней | логи | `50-access/rate-limits.md` |
| 45 | `translation.submit` / `translation.withdraw` / `translation.appeal` | log | info | api | автор | `translationId`, `revisionId` | 30 дней | логи; автору — история | `10-flows/write-and-publish.md` |
| 46 | `ai.review.queued` / `ai.review.done` / `ai.review.failed` | log | info / error | api worker | система | `translationId`, `verdict`, `score`, `model`, `promptVersion`, `costMinor`, `durationMs` | 30 дней | логи; `/admin/jobs` | `60-ranking/ai-review.md` |
| 47 | `ai.translate.queued` / `.done` / `.failed` (3) | log | info / error | api worker | pro-автор | `jobId`, `costMinor` | 30 дней | логи; `/admin/jobs` | `10-flows/translate-with-ai.md` |
| 48 | `ranking.recompute.started` / `.done` | log | info | api worker | система / admin | `configVersion`, `articles`, `durationMs` | 30 дней | логи | `60-ranking/recompute.md` |
| 49 | `webhook.received` / `webhook.processed` / `webhook.failed` | log | info / error | api | провайдер | `provider`, `eventId`, `type` | 30 дней | логи; `/admin/payments` | `70-plans-and-billing/payment-provider.md` |
| 50 | `subscription.activated` / `.past_due` / `.expired` / `.renewed` | log | info | api worker | система | `subscriptionId`, `tier` | 30 дней | логи; `/admin/subscriptions` | `70-plans-and-billing/subscription-lifecycle.md` |
| 51 | `mail.sent` / `mail.failed` | log | info / error | api | система | `template`, `messageId` | 30 дней | логи | `80-observability/logging-policy.md` |
| 52 | `job.failed` / `job.stuck` | log | error / warn | api worker | система | `jobId`, `kind`, `attempts`, `ageSec` | 30 дней | логи; алерт | `80-observability/health-and-alerts.md` |
| 53 | `system.health` | log | info | api, web | внешняя проверка | `db`, `redis`, `psp`, `ai`, `mail` | 30 дней | `/health` | `80-observability/health-and-alerts.md` |
| 54 | `error.unhandled` | log | error | api, web | система | `requestId`, стек (без ПДн) | 30 дней | сборщик ошибок | `80-observability/error-collector.md` |

## Метрики и продуктовые события (без ПДн)

| # | Код события | Тип | Уровень | Источник | Кто инициирует | Поля (без ПДн) | Ретенция | Где смотреть | Файл |
|---|---|---|---|---|---|---|---|---|---|
| 55 | `read` | metric | — | api | посетитель | `articleId`, `day`, `visitorHash` (соль дня) | события 8 дней, агрегаты бессрочно | статистика; рейтинг | `60-ranking/views-counting.md` |
| 56 | `bookmark.add` / `bookmark.remove` | metric | — | api | аккаунт | `articleId` (без userId в метрике) | агрегаты | статистика | `30-account/reader/bookmarks.md` |
| 57 | `follow.add` / `follow.remove` (3) | metric | — | api | аккаунт | `authorId` | агрегаты | статистика | `10-flows/bookmark-and-follow.md` |
| 58 | `search.query` / `search.zero_results` (3) | metric | — | api | любой | `queryHash`, `locale`, `filters` | агрегаты | статистика | `20-public/search.md` |
| 59 | `checkout.started` / `checkout.succeeded` / `checkout.failed` | metric | — | api | аккаунт | `tier`, `interval`, `promo` (да/нет) | агрегаты | статистика | `70-plans-and-billing/subscription-lifecycle.md` |
| 60 | `registration` / `author.profile.completed` | metric | — | api | пользователь | `day` | агрегаты | статистика (воронка) | `40-admin/statistics.md` |
| 61 | `translation.published` | metric | — | api | ревьюер | `articleId`, `locale`, `daysToDecision` | агрегаты | статистика | `40-admin/statistics.md` |
| 62 | `boost.start` / `boost.end` | metric | — | api | система | `articleId` | агрегаты | статистика | `60-ranking/pro-boost.md` |
| 63 | `report.created` | metric | — | api | любой | `reason` | агрегаты | статистика | `40-admin/complaints.md` |
| 64 | `page.error` (фронт) | metric | — | web | любой | `route`, `code`, `requestId` | 30 дней | сборщик ошибок | `80-observability/error-collector.md` |

## Правила

- Новые коды добавляются в этот реестр заходами 2–9 в статусе «черновик» и закрываются в
  заходе 8b; коды ошибок — только через `80-observability/error-dictionary.md`.
- В полях событий никогда нет e-mail, имени, IP, текста статьи; допустимы идентификаторы и
  хэши с солью.
- Метрики не привязываются к пользователю (`userId` в метриках нет); аудит и логи — привязываются
  по идентификатору.

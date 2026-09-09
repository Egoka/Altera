# Реестр событий, логов и ошибок

- **Заход**: 1 (2026-09-06) — скелет; **гейт Г1**: 2026-09-08 по журналу
  `docs/decisions/role-review-working-log-2026-09-08.md`. Заходы 2–9 дополняют, 8b закрывает.
  **Основание**: ADR-0032 (словарь ошибок, pino, `audit_log`), ADR-0027 (прочтения); журнал
  #1, #6, #14, #16, #19, #26–27, #34, #37, #39, #42–43. Колонки — `README.md`.
- Тип: `error` — код ошибки API; `audit` — запись `audit_log`; `log` — структурированная запись
  pino; `metric` — счётчик или событие для статистики (без ПДн).
- Префиксы кодов по подсистемам: `auth.`, `session.`, `user.`, `admin.`, `plan.`,
  `subscription.`, `payment.`, `webhook.`, `article.`, `translation.`, `review.`, `revision.`,
  `media.`, `ai.`, `mail.`, `ranking.`, `engagement.`, `article.`, `author.`, `bookmark.`, `follow.`, `report.`,
  `tag.`, `section.`, `role.`, `permission.`, `entity.`, `job.`, `newsletter.`, `legal.`,
  `settings.`, `system.`. Код — нижний регистр, точки, без ПДн в значениях.
- Аудит (журнал #6): любое чтение персональных данных через административные инструменты —
  запись с актором, временем, чьими данными, контекстом; любое административное изменение —
  сущность, изменивший, время, конкретные поля и значения до/после. Аудит доступен в
  интерфейсе с этапа 1 (журнал #37); служебная роль видит свою зону, `admin` и `owner` — всё
  (журнал #39).
- Ретенция: аудит — бессрочно; логи — 30 дней у хостинга; события прочтений — 8 дней, агрегаты
  — бессрочно; ошибочные записи не удаляются, а помечаются (журнал #26).

## Ошибки API (словарь ADR-0032)

| # | Код события | Тип | Уровень | Источник | Кто инициирует | Поля (без ПДн) | Ретенция | Где смотреть | Файл | Статус |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | `UNAUTHENTICATED` | error | — | api | любой | `requestId` | — | ответ клиенту | `80-observability/error-dictionary.md` | утверждён |
| 2 | `FORBIDDEN` | error | — | api | любой | `requestId`, `action` | — | ответ клиенту | `80-observability/error-dictionary.md` | утверждён |
| 3 | `NOT_FOUND` | error | — | api | любой | `requestId`, `entity` | — | ответ клиенту | `80-observability/error-dictionary.md` | утверждён |
| 4 | `VALIDATION_ERROR` | error | — | api | любой | `requestId`, `field`, `rule` | — | ответ клиенту | `80-observability/error-dictionary.md` | утверждён |
| 5 | `CONFLICT` | error | — | api | любой | `requestId`, `entity`, `expected`, `actual` | — | ответ клиенту | `80-observability/error-dictionary.md` | утверждён |
| 6 | `RATE_LIMITED` | error | — | api | любой | `requestId`, `retryAfter` | — | ответ клиенту | `50-access/rate-limits.md` | утверждён |
| 7 | `CONTENT_INVALID` | error | — | api | автор | `requestId`, `path`, `node` | — | ответ клиенту | `80-observability/error-dictionary.md` | утверждён |
| 8 | `DUPLICATE` | error | — | api | любой | `requestId`, `entity`, `field` | — | ответ клиенту | `80-observability/error-dictionary.md` | утверждён |
| 9 | `INTERNAL_ERROR` | error | error | api | система | `requestId` | — | ответ клиенту + сборщик ошибок | `80-observability/error-collector.md` | утверждён |
| 10 | `PLAN_LIMIT` | error | — | api | автор | `requestId`, `requiredTier`, `limit`, `current` | — | ответ клиенту | `80-observability/error-dictionary.md` | утверждён |
| 11 | `PROVIDER_UNAVAILABLE` | error | warn | api | система | `requestId`, `provider` (psp / ai / mail) | — | ответ клиенту + алерт | `80-observability/error-dictionary.md` | утверждён |

## Аудит (`audit_log`, бессрочно)

| # | Код события | Тип | Уровень | Источник | Кто инициирует | Поля (без ПДн) | Ретенция | Где смотреть | Файл | Статус |
|---|---|---|---|---|---|---|---|---|---|---|
| 12 | `user.role.change` | audit | — | api | owner (журнал #7) | `targetId`, `before`, `after` | бессрочно | `/admin/audit` | `40-admin/admins.md` | утверждён |
| 13 | `owner.transfer` | audit | — | — | — | — | — | — | — | отменено: заменено `role.assign.owner` / `role.revoke.owner` (#65) (журнал #10) |
| 14 | `user.archive` / `user.restore` | audit | — | api | admin, owner | `targetId`, `reason`, `cascadeArticles`, `mode` (admin / emergency — журнал #48), `planUntil` на момент архива (срок продолжается — журнал #48, #50) | бессрочно | `/admin/audit` | `10-flows/archive-account.md` | утверждён (бывшие `user.block` / `user.unblock` — блокировка = архив, журнал #30; Г2: `mode`, план) |
| 15 | `user.sessions.revoke` | audit | — | api | admin, owner | `targetId`, `count` | бессрочно | `/admin/audit` | `50-access/session-lifecycle.md` | утверждён |
| 16 | `user.archive.self` | audit | — | api | сам пользователь | `mode` (архив / оставить с подписью), `planUntil` на момент архива | бессрочно | `/admin/audit` | `10-flows/delete-account.md` | утверждён (бывший `user.delete`; Г3: самовосстановление — #79) |
| 17 | `user.email.change` | audit | — | api | сам / admin, owner | `targetId`, `via` (self / recovery) | бессрочно | `/admin/audit` | `10-flows/email-change-and-recovery.md` | утверждён |
| 18 | `plan.grant` / `plan.revoke` | audit | — | api | analyst, admin, owner | `targetId`, `tier`, `until`, `reason` | бессрочно | `/admin/audit` | `70-plans-and-billing/grants-and-promo.md` | утверждён |
| 19 | `plan.update` | audit | — | api | analyst, admin, owner | `planId`, `diff` (до/после) | бессрочно | `/admin/audit` | `40-admin/subscriptions.md` | утверждён |
| 20 | `subscription.grant` / `subscription.change` / `subscription.cancel` (сотрудником) | audit | — | api | analyst, admin, owner | `subscriptionId`, `reason`, платёжные данные, до/после (журнал #19) | бессрочно | `/admin/audit` | `40-admin/subscriptions.md` | утверждён |
| 21 | `payment.refund` / `refund.rejected` / `refund.requested` | audit (лог для `requested`) | — | api | analyst, admin, owner; пользователь (`requested`) | `paymentId`, `amountMinor`, `reason`; одобрение прекращает подписку сразу (журнал §8.18) | бессрочно | `/admin/audit`, `/admin/payments` | `70-plans-and-billing/refunds.md` | утверждён; Г5 |
| 22 | `promo.create` / `promo.disable` | audit | — | api | analyst, admin, owner | `promoId` | бессрочно | `/admin/audit` | `70-plans-and-billing/grants-and-promo.md` | утверждён |
| 23 | `webhook.replay` | audit | — | api | admin, owner | `eventId` | бессрочно | `/admin/audit` | `70-plans-and-billing/payment-provider.md` | утверждён |
| 24 | `translation.publish.manual` / `translation.rework.request` | audit | — | api | moderator, owner | `translationId`, `revisionId`, `reason` или рекомендации (журнал #14, #16) | бессрочно | `/admin/audit`; автору — история | `10-flows/moderation.md` | утверждён (бывшие `approve` / `reject`) |
| 25 | `translation.unpublish` | audit | — | api | moderator, owner | `translationId`, `reason` (обязательна — журнал #18) | бессрочно | `/admin/audit`; автору — история | `10-flows/moderation.md` | утверждён |
| 26 | `translation.status.set` | audit | — | — | — | — | — | — | — | отменено: произвольных переходов нет (матрица #28) |
| 27 | `article.archive` / `article.restore` | audit | — | api | автор, editor (редакционные), moderator и admin (только archive — журнал #53), owner | `articleId`, `actorRoleLevel` (журнал #2), `reason` | бессрочно | `/admin/audit` | `10-flows/archive-and-restore-article.md` | утверждён (бывшие `article.delete` / `article.taxonomy.change`) |
| 28 | `revision.restore` (не автором) | audit | — | api | owner | `translationId`, `fromRevisionId` | бессрочно | `/admin/audit` | `50-access/permission-checks.md` | утверждён |
| 29 | `ai.score.override` | audit | — | — | — | — | — | — | — | отменено: AI не выдаёт балл (журнал #41) |
| 30 | `ai.review.rerun` | audit | — | — | — | — | — | — | — | отменено: ручного повтора AI нет (журнал #14) |
| 31 | `ranking.config.change` / `ranking.recompute` | audit | — | — | — | — | — | — | — | отменено: веса фиксированы в движке, ручного пересчёта нет (журнал §21.32, §21.36); смена правил — релиз |
| 32 | `reads.exclude` / `boost.end` | audit | — | — | — | — | — | — | — | отменено: исключения только автоматические (#84, журнал §23.6); буста нет (§21.16) |
| 33 | `report.resolve` | audit | — | api | moderator, owner | `reportId`, `resolution` | бессрочно | `/admin/audit` | `10-flows/complaint.md` | отложено: жалобы — отдельный разбор |
| 34 | `media.replace` | audit | — | api | автор, editor (свои), owner | `assetId` | бессрочно | `/admin/audit` | `85-media-and-binary/upload-pipeline.md` | утверждён (`media.hide` — отложено с жалобами; `media.delete` → `entity.delete.permanent`) |
| 35 | `section.update` / `section.archive` / `section.restore` / `format.update` / `tag.merge` / `tag.archive` / `tag.restore` | audit | — | api | admin, owner (журнал #29) | `id`, `diff` | бессрочно | `/admin/audit` | `40-admin/categories.md`, `40-admin/tags.md` | утверждён |
| 36 | `job.retry` / `job.cancel` | audit | — | api | owner | `jobId`, `kind` | бессрочно | `/admin/audit` | `40-admin/jobs.md` | утверждён |
| 37 | `legal.update` | audit | — | api | owner | `kind`, `version` | бессрочно | `/admin/audit` | `40-admin/legal-texts.md` | утверждён |
| 38 | `newsletter.send` | audit | — | api | — | — | — | — | `40-admin/newsletter.md` | отложено: правила рассылок — отдельный разбор |
| 39 | `settings.change` / `secrets.rotate` | audit | — | api | owner | `key` (без значения) | бессрочно | `/admin/audit` | `40-admin/system-settings.md` | утверждён |
| 40 | `stats.export` | audit | — | api | analyst, admin, owner | `report`, `rows` | бессрочно | `/admin/audit` | `40-admin/statistics.md` | утверждён |

## Логи (pino, 30 дней)

| # | Код события | Тип | Уровень | Источник | Кто инициирует | Поля (без ПДн) | Ретенция | Где смотреть | Файл | Статус |
|---|---|---|---|---|---|---|---|---|---|---|
| 41 | `http.request` | log | info | api, web | любой | `requestId`, `method`, `operation`, `status`, `durationMs`, `role` | 30 дней | логи хостинга | `80-observability/request-tracing.md` | утверждён |
| 42 | `auth.link.requested` / `auth.login` / `auth.login.failed` | log | info / warn | api | посетитель | `requestId`, `emailHash`, `reason` (в том числе «аккаунт в архиве») | 30 дней | логи | `50-access/session-lifecycle.md` | утверждён |
| 43 | `session.refresh` / `session.revoked` / `session.reuse_detected` | log | info / warn | api | пользователь / система | `sessionId`, `userId` | 30 дней | логи; алерт на reuse | `50-access/session-lifecycle.md` | утверждён |
| 44 | `rate_limit.hit` | log | warn | api | любой | `bucket`, `ipHash` | 30 дней | логи | `50-access/rate-limits.md` | утверждён |
| 45 | `translation.submit` / `translation.withdraw` / `translation.reedit` | log | info | api | автор | `translationId`, `revisionId`, `branch` (ai / manual) | 30 дней | логи; автору — история | `10-flows/write-and-publish.md` | утверждён (`appeal` удалён — журнал #40) |
| 46 | `ai.job.created` / `.started` / `.running` / `.done` / `.failed` | log | info / error | api worker | система | `jobId`, `kind` (check / translate), `translationId`, `model`, `promptVersion`, `costMinor`, `durationMs`; для `check` — `verdict` (publish / reject) без балла (журнал #34, #41) | 30 дней; раздел «AI-процессы» — история со статусами (этап 1) | `/admin/ai` | `40-admin/ai-processes.md` | утверждён |
| 47 | `ai.translate.*` (3) | log | — | — | — | — | — | — | — | отменено: объединено с #46 (`kind = translate`) |
| 48 | `ranking.run.started` / `ranking.run.done` / `ranking.run.failed` | log | info / error | движок рейтинга | система | `runId`, `kind` (initial / hourly / full), `rulesVersion`, `affected`, `durationMs`; при сбое — повтор по журналу ошибок (журнал §21.40) | 30 дней | `/admin/ranking`, `/admin/errors` | `60-ranking/recompute.md` | утверждён; Г4 |
| 49 | `webhook.received` / `webhook.processed` / `webhook.failed` | log | info / error | api | провайдер | `provider`, `eventId`, `type` | 30 дней; раздел «Платежи» — история обработок со статусами (журнал #34) | `/admin/payments` | `70-plans-and-billing/payment-provider.md` | утверждён |
| 50 | `subscription.activated` / `.deactivated` / `.expired` / `.renewed` / `.queued` / `.retry` | log | info | api worker | система | `subscriptionId`, `tier`, `reason` (payment_failed / canceled / expired); пять попыток списания, истечение с 00:00 (журнал §8.15); очередь периодов (§8.22); `attempt` для `retry`; `priority` для `queued` | 30 дней | логи; `/admin/subscriptions` | `70-plans-and-billing/subscription-lifecycle.md` | утверждён |
| 51 | `mail.queued` / `mail.sent` / `mail.failed` | log | info / error | api | система | `template`, `messageId`, `status`; уведомления автору о решениях по статье — по email (журнал #43) | 30 дней; раздел «Письма» — история со статусами (этап 1, журнал #34) | `/admin/mail` | `40-admin/mail.md` | утверждён |
| 52 | `job.failed` / `job.stuck` | log | error / warn | api worker | система | `jobId`, `kind`, `attempts`, `ageSec` | 30 дней | логи; алерт | `80-observability/health-and-alerts.md` | утверждён |
| 53 | `system.health` | log | info | api, web | внешняя проверка | `db`, `redis`, `psp`, `ai`, `mail` | 30 дней | `/health` | `80-observability/health-and-alerts.md` | утверждён |
| 54 | `error.unhandled` | log | error | api, web | система | `requestId`, стек (без ПДн) | 30 дней | сборщик ошибок | `80-observability/error-collector.md` | утверждён |

## Метрики и продуктовые события (без ПДн)

| # | Код события | Тип | Уровень | Источник | Кто инициирует | Поля (без ПДн) | Ретенция | Где смотреть | Файл | Статус |
|---|---|---|---|---|---|---|---|---|---|---|
| 55 | `read` | metric | — | — | — | — | — | — | — | отменено: заменён событиями вовлечённости #83 с `visitorId` (журнал §23.1–2) |
| 56 | `bookmark.add` / `bookmark.remove` | metric | — | api | аккаунт | `articleId` | агрегаты | статистика | `30-account/reader/bookmarks.md` | утверждён |
| 57 | `follow.add` / `follow.remove` (3) | metric | — | api | аккаунт | `authorId` | агрегаты | статистика | `10-flows/bookmark-and-follow.md` | утверждён |
| 58 | `search.query` / `search.zero_results` (3) | metric | — | api | любой | `queryHash`, `locale`, `filters` | агрегаты | статистика | `20-public/search.md` | утверждён |
| 59 | `checkout.started` / `checkout.succeeded` / `checkout.failed` | metric | — | api | аккаунт | `tier`, `interval`, `promo` (да/нет) | агрегаты | статистика | `70-plans-and-billing/subscription-lifecycle.md` | утверждён |
| 60 | `registration` / `author.profile.completed` | metric | — | api | пользователь | `day` | агрегаты | статистика (воронка) | `40-admin/statistics.md` | утверждён |
| 61 | `translation.published` | metric | — | api | система / moderator | `articleId`, `locale`, `via` (ai_auto / manual), `daysToDecision` | агрегаты | статистика | `40-admin/statistics.md` | утверждён |
| 62 | `boost.start` / `boost.end` | metric | — | — | — | — | — | — | — | отменено: буста нет, Pro-балл фиксируется при публикации (журнал §21.15–16) |
| 63 | `report.created` | metric | — | api | любой | `reason` | агрегаты | статистика | `40-admin/complaints.md` | отложено: жалобы — отдельный разбор |
| 64 | `page.error` (фронт) | metric | — | web | любой | `route`, `code`, `requestId` | 30 дней | сборщик ошибок | `80-observability/error-collector.md` | утверждён |

## Новые строки Г1

| # | Код события | Тип | Уровень | Источник | Кто инициирует | Поля (без ПДн) | Ретенция | Где смотреть | Файл | Статус |
|---|---|---|---|---|---|---|---|---|---|---|
| 65 | `role.assign.owner` / `role.revoke.owner` / `owner.deactivate` | audit | — | api | owner | `targetId`, `remainingOwners` (≥ 1, журнал #10) | бессрочно | `/admin/audit` | `10-flows/appoint-admin.md` | утверждён |
| 66 | `permission.exception.grant` / `permission.exception.revoke` / `permission.exception.expire` | audit | — | api, планировщик (`expire`) | owner; система для `expire` | `targetId`, `permission`, `reason`, `endsAt` (журнал #7, #54) | бессрочно | `/admin/audit` | `50-access/permission-exceptions.md` | утверждён; Г2: `expire` при автоматическом прекращении (журнал #54) |
| 67 | `admin.read.personal` | audit | — | api | analyst, admin, owner (и любая служебная роль при чтении ПДн) | `actorId`, `subjectId`, `context` (раздел, карточка), `purpose` — оба заполняются системой по разделу и действию, сотрудник ничего не вводит (журнал #6, #22, #59) | бессрочно | `/admin/audit` (только чтение — журнал #59) | `50-access/visibility.md` | утверждён; Г2: контекст автоматический |
| 68 | `entity.delete.permanent` | audit | — | api | owner | `entityType`, `entityId`, `confirmedName`, `reason` (журнал #1) | бессрочно | `/admin/audit` | `10-flows/permanent-delete.md` | утверждён |
| 69 | `translation.reject.final` | audit | — | api | moderator, owner | `translationId`, `reason` (журнал #12) | бессрочно | `/admin/audit`; автору — история | `10-flows/moderation.md` | утверждён |
| 70 | `review.message` | audit | — | api | moderator, owner | `translationId`, `decision` (rework / unpublish / publish / reject_final), `message`, автор, время (журнал #16) | бессрочно | история по статье; `/admin/audit` | `10-flows/moderation.md` | утверждён |
| 71 | `ai.decision` | audit | — | api worker | система | `translationId`, `revisionId`, `verdict` (publish / reject), `reasons` (критические причины при отказе — журнал #42), `promptVersion` | бессрочно | `/admin/ai`; автору — история | `40-admin/ai-processes.md` | утверждён |
| 72 | `translation.reedit` | audit | — | api | автор | `translationId`, `withinWindowSec` (журнал #9) | бессрочно | история по статье | `10-flows/write-and-publish.md` | утверждён |
| 73 | `payment.exclude` / `payment.include` | audit | — | api | analyst, admin, owner | `paymentId`, `reason`, сотрудник (журнал #27) | бессрочно | `/admin/audit` | `70-plans-and-billing/refunds.md` | утверждён |
| 74 | `subscription.extend.manual` | audit | — | api | analyst, admin, owner | `subscriptionId`, `days`, `newPeriodEnd` (журнал #25) | бессрочно | `/admin/audit` | `40-admin/subscriptions.md` | утверждён |
| 75 | `admin.change` (общая оболочка) | audit | — | api | служебные роли | `entity`, `entityId`, `fields` со значениями до/после (журнал #6) — обязательна для каждого административного изменения, конкретные коды выше уточняют `action` | бессрочно | `/admin/audit` | `40-admin/audit-log.md` | утверждён |
| 76 | `user.create.staff` | audit | — | api | admin, owner | `targetId`, `role`, e-mail — только хэш (журнал #47) | бессрочно | `/admin/audit` | `10-flows/appoint-admin.md` | утверждён (Г2) |
| 77 | `user.appeal.submit` / `user.appeal.decide` | audit | — | api | пользователь по ссылке входа архивированного аккаунта; admin, owner (`decide`) | `targetId`, `appealId`, `decision` (restore / confirm_block), `reason` (журнал #48) | бессрочно | `/admin/audit`; пользователю — письмо | `10-flows/archive-account.md` | утверждён (Г2) |
| 78 | `plan.action.rejected` | log | info | api | система | `userId`, `operation`, `planTier`, `planUntil` — отказ `PLAN_LIMIT` при сохранённой сессии (журнал #55) | 30 дней | логи | `50-access/session-lifecycle.md` | утверждён (Г2) |
| 79 | `user.restore.self` | audit | — | api | сам пользователь | `targetId`, `archivedAt`, `planUntil` (журнал #50, §5.2) | бессрочно | `/admin/audit` | `30-account/reader/archived-state.md` | утверждён (Г3) |
| 80 | `support.request.created` | log | info | api | любой | `topic` (`broken_link`, `general`, `restore`), `route` (шаблон), `requestId` — без ПДн отправителя в логе | 30 дней; сами обращения — бессрочно в очереди | админка | `20-public/contact.md` | утверждён (Г3, журнал §20.15) |
| 81 | `backend.error` (журнал ошибок бэкенда) | log | error | api, web, worker | система | `requestId`, `code`, `route`, `service`, стек (без ПДн), время — источник раздела «Ошибки и состояние» (журнал §20.19) | 90 дней `[ДОПУЩЕНИЕ]` | `/admin/errors` | `40-admin/errors-and-health.md` | черновик (заход 8b) |
| 82 | `engagement.anomaly` | log | warn | обработчик событий | система | объект (статья / автор), `day`, `signals[]`, значения — без ПДн и текстов (`60-ranking/engagement-tracking.md` §8) | по политике ретенции; `EngagementAnomaly` до разбора | `/admin/ranking`, `/admin/errors` | `60-ranking/anti-fraud.md` | утверждён; Г4 (пороги — отложено) |
| 83 | `article.open` / `article.read.qualified` / `article.read.repeat` / `article.share.create` / `article.share.open` / `author.profile.open` / `author.share.open` | metric | — | api (`POST /api/engagement`), SSR-резерв | посетитель по `visitorId` | `visitorId`, объект, `day`, `source` (internal / external / shared / direct), диагностический IP только для защиты (`engagement-tracking.md` §3, §5, §12) | сырые — короткий операционный период; дневные агрегаты — бессрочно | рейтинг; личная аналитика; статистика | `60-ranking/engagement-tracking.md` | утверждён; Г4 |
| 84 | `engagement.exclusion` | audit | — | обработчик событий | система | объект, `day`, основание (сработавшие правила), время; ручного возврата нет (журнал §23.6; `engagement-tracking.md` §15) | бессрочно | `/admin/audit`, `/admin/ranking` | `60-ranking/anti-fraud.md` | утверждён; Г4 |
| 85 | `profile.check` | audit | — | api worker / `moderator`, `owner` | система (автоматическая проверка), сотрудник (решение) | `userId`, `field` (`name` / `avatar`), `verdict` (ok / needs_review / rejected), `byRole` (журнал §25.4) | бессрочно | `/admin/review`, `/admin/audit` | `30-account/reader/profile-edit.md` | черновик (новая — Г6) |
| 86 | `review.reply` | log | info | api | автор | `translationId`, `decisionId`, `byRole: author` — текст не логируется (журнал §25.6) | 90 дней `[ДОПУЩЕНИЕ]` | `/admin/review` (сама переписка — в решении) | `30-account/author/review-history.md` | черновик (новая — Г6) |
| 87 | `author.enabled` | audit | — | api | система при первом «Создать статью» (журнал §25.1) | `userId`, `grantId`, время | бессрочно | `/admin/users/{id}`, `/admin/audit` | `70-plans-and-billing/plan-free.md` п. 6а | черновик (новая — Г6) |

## Правила

- Новые коды добавляются заходами 2–9 в статусе «черновик» и закрываются в заходе 8b; коды
  ошибок — только через `80-observability/error-dictionary.md`.
- В полях событий нет e-mail, имени, IP, текста статьи; допустимы идентификаторы и хэши с солью.
- Метрики не привязываются к пользователю; аудит и логи — привязываются по идентификатору.
- Ошибочные записи просмотров и платежей не удаляются: сохраняется факт и причина исключения
  (журнал #26–27).

# Матрица «роль × действие × данные»

- **Заход**: 1 (2026-09-06). **Основание**: `docs/vision/04-roles-and-access.md` §2–5,
  ADR-0014, ADR-0018, ADR-0035, ADR-0036, ADR-0039, ADR-0040, ADR-0041, ADR-0042, ADR-0044,
  ADR-0045, ADR-0046. Колонки — `README.md`.
- Обозначения: `✓` — может; `свои` — только над своими объектами; `—` — нельзя; `акт.` —
  только при активной подписке или гранте (ADR-0044); `(n)` — этап появления; `(В?)` — зависит
  от ответа владельца (вопрос в отчёте).
- Иерархия: `editor < moderator < admin < owner` по включению; `analyst` вне иерархии. Где
  проверяется: `vis` — `visibleTranslationsWhere`; `auth` — `ensureAuthenticated`; `role(x)` —
  `ensureRole(x)`; `act` — `ensureActiveAuthor`; `own` — владение объектом; `edit` —
  `assertCanEditTranslation`; `mod` — `assertCanModerate`; `plan(f)` — фича плана.
- Ошибки — коды ADR-0032; `PLAN_LIMIT` — новый (через `80-observability/error-dictionary.md`).

## Чтение и публичные данные

| # | Действие (код) | Данные / сущность | Гость | Reader | Author | Editor | Moderator | Analyst | Admin | Owner | Где проверяется | Аудит | Ошибка (код) | Файл политики |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | `article.read` | опубликованная версия локали | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | vis | — | `NOT_FOUND` | `50-access/visibility.md` |
| 2 | `article.read.unpublished` | `draft`, `ai_review`, `review`, `archived` | — | — | свои | ✓ | ✓ | — | ✓ | ✓ | vis, own | — | `NOT_FOUND` (не `FORBIDDEN`: не раскрывать существование) | `50-access/visibility.md` |
| 3 | `article.preview` | текущая ревизия по `?preview=` | — | — | свои | ✓ | ✓ | — | ✓ | ✓ | vis, own, token | — | `NOT_FOUND` | `50-access/visibility.md` |
| 4 | `feed.read` | ленты по рейтингу (2) / по дате (1) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | vis | — | — | `60-ranking/feed-principles.md` |
| 5 | `author.read.public` | имя, хэндл, «о себе», аватар, соцсети, грейд | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — | — | `NOT_FOUND` | `50-access/visibility.md` |
| 6 | `user.read.private` | e-mail, роль, план, срок, блокировка, сессии | — | свои | свои | — | ✓ без e-mail | — | ✓ | ✓ | auth, role | — | `FORBIDDEN` | `50-access/visibility.md` |
| 7 | `article.score.read` | разложение рейтинга (2) | словами | словами | свои числа | ✓ | ✓ | ✓ | ✓ | ✓ | vis, own | — | — | `60-ranking/explainability.md` |
| 8 | `article.aiReview.read` | вердикт, балл, критерии, пояснения | — | — | свои | ✓ | ✓ | агрегаты | ✓ | ✓ | own, role | — | `FORBIDDEN` | `60-ranking/ai-review.md` |
| 9 | `article.stats.read` | прочтения по дням (2) | — | — | свои: standard — сумма, pro — по дням | ✓ | ✓ | агрегаты | ✓ | ✓ | own, plan(stats) | — | `PLAN_LIMIT` | `60-ranking/views-counting.md` |
| 10 | `search.query` | поиск (3) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | vis, лимит | — | `RATE_LIMITED` | `50-access/rate-limits.md` |
| 11 | `taxonomy.read` | рубрики, форматы, теги | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — | — | — | `50-access/visibility.md` |
| 12 | `legal.read` | юридические тексты с версией | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — | — | — | `50-access/visibility.md` |

## Закладки и подписка на автора

| # | Действие (код) | Данные / сущность | Гость | Reader | Author | Editor | Moderator | Analyst | Admin | Owner | Где проверяется | Аудит | Ошибка (код) | Файл политики |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 13 | `bookmark.add` / `bookmark.remove` | `Bookmark` | — | свои | свои | свои | свои | свои | свои | свои | auth | — | `UNAUTHENTICATED` | `50-access/permission-checks.md` |
| 14 | `bookmark.list` | `Bookmark` | — | свои | свои | свои | свои | свои | свои | свои | auth | — | `UNAUTHENTICATED` | `50-access/permission-checks.md` |
| 15 | `author.follow` / `author.unfollow` (3) | `AuthorFollow` | — | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | auth | — | `UNAUTHENTICATED` | `50-access/permission-checks.md` |
| 16 | `report.create` | `Report` | ✓ (с e-mail, лимит) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | лимит | — | `RATE_LIMITED`, `VALIDATION_ERROR` | `50-access/rate-limits.md` |

## Материалы

| # | Действие (код) | Данные / сущность | Гость | Reader | Author | Editor | Moderator | Analyst | Admin | Owner | Где проверяется | Аудит | Ошибка (код) | Файл политики |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 17 | `article.create` | `Article` + версия `sourceLocale` | — | — | акт. | ✓ | ✓ | — | ✓ | ✓ | act | — | `PLAN_LIMIT` (нет плана), `FORBIDDEN` | `70-plans-and-billing/role-derivation.md` |
| 18 | `translation.save` | текст, метаданные, ревизия `autosave`/`manual` | — | — | акт., свои | ✓ в `review` (ревизия `editorial`) | ✓ в `review` | — | ✓ в `review` | ✓ в `review` | act, own, edit | — | `FORBIDDEN`, `CONFLICT`, `CONTENT_INVALID` | `50-access/permission-checks.md` |
| 19 | `translation.save.published` | правка опубликованной версии → новая ревизия | — | — | акт., свои | — | — | — | — | — | act, own | — | `FORBIDDEN` | `50-access/permission-checks.md` |
| 20 | `translation.submit` | `draft → ai_review`; ревизия `publish` | — | — | акт., свои | ✓ свои | ✓ свои | — | ✓ | ✓ | act, own, лимит очереди | `translation.submit` (лог) | `PLAN_LIMIT`, `VALIDATION_ERROR` | `10-flows/write-and-publish.md` |
| 21 | `translation.withdraw` | `ai_review \| review → draft` | — | — | акт., свои | свои | свои | — | ✓ | ✓ | own | — | `FORBIDDEN` | `50-access/permission-checks.md` |
| 22 | `translation.appeal` | оспорить `fail` → `review` | — | — | акт., свои (лимит) | свои | свои | — | ✓ | ✓ | own, лимит | — | `PLAN_LIMIT` | `10-flows/write-and-publish.md` |
| 23 | `translation.approve` | `review → published` | — | — | — | — | ✓ | — | ✓ | ✓ | role(moderator) | `translation.approve` | `FORBIDDEN`, `CONFLICT` | `10-flows/moderation.md` |
| 24 | `translation.reject` | `review → draft` с причиной | — | — | — | — | ✓ | — | ✓ | ✓ | role(moderator) | `translation.reject` | `FORBIDDEN` | `10-flows/moderation.md` |
| 25 | `translation.unpublish` | `published → archived \| draft` с причиной | — | — | — | — | ✓ | — | ✓ | ✓ | mod | `translation.unpublish` | `FORBIDDEN` | `50-access/permission-checks.md` |
| 26 | `translation.archive` | своё `published → archived` | — | — | ✓ свои (и после истечения) | свои | свои | — | ✓ | ✓ | own | — | `FORBIDDEN` | `50-access/permission-checks.md` |
| 27 | `translation.restore` | `archived → draft` | — | — | акт., свои | ✓ | ✓ | — | ✓ | ✓ | act, own | — | `FORBIDDEN` | `50-access/permission-checks.md` |
| 28 | `translation.status.set` | любой переход | — | — | — | — | — | — | ✓ | ✓ | role(admin) | `translation.status.set` | `FORBIDDEN` | `40-admin/articles.md` |
| 29 | `article.delete` | никогда не публиковавшийся | — | — | свои | ✓ | ✓ | — | ✓ | ✓ | own или role(editor); `firstPublishedAt IS NULL` | `article.delete` | `FORBIDDEN`, `CONFLICT` | `50-access/permission-checks.md` |
| 30 | `article.taxonomy.set` | рубрика, формат, теги своего материала | — | — | акт., свои | ✓ любого | — | — | ✓ | ✓ | act, own или role(editor) | `article.taxonomy.change` (чужого) | `FORBIDDEN` | `50-access/permission-checks.md` |
| 31 | `translation.slug.set` | слаг до первой публикации; после — через историю | — | — | акт., свои | ✓ | — | — | ✓ | ✓ | own, `assignSlug` | — | `DUPLICATE`, `VALIDATION_ERROR` | `50-access/permission-checks.md` |
| 32 | `translation.translate.ai` (3) | `TranslationJob` | — | — | pro, акт., свои (лимит) | ✓ любого | — | — | ✓ | ✓ | plan(translate), own, лимит | — | `PLAN_LIMIT` | `10-flows/translate-with-ai.md` |
| 33 | `translation.translate.manual` (3) | вторая языковая версия вручную | — | — | — `(В?)` | ✓ | — | — | ✓ | ✓ | role(editor) | — | `FORBIDDEN` | `50-access/permission-checks.md` |
| 34 | `revision.list` / `revision.read` (4) | `ArticleRevision` | — | — | свои | ✓ | ✓ | — | ✓ | ✓ | own или role(editor) | — | `FORBIDDEN` | `50-access/permission-checks.md` |
| 35 | `revision.restore` (4) | новая ревизия из старой | — | — | акт., свои | ✓ в пределах `edit` | — | — | ✓ | ✓ | act, edit | `revision.restore` (не автором) | `FORBIDDEN` | `50-access/permission-checks.md` |
| 36 | `reviewNote.create` / `reviewNote.resolve` (4) | `ReviewNote` | — | — | resolve свои | ✓ | ✓ | — | ✓ | ✓ | role(editor) / own | — | `FORBIDDEN` | `50-access/permission-checks.md` |
| 37 | `article.export` (3) | Markdown/HTML своих | — | — | ✓ свои (и после истечения) | ✓ любого | — | — | ✓ | ✓ | own или role(editor) | — | `FORBIDDEN` | `50-access/permission-checks.md` |
| 38 | `article.bulk.status` | массовые операции над версиями | — | — | — | — | — | — | ✓ | ✓ | role(admin), лимит выборки | `translation.status.set` ×N | `FORBIDDEN`, `VALIDATION_ERROR` | `40-admin/articles.md` |

## Медиа

| # | Действие (код) | Данные / сущность | Гость | Reader | Author | Editor | Moderator | Analyst | Admin | Owner | Где проверяется | Аудит | Ошибка (код) | Файл политики |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 39 | `media.upload` | `MediaAsset` с лицензией и атрибуцией | — | аватар | акт. (лимит плана) | ✓ | ✓ | — | ✓ | ✓ | act, plan(mediaQuota), валидация | — | `VALIDATION_ERROR`, `PLAN_LIMIT` | `85-media-and-binary/upload-pipeline.md` |
| 40 | `media.update.meta` | alt, подпись, атрибуция, лицензия, фокус | — | — | свои | ✓ | ✓ | — | ✓ | ✓ | own или role(editor) | — | `FORBIDDEN` | `85-media-and-binary/upload-pipeline.md` |
| 41 | `media.delete` | пометка `deletedAt` неиспользуемого | — | — | свои | ✓ | ✓ | — | ✓ | ✓ | own, «не используется» | — | `CONFLICT` (используется) | `85-media-and-binary/retention-and-orphans.md` |
| 42 | `media.hide` | скрыть по претензии | — | — | — | — | ✓ | — | ✓ | ✓ | mod | `media.hide` | `FORBIDDEN` | `10-flows/complaint.md` |
| 43 | `media.replace` (4) | заменить файл с сохранением ссылок | — | — | — | ✓ | — | — | ✓ | ✓ | role(editor) | `media.replace` | `FORBIDDEN` | `40-admin/media-library.md` |
| 44 | `media.purge` (4) | физическое удаление неиспользуемых | — | — | — | — | — | — | ✓ | ✓ | role(admin), «нет ссылок» | `media.delete` | `CONFLICT` | `85-media-and-binary/retention-and-orphans.md` |

## Профиль, сессии, аккаунт

| # | Действие (код) | Данные / сущность | Гость | Reader | Author | Editor | Moderator | Analyst | Admin | Owner | Где проверяется | Аудит | Ошибка (код) | Файл политики |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 45 | `auth.magicLink.request` | письмо со ссылкой | ✓ (лимит) | — | — | — | — | — | — | — | лимит по e-mail и IP | лог `auth.link.requested` | `RATE_LIMITED` | `50-access/rate-limits.md` |
| 46 | `auth.magicLink.verify` | создание сессии | ✓ по ссылке | — | — | — | — | — | — | — | токен одноразовый | лог `auth.login` | `NOT_FOUND` | `50-access/session-lifecycle.md` |
| 47 | `session.refresh` / `session.logout` / `session.revoke` | `Session` | — | свои | свои | свои | свои | свои | свои | свои | auth, own | лог `auth.session.*` | `UNAUTHENTICATED` | `50-access/session-lifecycle.md` |
| 48 | `profile.update` | имя, «о себе», хэндл, аватар, соцсети, язык | — | свои | свои | свои | свои | свои | свои | свои | auth | — | `VALIDATION_ERROR`, `DUPLICATE` (хэндл) | `50-access/permission-checks.md` |
| 49 | `email.change` | подтверждение с обоих адресов | — | свои | свои | свои | свои | свои | свои | свои | auth, два токена | `user.email.change` | `CONFLICT` (занят) | `10-flows/email-change-and-recovery.md` |
| 50 | `email.change.admin` | смена e-mail по процедуре восстановления | — | — | — | — | — | — | ✓ | ✓ | role(admin) | `user.email.change` | `FORBIDDEN` | `10-flows/email-change-and-recovery.md` |
| 51 | `account.delete.self` (3) | анонимизация с выбором судьбы материалов | — | свои | свои | свои | свои | свои | свои | только после передачи владения | auth, письмо | `user.delete` | `CONFLICT` (owner) | `10-flows/delete-account.md` |
| 52 | `account.delete.admin` | анонимизация чужого по запросу | — | — | — | — | — | — | ✓ | ✓ | role(admin) | `user.delete` | `FORBIDDEN` | `40-admin/users.md` |
| 53 | `account.export` (3) | выгрузка JSON | — | свои | свои | свои | свои | свои | свои | свои | auth | — | — | `30-account/reader/export.md` |
| 54 | `consent.accept` | версия оферты и политики ПД | ✓ при входе | ✓ при смене версии | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | версия | — | `VALIDATION_ERROR` | `50-access/session-lifecycle.md` |

## Подписка и платежи

| # | Действие (код) | Данные / сущность | Гость | Reader | Author | Editor | Moderator | Analyst | Admin | Owner | Где проверяется | Аудит | Ошибка (код) | Файл политики |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 55 | `plan.list` | планы и цены | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — | — | — | `70-plans-and-billing/plan-*.md` |
| 56 | `checkout.start` | `Customer`, платёж у провайдера | — | ✓ | ✓ (смена плана) | ✓ | ✓ | ✓ | ✓ | ✓ | auth, «нет активной той же» | лог `checkout.started` | `CONFLICT`, `INTERNAL_ERROR` | `70-plans-and-billing/subscription-lifecycle.md` |
| 57 | `promo.validate` / `promo.apply` | `PromoCode` | — | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | auth, срок и лимит | — | `NOT_FOUND`, `CONFLICT` | `70-plans-and-billing/grants-and-promo.md` |
| 58 | `subscription.read` | своя подписка, платежи, чеки | — | свои | свои | свои | свои | свои | свои | свои | auth | — | — | `30-account/reader/subscription.md` |
| 59 | `subscription.cancel` / `subscription.resume` | `cancelAtPeriodEnd` | — | свои | свои | свои | свои | свои | свои | свои | auth, own | лог | `CONFLICT` | `70-plans-and-billing/subscription-lifecycle.md` |
| 60 | `subscription.changePlan` | standard ↔ pro | — | — | свои | ✓ | ✓ | ✓ | ✓ | ✓ | auth, own | лог | `CONFLICT` | `70-plans-and-billing/subscription-lifecycle.md` |
| 61 | `subscription.admin.cancel` / `subscription.admin.change` | чужая подписка | — | — | — | — | — | — | ✓ | ✓ | role(admin) | `subscription.cancel`, `subscription.change` | `FORBIDDEN` | `40-admin/subscriptions.md` |
| 62 | `payment.refund` | возврат через провайдера | — | — | — | — | — | — | ✓ | ✓ | role(admin), политика возвратов | `payment.refund` | `FORBIDDEN`, `CONFLICT` | `70-plans-and-billing/refunds.md` |
| 63 | `plan.grant` / `plan.revoke` | `PlanGrant` | — | — | — | — | — | — | ✓ | ✓ | role(admin), срок обязателен | `plan.grant`, `plan.revoke` | `FORBIDDEN`, `VALIDATION_ERROR` | `70-plans-and-billing/grants-and-promo.md` |
| 64 | `promo.create` / `promo.disable` | `PromoCode` | — | — | — | — | — | — | ✓ | ✓ | role(admin) | `promo.create`, `promo.disable` | `FORBIDDEN`, `DUPLICATE` | `70-plans-and-billing/grants-and-promo.md` |
| 65 | `plan.update` | цены, возможности, архив плана | — | — | — | — | — | — | ✓ | ✓ | role(admin) | `plan.update` | `FORBIDDEN` | `40-admin/subscriptions.md` |
| 66 | `webhook.psp.receive` / `webhook.replay` | `PspWebhookEvent` | провайдер по подписи | — | — | — | — | — | replay ✓ | replay ✓ | подпись; role(admin) для replay | `webhook.replay` | `FORBIDDEN` | `70-plans-and-billing/payment-provider.md` |

## Рейтинг и прочтения (2)

| # | Действие (код) | Данные / сущность | Гость | Reader | Author | Editor | Moderator | Analyst | Admin | Owner | Где проверяется | Аудит | Ошибка (код) | Файл политики |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 67 | `read.beacon` | `ReadEvent` без ПДн | ✓ (лимит) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | фильтр ботов, лимит | метрика `read` | `RATE_LIMITED` | `60-ranking/views-counting.md` |
| 68 | `ranking.config.read` | `RankingConfig` | — | — | — | — | ✓ | ✓ | ✓ | ✓ | role | — | `FORBIDDEN` | `40-admin/ranking-config.md` |
| 69 | `ranking.config.change` | новая версия весов | — | — | — | — | — | — | ✓ | ✓ | role(admin) | `ranking.config.change` | `FORBIDDEN`, `VALIDATION_ERROR` | `40-admin/ranking-config.md` |
| 70 | `ranking.recompute` | полный пересчёт | — | — | — | — | — | — | ✓ | ✓ | role(admin) | `ranking.recompute` | `FORBIDDEN` | `60-ranking/recompute.md` |
| 71 | `reads.exclude` / `reads.include` | `ReadExclusion` | — | — | — | — | ✓ | — | ✓ | ✓ | role(moderator) | `reads.exclude` | `FORBIDDEN` | `60-ranking/anti-fraud.md` |
| 72 | `boost.end` | досрочное завершение буста | — | — | — | — | ✓ | — | ✓ | ✓ | role(moderator) | `boost.end` | `FORBIDDEN` | `60-ranking/pro-boost.md` |

## AI

| # | Действие (код) | Данные / сущность | Гость | Reader | Author | Editor | Moderator | Analyst | Admin | Owner | Где проверяется | Аудит | Ошибка (код) | Файл политики |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 73 | `ai.review.run` | запуск проверки ревизии (автоматически при `submit`) | — | — | косвенно | косвенно | ✓ повтор | — | ✓ повтор | ✓ повтор | система; role(moderator) для повтора | `ai.review.rerun` | `FORBIDDEN`, `PLAN_LIMIT` (бюджет) | `60-ranking/ai-review.md` |
| 74 | `ai.score.override` | `overriddenScore` с причиной | — | — | — | — | ✓ | — | ✓ | ✓ | role(moderator) | `ai.score.override` | `FORBIDDEN` | `40-admin/ai-reviews.md` |
| 75 | `ai.review.read.all` | все вердикты и стоимость | — | — | — | ✓ | ✓ | агрегаты | ✓ | ✓ | role | — | `FORBIDDEN` | `40-admin/ai-reviews.md` |
| 76 | `ai.settings.change` | провайдер, пороги, бюджет, версия промта | — | — | — | — | — | — | — | ✓ | role(owner) | `settings.change` | `FORBIDDEN` | `40-admin/system-settings.md` |

## Модерация и жалобы

| # | Действие (код) | Данные / сущность | Гость | Reader | Author | Editor | Moderator | Analyst | Admin | Owner | Где проверяется | Аудит | Ошибка (код) | Файл политики |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 77 | `report.list` / `report.read` | `Report` с текстом и e-mail жалобщика | — | — | — | — | ✓ | — | ✓ | ✓ | role(moderator) | — | `FORBIDDEN` | `40-admin/complaints.md` |
| 78 | `report.resolve` / `report.dismiss` | резолюция | — | — | — | — | ✓ | — | ✓ | ✓ | role(moderator) | `report.resolve` | `FORBIDDEN` | `10-flows/complaint.md` |
| 79 | `user.block` / `user.unblock` | `blocked*`, отзыв сессий | — | — | — | — | ✓ не выше себя | — | ✓ не владельца | ✓ | mod | `user.block`, `user.unblock` | `FORBIDDEN` | `10-flows/block-user.md` |
| 80 | `user.sessions.revoke` | чужие сессии | — | — | — | — | ✓ не выше себя | — | ✓ | ✓ | mod | `user.sessions.revoke` | `FORBIDDEN` | `50-access/session-lifecycle.md` |
| 81 | `user.list` / `user.read.admin` | список и карточки | — | — | — | — | ✓ без e-mail | — | ✓ | ✓ | role(moderator) | — | `FORBIDDEN` | `40-admin/users.md` |

## Таксономия

| # | Действие (код) | Данные / сущность | Гость | Reader | Author | Editor | Moderator | Analyst | Admin | Owner | Где проверяется | Аудит | Ошибка (код) | Файл политики |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 82 | `section.create` / `section.update` / `section.reorder` | `Section` | — | — | — | ✓ | — | — | ✓ | ✓ | role(editor) | `section.update` | `FORBIDDEN`, `DUPLICATE` | `40-admin/categories.md` |
| 83 | `section.archive` | только без активных материалов | — | — | — | ✓ | — | — | ✓ | ✓ | role(editor), FK Restrict | `section.archive` | `CONFLICT` | `40-admin/categories.md` |
| 84 | `format.*` | `Format` | — | — | — | ✓ | — | — | ✓ | ✓ | role(editor) | `format.update` | `FORBIDDEN` | `40-admin/categories.md` |
| 85 | `tag.create` | при публикации | — | — | акт. | ✓ | ✓ | — | ✓ | ✓ | act | — | `VALIDATION_ERROR` | `40-admin/tags.md` |
| 86 | `tag.merge` / `tag.delete` / `tag.rename` | `Tag` | — | — | — | ✓ | ✓ | — | ✓ | ✓ | role(editor) | `tag.merge`, `tag.delete` | `FORBIDDEN` | `40-admin/tags.md` |

## Администрирование

| # | Действие (код) | Данные / сущность | Гость | Reader | Author | Editor | Moderator | Analyst | Admin | Owner | Где проверяется | Аудит | Ошибка (код) | Файл политики |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 87 | `admin.enter` | вход в `/admin` | — | — | — | ✓ | ✓ | ✓ | ✓ | ✓ | role | лог `admin.enter` | `FORBIDDEN` | `50-access/permission-checks.md` |
| 88 | `role.assign.editor` / `.moderator` / `.analyst` | `User.role` | — | — | — | — | — | — | ✓ | ✓ | role(admin), не себе | `user.role.change` | `FORBIDDEN` | `10-flows/appoint-admin.md` |
| 89 | `role.assign.admin` / `role.revoke.admin` | `User.role` | — | — | — | — | — | — | — | ✓ | role(owner), не себе | `user.role.change` | `FORBIDDEN` | `10-flows/appoint-admin.md` |
| 90 | `role.revoke.self` | снять роль с себя | — | — | — | — | — | — | — | — | запрещено всем | — | `FORBIDDEN` | `50-access/escalation-and-demotion.md` |
| 91 | `owner.transfer` | двустороннее подтверждение | — | — | — | — | — | — | — | ✓ | role(owner), два письма | `owner.transfer` | `CONFLICT` | `10-flows/appoint-admin.md` |
| 92 | `audit.read` (4; до этого SQL) | `AuditLog` | — | — | — | — | ✓ | — | ✓ | ✓ | role(moderator) | — | `FORBIDDEN` | `40-admin/audit-log.md` |
| 93 | `stats.read` | агрегаты без ПДн | — | — | — | — | ✓ | ✓ | ✓ | ✓ | role | — | `FORBIDDEN` | `40-admin/statistics.md` |
| 94 | `stats.export` | CSV без ПДн | — | — | — | — | ✓ | ✓ | ✓ | ✓ | role | `stats.export` | `FORBIDDEN` | `40-admin/statistics.md` |
| 95 | `job.list` / `job.retry` / `job.cancel` | очередь заданий | — | — | — | — | — | — | ✓ | ✓ | role(admin) | `job.retry`, `job.cancel` | `FORBIDDEN` | `40-admin/jobs.md` |
| 96 | `legal.update` (4) | новая версия текста | — | — | — | — | — | — | ✓ | ✓ | role(admin) | `legal.update` | `FORBIDDEN` | `40-admin/legal-texts.md` |
| 97 | `newsletter.*` (4) | выпуски, отправка | — | — | — | ✓ | — | счётчики | ✓ | ✓ | role(editor) | `newsletter.send` | `FORBIDDEN` | `40-admin/newsletter.md` |
| 98 | `settings.change` / `secrets.rotate` (4) | провайдеры, домены, ключи | — | — | — | — | — | — | — | ✓ | role(owner) | `settings.change`, `secrets.rotate` | `FORBIDDEN` | `40-admin/system-settings.md` |
| 99 | `mutation.any` для `analyst` | любая мутация | — | — | — | — | — | — (контрактный тест) | — | — | SDL-тест | — | `FORBIDDEN` | `50-access/roles/analyst.md` |

## Инварианты, которые матрица не выражает (проверяются политиками)

- Посетитель и читатель никогда не получают `FORBIDDEN` на чужие черновики — только `NOT_FOUND`
  (не раскрывать существование).
- `author` без активной подписки (`акт.`) получает `PLAN_LIMIT` с указанием плана, а не
  `FORBIDDEN` — интерфейс ведёт на `/pricing`.
- Никто не может снять роль с себя и назначить роль выше своей (#88–90).
- `analyst` — ни одной мутации (#99), включая закладки? — **нет**: закладки и профиль — свои
  действия аккаунта, доступны всем ролям (#13, #48); контрактный тест исключает эти поля.

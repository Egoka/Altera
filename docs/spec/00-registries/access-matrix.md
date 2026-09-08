# Матрица «роль × действие × данные»

- **Заход**: 1 (2026-09-06); **гейт Г1**: 2026-09-08 по журналу
  `docs/decisions/role-review-working-log-2026-09-08.md` (далее «журнал»). **Основание**:
  журнал §1–16; ADR-0014, ADR-0018, ADR-0035, ADR-0041 в части, не противоречащей журналу.
  Колонки — `README.md`.
- Обозначения: `✓` — может; `свои` — только над своими объектами; `—` — нельзя; `акт.` — только
  при активной подписке или выдаче плана (журнал #5, #20); `(n)` — этап появления;
  `[ДОПУЩЕНИЕ]` — журнал молчит, оставлено прежнее значение и вынесено в отчёт.
- **Иерархии по включению нет** (журнал §1): у каждой служебной роли свой дефолтный набор;
  `owner` может всё, включая действия ревьюера; индивидуальные исключения для служебных ролей
  выдаёт только `owner` (журнал #7) и в матрице не отражаются.
- Где проверяется: `vis` — `visibleTranslationsWhere`; `auth` — `ensureAuthenticated`;
  `role(x)` — `ensureRole(x)`; `act` — `ensureActiveAuthor`; `own` — владение объектом;
  `perm(p)` — дефолтное или индивидуальное право `p` (журнал #7–8); `plan(f)` — фича плана.
- Любое чтение персональных данных через административные инструменты аудируется
  `admin.read.personal` (журнал #6); изменения хранят поля и значения до/после.
- Ошибки — коды ADR-0032; `PLAN_LIMIT`, `PROVIDER_UNAVAILABLE` — `events-and-logs.md`.

## Чтение и публичные данные

| # | Действие (код) | Данные / сущность | Гость | Reader | Author | Editor | Moderator | Analyst | Admin | Owner | Где проверяется | Аудит | Ошибка (код) | Файл политики | Статус |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | `article.read` | опубликованная версия локали | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | vis | — | `NOT_FOUND` | `50-access/visibility.md` | утверждён |
| 2 | `article.read.unpublished` | `draft`, `ai_check`, `review`, `archived`, `rejected` | — | — | свои | свои | ✓ | ✓ (карточка автора, аудит) | ✓ (чтение) | ✓ | vis, own, role | `admin.read.personal` для служебных ролей | `NOT_FOUND` (существование не раскрывается) | `50-access/visibility.md` | утверждён |
| 3 | `article.preview` | текущая ревизия по `?preview=` | — | — | свои | свои | ✓ | — | ✓ | ✓ | vis, own, token | — | `NOT_FOUND` | `50-access/visibility.md` | утверждён |
| 4 | `feed.read` | ленты по рейтингу (2) / по дате (1) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | vis | — | — | `60-ranking/feed-principles.md` | утверждён |
| 5 | `author.read.public` | имя, хэндл, «о себе», аватар, соцсети, грейд | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — | — | `NOT_FOUND` | `50-access/visibility.md` | утверждён |
| 6 | `user.read.private` | e-mail, роль, план, срок, состояние аккаунта, сессии | — | свои | свои | — | — | ✓ (журнал #11, #22) | ✓ (журнал #13) | ✓ | auth, role | `admin.read.personal` | `FORBIDDEN` | `50-access/visibility.md` | утверждён |
| 7 | `article.score.read` | разложение рейтинга (2); AI в него не входит | словами | словами | свои числа | свои | ✓ | ✓ | ✓ | ✓ | vis, own | — | — | `60-ranking/explainability.md` | утверждён; параметры — Г4 |
| 8 | `article.aiCheck.read` | вердикт AI и критические причины отказа (журнал #42) | — | — | свои | свои | ✓ | — | ✓ | ✓ | own, role | — | `FORBIDDEN` | `40-admin/ai-processes.md` | утверждён |
| 9 | `article.stats.read` | прочтения (2): standard — сумма, pro — по дням; только валидные записи | — | — | свои | свои | ✓ | ✓ (аудит) | ✓ | ✓ | own, plan(stats), role | `admin.read.personal` | `PLAN_LIMIT` | `60-ranking/views-counting.md` | утверждён |
| 10 | `search.query` (3) | поиск | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | vis, лимит | — | `RATE_LIMITED` | `50-access/rate-limits.md` | утверждён |
| 11 | `taxonomy.read` | рубрики, форматы, теги | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — | — | — | `50-access/visibility.md` | утверждён |
| 12 | `legal.read` | юридические тексты с версией | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — | — | — | `50-access/visibility.md` | утверждён |

## Закладки, подписка на автора, жалобы

| # | Действие (код) | Данные / сущность | Гость | Reader | Author | Editor | Moderator | Analyst | Admin | Owner | Где проверяется | Аудит | Ошибка (код) | Файл политики | Статус |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 13 | `bookmark.add` / `bookmark.remove` | `Bookmark` | — | свои | свои | свои | свои | свои | свои | свои | auth | — | `UNAUTHENTICATED` | `50-access/permission-checks.md` | утверждён |
| 14 | `bookmark.list` | `Bookmark` | — | свои | свои | свои | свои | свои | свои | свои | auth | — | `UNAUTHENTICATED` | `50-access/permission-checks.md` | утверждён |
| 15 | `author.follow` / `author.unfollow` (3) | `AuthorFollow` | — | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | auth | — | `UNAUTHENTICATED` | `50-access/permission-checks.md` | утверждён |
| 16 | `report.create` | `Report` | ✓ (лимит) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | лимит | — | `RATE_LIMITED` | `10-flows/complaint.md` | отложено: жалобы — отдельный разбор |

## Материалы: создание, правка, публикация

| # | Действие (код) | Данные / сущность | Гость | Reader | Author | Editor | Moderator | Analyst | Admin | Owner | Где проверяется | Аудит | Ошибка (код) | Файл политики | Статус |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 17 | `article.create` | `Article` + версия `sourceLocale` | — | — | акт. | ✓ (редакционная, от имени журнала — журнал #12) | — `[ДОПУЩЕНИЕ]` | — | — (журнал #13) | ✓ | act или perm(editorial) | — | `PLAN_LIMIT`, `FORBIDDEN` | `70-plans-and-billing/role-derivation.md` | утверждён |
| 18 | `translation.save` | текст и метаданные черновика; ревизия `autosave`/`manual`; снимок каждой версии (журнал #15) | — | — | акт., свои | свои | — (не правит чужой текст — журнал #12) | — | — | ✓ | act, own | — | `FORBIDDEN`, `CONFLICT`, `CONTENT_INVALID` | `50-access/permission-checks.md` | утверждён |
| 19 | `translation.save.published` | правка опубликованной без снятия | — | — | — | — | — | — | — | — | — | — | — | — | отменено: правка опубликованной версии только после снятия с публикации — окно «перередактировать» (#100) или снятие ревьюером (#25) (журнал #9, #12) |
| 20 | `translation.submit` | отправка к публикации: первая подача → `ai_check`; повторная после отказа AI или снятия ревьюером → `review` (ручная ветка без AI, журнал #14); после «перередактировать» → снова `ai_check` (журнал #9) | — | — | акт., свои | свои | — | — | — | ✓ свои | act, own | лог `translation.submit` | `PLAN_LIMIT`, `VALIDATION_ERROR` | `10-flows/write-and-publish.md` | утверждён |
| 21 | `translation.withdraw` | `ai_check \| review → draft` | — | — | акт., свои | свои | — | — | — | ✓ | own | — | `FORBIDDEN` | `50-access/permission-checks.md` | утверждён |
| 22 | `translation.appeal` | оспорить отказ AI | — | — | — | — | — | — | — | — | — | — | — | — | отменено: оспаривания AI нет; после отказа — правка и ручная ветка ревьюера (журнал #40) |
| 23 | `translation.publish.manual` | ручная публикация из `review`: сразу публично, в том числе вопреки отказу AI (журнал #14, #44) | — | — | — | — (только свои через AI) | ✓ | — | — (журнал #8) | ✓ | perm(publish) | `translation.publish.manual` с причиной | `FORBIDDEN`, `CONFLICT` | `10-flows/moderation.md` | утверждён |
| 24 | `translation.rework.request` | вернуть из `review` на доработку с рекомендациями (неограниченно) | — | — | — | — | ✓ | — | — | ✓ | perm(review) | `translation.rework.request` с рекомендациями | `FORBIDDEN` | `10-flows/moderation.md` | утверждён |
| 25 | `translation.unpublish` | снять опубликованную на доработку в любой момент, с причиной или рекомендациями (журнал #12, #18) | — | — | — | — | ✓ | — | — | ✓ | perm(review) | `translation.unpublish` с причиной | `FORBIDDEN` | `10-flows/moderation.md` | утверждён |
| 26 | `article.archive` | обратимый архив («удалить» в интерфейсе): скрыт из выдачи и обычного списка, сохраняет версии, аналитику, связи, аудит, медиа закрывается; хранятся актор и уровень прав (журнал #2, #28) | — | — | ✓ свои (и после истечения плана — журнал #5) | свои | ✓ любую (проблемный контент) | — | — | ✓ | own или perm(moderate) | `article.archive` (актор, уровень прав) | `FORBIDDEN` | `10-flows/archive-and-restore-article.md` | утверждён |
| 27 | `article.restore` | из архива обратно (в `draft`; публикация — по правилам плана) | — | — | акт., свои, только если архивировал сам (журнал #3) | свои, если сам | — (журнал #3) | — | — | ✓ любую | own + актор архива; низшая роль не отменяет архив высшей | `article.restore` | `FORBIDDEN`, `PLAN_LIMIT` | `10-flows/archive-and-restore-article.md` | утверждён |
| 28 | `translation.status.set` | произвольный переход статуса | — | — | — | — | — | — | — | — | — | — | — | — | отменено: заменено конкретными действиями (#20, #23–27, #101); у `admin` нет прав записи (журнал #13) |
| 29 | `article.delete` | физическое удаление никогда не публиковавшегося | — | — | — | — | — | — | — | — | — | — | — | — | отменено: «удалить» = архив (#26); необратимое удаление — только `owner` (#103) (журнал #1) |
| 30 | `article.taxonomy.set` | рубрика, формат, теги своего материала (выбор из существующих) | — | — | акт., свои | свои | — | — | — | ✓ | act, own | — | `FORBIDDEN` | `50-access/permission-checks.md` | утверждён |
| 31 | `translation.slug.set` | слаг до первой публикации; после — через историю | — | — | акт., свои | свои | — | — | — | ✓ | own, `assignSlug` | — | `DUPLICATE`, `VALIDATION_ERROR` | `50-access/permission-checks.md` | утверждён |
| 32 | `translation.translate.ai` (3) | вторая языковая версия через AI | — | — | pro, акт., свои (журнал #33) | свои `[ДОПУЩЕНИЕ]` | — | — | — | ✓ | plan(translate), own, лимит (Г4) | лог `ai.job.*` | `PLAN_LIMIT`, `PROVIDER_UNAVAILABLE` | `10-flows/second-language-version.md` | утверждён |
| 33 | `translation.translate.manual` (3) | вторая языковая версия вручную | — | — | акт., свои (standard и pro — журнал #33) | свои | — | — | — | ✓ | act, own | — | `FORBIDDEN` | `10-flows/second-language-version.md` | утверждён |
| 34 | `revision.list` / `revision.read` | снимки версий; сравнение двух версий в интерфейсе (журнал #15) | — | — | свои (и после истечения, и для отклонённой) | свои | ✓ | ✓ (карточка автора, аудит) | ✓ | ✓ | own или role | `admin.read.personal` для служебных | `FORBIDDEN` | `50-access/permission-checks.md` | утверждён |
| 35 | `revision.restore` (4) | новая ревизия из старой | — | — | акт., свои | свои | — | — | — | ✓ | act, own | `revision.restore` (не автором) | `FORBIDDEN` | `50-access/permission-checks.md` | утверждён |
| 36 | `reviewNote.create` / `reviewNote.resolve` (4) | замечание к блоку | — | — | resolve свои | — | ✓ | — | — | ✓ | perm(review) / own | — | `FORBIDDEN` | `50-access/permission-checks.md` | утверждён |
| 37 | `article.export` (3) | Markdown/HTML своих, включая отклонённые (чтение и копирование — журнал #12) и после истечения плана | — | — | ✓ свои | свои | — | — | — | ✓ | own | — | `FORBIDDEN` | `50-access/permission-checks.md` | утверждён |
| 38 | `article.bulk.status` | массовые операции над версиями | — | — | — | — | — | — | — | — | — | — | — | — | отменено: массовые операции определяются при проектировании каждого раздела админки (журнал #17) |

## Медиа

| # | Действие (код) | Данные / сущность | Гость | Reader | Author | Editor | Moderator | Analyst | Admin | Owner | Где проверяется | Аудит | Ошибка (код) | Файл политики | Статус |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 39 | `media.upload` | `MediaAsset` статьи с лицензией и атрибуцией; медиа привязано к статье (журнал #28) | — | аватар | акт. (лимит плана) | свои | — | — | — | ✓ | act, plan(mediaQuota), валидация | — | `VALIDATION_ERROR`, `PLAN_LIMIT` | `85-media-and-binary/upload-pipeline.md` | утверждён |
| 40 | `media.update.meta` | alt, подпись, атрибуция, лицензия, фокус | — | — | свои | свои | — | — | — | ✓ | own | — | `FORBIDDEN` | `85-media-and-binary/upload-pipeline.md` | утверждён |
| 41 | `media.delete` | отдельное удаление медиа | — | — | — | — | — | — | — | — | — | — | — | — | отменено: медиа не существует отдельно от статьи; архив статьи закрывает её медиа (журнал #28) |
| 42 | `media.hide` | скрыть по претензии | — | — | — | — | — | — | — | — | — | — | — | — | отложено: жалобы и претензии — отдельный разбор |
| 43 | `media.replace` (4) | заменить файл с сохранением ссылок | — | — | акт., свои | свои | — | — | — | ✓ | own | `media.replace` | `FORBIDDEN` | `85-media-and-binary/upload-pipeline.md` | утверждён |
| 44 | `media.purge` | физическое удаление файлов | — | — | — | — | — | — | — | ✓ («удалить навсегда» статьи — #103) | perm(owner) | `entity.delete.permanent` | `FORBIDDEN` | `10-flows/permanent-delete.md` | утверждён |

## Профиль, сессии, аккаунт

| # | Действие (код) | Данные / сущность | Гость | Reader | Author | Editor | Moderator | Analyst | Admin | Owner | Где проверяется | Аудит | Ошибка (код) | Файл политики | Статус |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 45 | `auth.magicLink.request` | письмо со ссылкой | ✓ (лимит) | — | — | — | — | — | — | — | лимит по e-mail и IP | лог `auth.link.requested` | `RATE_LIMITED` | `50-access/rate-limits.md` | утверждён |
| 46 | `auth.magicLink.verify` | создание сессии; архивированный аккаунт — отказ с указанием поддержки | ✓ по ссылке | — | — | — | — | — | — | — | токен одноразовый; аккаунт не в архиве | лог `auth.login` | `NOT_FOUND`, `FORBIDDEN` | `50-access/session-lifecycle.md` | утверждён |
| 47 | `session.refresh` / `session.logout` / `session.revoke` | `Session` | — | свои | свои | свои | свои | свои | свои | свои | auth, own | лог `auth.session.*` | `UNAUTHENTICATED` | `50-access/session-lifecycle.md` | утверждён |
| 48 | `profile.update` | имя, «о себе», хэндл, аватар, соцсети, язык | — | свои | свои | свои | свои | свои | свои | свои | auth | — | `VALIDATION_ERROR`, `DUPLICATE` | `50-access/permission-checks.md` | утверждён |
| 49 | `email.change` | подтверждение с обоих адресов | — | свои | свои | свои | свои | свои | свои | свои | auth, два токена | `user.email.change` | `CONFLICT` | `10-flows/email-change-and-recovery.md` | утверждён |
| 50 | `email.change.admin` | смена e-mail в рамках восстановления доступа | — | — | — | — | — | — | ✓ (процесс восстановления — журнал §5.2) | ✓ | role(admin) | `user.email.change` | `FORBIDDEN` | `10-flows/email-change-and-recovery.md` | утверждён |
| 51 | `account.archive.self` | «удалить аккаунт» = самостоятельный архив: доступ закрывается сразу, данные сохраняются, статьи архивируются каскадно; восстановить себя нельзя (журнал §5.1–2) | — | свои | свои | свои | свои | свои | свои | свои, если не последний `owner` | auth, письмо; инвариант владельцев | `user.archive.self` | `CONFLICT` (последний владелец) | `10-flows/delete-account.md` | утверждён |
| 52 | `account.archive.admin` | архивирование чужого аккаунта = блокировка: доступ закрыт, сессии отозваны, статьи в архиве каскадно (журнал #4, #30) | — | — | — | — | — (журнал §5.3) | — | ✓ | ✓ | role(admin) | `user.archive` | `FORBIDDEN` | `10-flows/archive-account.md` | утверждён |
| 53 | `account.export` (3) | выгрузка JSON | — | свои | свои | свои | свои | свои | свои | свои | auth | — | — | `30-account/reader/export.md` | утверждён |
| 54 | `consent.accept` | версия оферты и политики ПД | ✓ при входе | ✓ при смене версии | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | версия | — | `VALIDATION_ERROR` | `50-access/session-lifecycle.md` | утверждён |

## Подписка и платежи (финансовый контур — `analyst`, `admin`, `owner`, журнал #19)

| # | Действие (код) | Данные / сущность | Гость | Reader | Author | Editor | Moderator | Analyst | Admin | Owner | Где проверяется | Аудит | Ошибка (код) | Файл политики | Статус |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 55 | `plan.list` | планы и цены | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — | — | — | `70-plans-and-billing/plan-*.md` | утверждён |
| 56 | `checkout.start` | платёж у провайдера; полная стоимость плана, без доплаты (журнал #35) | — | ✓ | ✓ (смена плана) | ✓ | ✓ | ✓ | ✓ | ✓ | auth, «нет активной той же» | лог `checkout.started` | `CONFLICT`, `PROVIDER_UNAVAILABLE` | `70-plans-and-billing/subscription-lifecycle.md` | утверждён |
| 57 | `promo.validate` / `promo.apply` | `PromoCode` на checkout | — | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | auth | — | `NOT_FOUND`, `CONFLICT` | `70-plans-and-billing/grants-and-promo.md` | отложено: механика применения промокодов — отдельный разбор |
| 58 | `subscription.read` | своя подписка, платежи, чеки | — | свои | свои | свои | свои | свои | свои | свои | auth | — | — | `30-account/reader/subscription.md` | утверждён |
| 59 | `subscription.cancel` / `subscription.resume` | отмена с конца периода; возврат к активной | — | свои | свои | свои | свои | свои | свои | свои | auth, own | лог | `CONFLICT` | `70-plans-and-billing/subscription-lifecycle.md` | утверждён |
| 60 | `subscription.changePlan` | standard → pro сразу с отложенным остатком (журнал #24); pro → standard со следующего периода (журнал #23); полная стоимость (журнал #35) | — | — | свои | ✓ | ✓ | ✓ | ✓ | ✓ | auth, own | лог | `CONFLICT` | `70-plans-and-billing/subscription-lifecycle.md` | утверждён |
| 61 | `subscription.admin.grant` / `.change` / `.cancel` | ручная выдача, изменение, отмена подписки пользователя | — | — | — | — | — | ✓ | ✓ | ✓ | perm(finance) | `subscription.grant`, `subscription.change`, `subscription.cancel` (причина, платёжные данные, до/после) | `FORBIDDEN` | `40-admin/subscriptions.md` | утверждён |
| 62 | `payment.refund` | возврат через провайдера; оплаченный период не сокращается (журнал #21) | — | — | — | — | — | ✓ | ✓ | ✓ | perm(finance) | `payment.refund` | `FORBIDDEN`, `CONFLICT` | `70-plans-and-billing/refunds.md` | утверждён |
| 63 | `plan.grant` / `plan.revoke` | `PlanGrant`: выдача плана вручную | — | — | — | — | — | ✓ | ✓ | ✓ | perm(finance), срок обязателен | `plan.grant`, `plan.revoke` | `FORBIDDEN`, `VALIDATION_ERROR` | `70-plans-and-billing/grants-and-promo.md` | утверждён |
| 64 | `promo.create` / `promo.disable` | `PromoCode` | — | — | — | — | — | ✓ | ✓ | ✓ | perm(finance) | `promo.create`, `promo.disable` | `FORBIDDEN`, `DUPLICATE` | `70-plans-and-billing/grants-and-promo.md` | утверждён; механика применения — отложено |
| 65 | `plan.update` | условия и цены планов | — | — | — | — | — | ✓ | ✓ | ✓ | perm(finance) | `plan.update` | `FORBIDDEN` | `40-admin/subscriptions.md` | утверждён |
| 66 | `webhook.psp.receive` / `webhook.replay` | `PspWebhookEvent`; история обработок в разделе «Платежи» | провайдер по подписи | — | — | — | — | — | replay ✓ | replay ✓ | подпись; role(admin) для replay | `webhook.replay` | `FORBIDDEN` | `70-plans-and-billing/payment-provider.md` | утверждён |

## Рейтинг и прочтения (2; параметры — Г4)

| # | Действие (код) | Данные / сущность | Гость | Reader | Author | Editor | Moderator | Analyst | Admin | Owner | Где проверяется | Аудит | Ошибка (код) | Файл политики | Статус |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 67 | `read.beacon` | `ReadEvent` без ПДн | ✓ (лимит) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | фильтр ботов, лимит | метрика `read` | `RATE_LIMITED` | `60-ranking/views-counting.md` | утверждён |
| 68 | `ranking.config.read` | `RankingConfig` | — | — | — | — | — | ✓ | ✓ | ✓ | role | — | `FORBIDDEN` | `40-admin/ranking-config.md` | утверждён |
| 69 | `ranking.config.change` | новая версия весов (значения — Г4) | — | — | — | — | — | — | — (нет прав записи — журнал #13) | ✓ | perm(owner) | `ranking.config.change` | `FORBIDDEN`, `VALIDATION_ERROR` | `40-admin/ranking-config.md` | утверждён |
| 70 | `ranking.recompute` | полный пересчёт | — | — | — | — | — | — | — | ✓ | perm(owner) | `ranking.recompute` | `FORBIDDEN` | `60-ranking/recompute.md` | утверждён |
| 71 | `reads.exclude` / `reads.include` | пометить запись просмотров ошибочной и исключить из расчётов; история сохраняется (журнал #26–27) | — | — | — | — | — | ✓ | ✓ | ✓ | perm(finance) | `reads.exclude` (причина, сотрудник) | `FORBIDDEN` | `60-ranking/anti-fraud.md` | утверждён |
| 72 | `boost.end` | досрочное завершение буста | — | — | — | — | ✓ `[ДОПУЩЕНИЕ]` | — | — | ✓ | perm(review) | `boost.end` | `FORBIDDEN` | `60-ranking/pro-boost.md` | утверждён; правила буста — Г4 |

## AI (бинарная проверка допустимости — журнал #41–42)

| # | Действие (код) | Данные / сущность | Гость | Reader | Author | Editor | Moderator | Analyst | Admin | Owner | Где проверяется | Аудит | Ошибка (код) | Файл политики | Статус |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 73 | `ai.check.run` | автоматически при первой подаче и при повторной подаче после «перередактировать» (журнал #8–9); ручного повтора нет (журнал #14) | — | — | косвенно | косвенно | — | — | — | — | система | лог `ai.job.*`; аудит `ai.decision` (вердикт, причины) | `PROVIDER_UNAVAILABLE` | `40-admin/ai-processes.md` | утверждён |
| 74 | `ai.score.override` | переопределение балла | — | — | — | — | — | — | — | — | — | — | — | — | отменено: AI не выдаёт балл (журнал #41); несогласие ревьюера — ручная публикация (#23) |
| 75 | `ai.jobs.read` | все действия, генерации и ответы AI со статусами (журнал #34) | — | — | свои записи | свои записи | ✓ (своя зона) | — | ✓ | ✓ | role | — | `FORBIDDEN` | `40-admin/ai-processes.md` | утверждён |
| 76 | `ai.settings.change` (4) | провайдер, правила проверки, бюджет | — | — | — | — | — | — | — | ✓ | perm(owner) | `settings.change` | `FORBIDDEN` | `40-admin/system-settings.md` | утверждён; этап 4 (журнал #36) |

## Модерация, жалобы, пользователи

| # | Действие (код) | Данные / сущность | Гость | Reader | Author | Editor | Moderator | Analyst | Admin | Owner | Где проверяется | Аудит | Ошибка (код) | Файл политики | Статус |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 77 | `report.list` / `report.read` | `Report` | — | — | — | — | ✓ | — | ✓ | ✓ | role | — | `FORBIDDEN` | `40-admin/complaints.md` | отложено: жалобы — отдельный разбор |
| 78 | `report.resolve` / `report.dismiss` | резолюция | — | — | — | — | ✓ | — | — | ✓ | perm(moderate) | `report.resolve` | `FORBIDDEN` | `10-flows/complaint.md` | отложено: жалобы — отдельный разбор |
| 79 | `user.block` / `user.unblock` | отдельный режим блокировки | — | — | — | — | — | — | — | — | — | — | — | — | отменено: блокировка = архивирование аккаунта (#52, #105) (журнал #30) |
| 80 | `user.sessions.revoke` | чужие сессии | — | — | — | — | — | — | ✓ | ✓ | role(admin) | `user.sessions.revoke` | `FORBIDDEN` | `50-access/session-lifecycle.md` | утверждён |
| 81 | `user.list` / `user.read.admin` | список и карточки; аналитик — полная индивидуальная картина автора (журнал #11, #22) | — | — | — | — | — | ✓ (аудит) | ✓ (аудит) | ✓ | role | `admin.read.personal` | `FORBIDDEN` | `40-admin/users.md` | утверждён |

## Таксономия (только `admin` и `owner` — журнал #29)

| # | Действие (код) | Данные / сущность | Гость | Reader | Author | Editor | Moderator | Analyst | Admin | Owner | Где проверяется | Аудит | Ошибка (код) | Файл политики | Статус |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 82 | `section.create` / `section.update` / `section.reorder` | `Section` | — | — | — | — | — | — | ✓ | ✓ | perm(taxonomy) | `section.update` | `FORBIDDEN`, `DUPLICATE` | `40-admin/categories.md` | утверждён |
| 83 | `section.archive` / `section.restore` | архив и восстановление рубрики | — | — | — | — | — | — | ✓ | ✓ | perm(taxonomy), FK Restrict | `section.archive`, `section.restore` | `CONFLICT` | `40-admin/categories.md` | утверждён |
| 84 | `format.*` | `Format`: создать, изменить, архивировать, восстановить | — | — | — | — | — | — | ✓ | ✓ | perm(taxonomy) | `format.update` | `FORBIDDEN` | `40-admin/categories.md` | утверждён |
| 85 | `tag.create` | новый тег | — | — | — (выбирает из существующих) | — | — | — | ✓ | ✓ | perm(taxonomy) | `tag.update` | `FORBIDDEN` | `40-admin/tags.md` | утверждён |
| 86 | `tag.merge` / `tag.archive` / `tag.restore` / `tag.rename` | `Tag` | — | — | — | — | — | — | ✓ | ✓ | perm(taxonomy) | `tag.merge`, `tag.archive`, `tag.restore` | `FORBIDDEN` | `40-admin/tags.md` | утверждён |

## Администрирование

| # | Действие (код) | Данные / сущность | Гость | Reader | Author | Editor | Moderator | Analyst | Admin | Owner | Где проверяется | Аудит | Ошибка (код) | Файл политики | Статус |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 87 | `admin.enter` | вход в `/admin`; сводка своей зоны (журнал #38) | — | — | — | ✓ | ✓ | ✓ | ✓ | ✓ | role | лог `admin.enter` | `FORBIDDEN` | `50-access/permission-checks.md` | утверждён |
| 88 | `role.assign` / `role.revoke` для `editor`, `moderator`, `analyst`, `admin` | `User.role` | — | — | — | — | — | — | — (журнал #7, #13) | ✓ | perm(owner) | `user.role.change` | `FORBIDDEN` | `10-flows/appoint-admin.md` | утверждён |
| 89 | `role.assign.admin` / `role.revoke.admin` | — | — | — | — | — | — | — | — | — | — | — | — | — | отменено: объединено с #88 — все служебные роли назначает только `owner` |
| 90 | `role.revoke.self` | снять роль с себя | — | — | — | — | — | — | — | — `[ДОПУЩЕНИЕ]` | запрещено | — | `FORBIDDEN` | `50-access/escalation-and-demotion.md` | утверждён |
| 91 | `owner.transfer` | передача владения | — | — | — | — | — | — | — | — | — | — | — | — | отменено: владельцев несколько; назначение и отзыв — #106 (журнал #10) |
| 92 | `audit.read` | `AuditLog`: служебная роль — своя зона; `admin`, `owner` — полный журнал (журнал #39) | — | — | — | своя зона | своя зона | своя зона | ✓ | ✓ | role | — | `FORBIDDEN` | `40-admin/audit-log.md` | утверждён; этап 1 (журнал #37) |
| 93 | `stats.read` | агрегаты; только успешные платежи и валидные просмотры (журнал #26) | — | — | — | сводка своей зоны | сводка своей зоны | ✓ | ✓ | ✓ | role | — | `FORBIDDEN` | `40-admin/statistics.md` | утверждён |
| 94 | `stats.export` | CSV | — | — | — | — | — | ✓ | ✓ | ✓ | role | `stats.export` | `FORBIDDEN` | `40-admin/statistics.md` | утверждён |
| 95 | `job.list` / `job.retry` / `job.cancel` | общий список заданий; действия — `owner` | — | — | — | — | — | — | list ✓ | ✓ | role | `job.retry`, `job.cancel` | `FORBIDDEN` | `40-admin/jobs.md` | утверждён |
| 96 | `legal.update` (4) | новая версия текста | — | — | — | — | — | — | — | ✓ | perm(owner) | `legal.update` | `FORBIDDEN` | `40-admin/legal-texts.md` | утверждён |
| 97 | `newsletter.*` (4) | выпуски, отправка | — | — | — | — | — | — | — | — | — | — | — | `40-admin/newsletter.md` | отложено: правила рассылок — отдельный разбор |
| 98 | `settings.change` / `secrets.rotate` (4) | провайдеры AI, платежей, почты; домены; ключи (журнал #36) | — | — | — | — | — | — | — | ✓ | perm(owner) | `settings.change`, `secrets.rotate` | `FORBIDDEN` | `40-admin/system-settings.md` | утверждён |
| 99 | `mutation.any` для `analyst` | запрет любых мутаций | — | — | — | — | — | — | — | — | — | — | — | — | отменено: `analyst` входит в финансовый контур с мутациями (журнал #19) |

## Новые строки Г1

| # | Действие (код) | Данные / сущность | Гость | Reader | Author | Editor | Moderator | Analyst | Admin | Owner | Где проверяется | Аудит | Ошибка (код) | Файл политики | Статус |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 100 | `translation.reedit` | одноразовое снятие с публикации в течение 1 часа после автопубликации для доработки; повторная подача — снова через AI (журнал #9) | — | — | акт., свои, один раз | свои, один раз | — | — | — | ✓ | own, окно 1 ч, счётчик = 0 | `translation.reedit` | `FORBIDDEN` (окно закрыто или использовано) | `10-flows/write-and-publish.md` | утверждён |
| 101 | `translation.reject.final` | окончательный отказ: статья помечена «отклонена редакцией», автор читает и копирует, не редактирует (журнал #12, #14) | — | — | — | — | ✓ | — | — | ✓ | perm(review) | `translation.reject.final` с причиной | `FORBIDDEN` | `10-flows/moderation.md` | утверждён |
| 102 | `review.message` | сообщение ревьюера автору в истории переписки по статье: решение, причина или рекомендации, автор, время (журнал #16) | — | — | чтение своих | чтение своих | ✓ | — | чтение | ✓ | perm(review) | `review.message` | `FORBIDDEN` | `10-flows/moderation.md` | утверждён |
| 103 | `entity.delete.permanent` | необратимое удаление любой сущности (статья, категория, тег, пользователь, администратор и другие) после диалога с вводом имени (журнал #1) | — | — | — | — | — | — | — | ✓ | perm(owner), ввод имени | `entity.delete.permanent` | `FORBIDDEN`, `VALIDATION_ERROR` | `10-flows/permanent-delete.md` | утверждён |
| 104 | `user.read.personal.audited` | чтение персональных данных через административный инструмент — событие аудита с актором, временем, чьи данные, контекстом (журнал #6, #22) | — | — | — | — | — | ✓ | ✓ | ✓ | role | `admin.read.personal` | — | `50-access/visibility.md` | утверждён |
| 105 | `account.restore.admin` | восстановление архивированного аккаунта; статьи остаются в архиве (журнал §5.3–4) | — | — | — | — | — | — | ✓ | ✓ | role(admin) | `user.restore` | `FORBIDDEN` | `10-flows/archive-account.md` | утверждён |
| 106 | `role.assign.owner` / `role.revoke.owner` / `owner.deactivate` | назначить другого `owner`; отозвать роль или деактивировать доступ другого `owner`; не ноль владельцев (журнал #10) | — | — | — | — | — | — | — | ✓ | perm(owner), инвариант ≥ 1 | `role.assign.owner`, `role.revoke.owner` | `FORBIDDEN`, `CONFLICT` | `10-flows/appoint-admin.md` | утверждён |
| 107 | `permission.exception.grant` / `.revoke` | индивидуальное право служебной роли (в том числе право публикации для `admin`); не для `reader` и `author` (журнал #7–8) | — | — | — | — | — | — | — | ✓ | perm(owner) | `permission.exception.grant`, `permission.exception.revoke` | `FORBIDDEN` | `50-access/permission-exceptions.md` | утверждён; формат запроса и согласования — не регламентирован (журнал #18) |
| 108 | `payment.exclude` / `payment.include` | пометить платёж ошибочным и исключить из аналитики без удаления (журнал #26–27) | — | — | — | — | — | ✓ | ✓ | ✓ | perm(finance) | `payment.exclude` (причина, сотрудник) | `FORBIDDEN` | `70-plans-and-billing/refunds.md` | утверждён |
| 109 | `subscription.extend.manual` | ручная выдача дополнительных дней — прибавляются к концу действующего периода (журнал #25) | — | — | — | — | — | ✓ | ✓ | ✓ | perm(finance) | `subscription.extend.manual` | `FORBIDDEN` | `40-admin/subscriptions.md` | утверждён |
| 110 | `article.read.rejected` | чтение и копирование отклонённой редакцией статьи | — | — | свои | свои | ✓ | ✓ (аудит) | ✓ | ✓ | own или role | — | `FORBIDDEN` | `10-flows/moderation.md` | утверждён |

## Инварианты, которые матрица не выражает (проверяются политиками)

- Посетитель и читатель никогда не получают `FORBIDDEN` на чужие черновики — только `NOT_FOUND`.
- `author` без активной подписки получает `PLAN_LIMIT` с указанием плана; интерфейс ведёт на
  `/pricing` (журнал #5).
- Первая попытка публикации любой статьи, включая редакционную, идёт через AI-проверку;
  человеческого `approve` перед первой публикацией нет (журнал #8).
- Низшая роль не отменяет архивирование, выполненное высшей; у каждого архива хранятся актор и
  уровень прав (журнал #2).
- Скрытие кнопки не заменяет проверку прав на сервере (журнал §7.4).
- Система не допускает нуля владельцев (журнал #10).

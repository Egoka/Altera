# Реестр разделов админки

- **Заход**: 1 (2026-09-06). **Основание**: `docs/vision/02-target-architecture.md` §4.3,
  `04-roles-and-access.md` §2.3–2.4, ADR-0039, ADR-0042, ADR-0045; `routes.md` #41–60.
  Колонки — `README.md`.
- Минимальная роль — по иерархии `editor < moderator < admin < owner`; `analyst` — отдельная
  колонка (ADR-0042). «Read-only для analyst»: да — раздел открыт без действий; нет — открыт с
  действиями по роли; недоступен — не показывается.
- Аудит: коды `action` из `04-roles-and-access.md` §5 и `events-and-logs.md`.

## Обязательные для запуска (этап 1)

| # | Раздел | Маршрут | Минимальная роль | Read-only для analyst | Сущности | Массовые операции | Опасные операции | Аудит (коды action) | Файл | Этап | Статус |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | Сводка | `/admin` | editor | да | очередь (число и возраст), новые регистрации, оплаты, жалобы, задания AI, здоровье | — | — | — | `40-admin/dashboard.md` | 1 | на утверждении |
| 2 | Категории (рубрики и форматы) | `/admin/sections` | editor | недоступен | `Section`, `Format` | изменить порядок | архивировать рубрику с материалами (только после переназначения) | `section.update`, `section.archive`, `format.update` | `40-admin/categories.md` | 1 | на утверждении |
| 3 | Теги | `/admin/tags` | editor (moderator — слияние и удаление) | недоступен | `Tag` | слить, удалить | удалить тег с материалами (каскад по join) | `tag.merge`, `tag.delete` | `40-admin/tags.md` | 1 | на утверждении |
| 4 | Статьи | `/admin/articles` | editor | недоступен | `Article`, `ArticleTranslation`, `ArticleRevision` | архивировать, сменить рубрику/теги | снять с публикации с причиной; удалить никогда не публиковавшийся; любой переход статуса (admin) | `translation.unpublish`, `translation.status.set`, `article.delete` | `40-admin/articles.md` | 1 | на утверждении |
| 5 | Очередь проверки | `/admin/review` | moderator (editor — правка текста) | недоступен | `ArticleTranslation` в `review`, `ArticleAiReview`, `ArticleRevision` | — (решение только поштучно) | одобрить (публикация), вернуть с причиной, переопределить AI-оценку | `translation.approve`, `translation.reject`, `ai.score.override` | `40-admin/review-queue.md` | 1 | на утверждении |
| 6 | Пользователи | `/admin/users` | moderator (без e-mail; e-mail — admin) | недоступен | `User`, `Session`, `Subscription`, `PlanGrant` | — | блокировка, разблокировка, отзыв сессий, анонимизация по запросу, смена e-mail по процедуре | `user.block`, `user.unblock`, `user.sessions.revoke`, `user.delete`, `user.email.change` | `40-admin/users.md` | 1 | на утверждении |
| 7 | Администраторы | `/admin/admins` | admin (назначение `admin` — owner) | недоступен | `User.role` для admin-ролей | — | назначить/снять роль, передать владение (двустороннее подтверждение) | `user.role.change`, `owner.transfer` | `40-admin/admins.md` | 1 | на утверждении |
| 8 | Подписки | `/admin/subscriptions` | admin | да (агрегаты, без пользователей) | `Subscription`, `Customer`, `Plan` | — | отменить подписку, сменить план вручную, продлить бесплатно | `subscription.cancel`, `subscription.change`, `plan.update` | `40-admin/subscriptions.md` | 1 | на утверждении |
| 9 | Платежи и возвраты | `/admin/payments` | admin | да (суммы без пользователей) | `Payment`, `PspWebhookEvent` | — | возврат (полный/частичный), повторная обработка вебхука | `payment.refund`, `webhook.replay` | `40-admin/payments-and-refunds.md` | 1 | на утверждении |
| 10 | Гранты и промокоды | `/admin/grants` | admin | недоступен | `PlanGrant`, `PromoCode` | деактивировать промокоды | выдать/отозвать грант, создать промокод без лимита | `plan.grant`, `plan.revoke`, `promo.create`, `promo.disable` | `40-admin/grants-and-promo.md` | 1 | на утверждении |
| 11 | Статистика | `/admin/statistics` | analyst (и moderator+) | да | агрегаты: регистрации, оплаты, MRR, публикации, очередь, прочтения (2), рейтинг (2), AI-стоимость | экспорт CSV | — | `stats.export` | `40-admin/statistics.md` | 1 | на утверждении |
| 12 | Жалобы | `/admin/reports` | moderator | недоступен | `Report`, `ArticleTranslation`, `MediaAsset` | закрыть как дубликаты | резолюция со снятием материала или скрытием изображения | `report.resolve`, `translation.unpublish`, `media.hide` | `40-admin/complaints.md` | 1 | на утверждении |
| 13 | Фоновые задания | `/admin/jobs` | admin | недоступен | очередь заданий: AI-проверки, переводы (3), пересчёт рейтинга (2), продления, письма | повторить неудачные | отменить задание, очистить очередь | `job.retry`, `job.cancel` | `40-admin/jobs.md` | 1 | на утверждении |

## Этап 2

| # | Раздел | Маршрут | Минимальная роль | Read-only для analyst | Сущности | Массовые операции | Опасные операции | Аудит | Файл | Этап | Статус |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 14 | AI-оценки | `/admin/ai-reviews` | moderator | да (агрегаты вердиктов и стоимости) | `ArticleAiReview`, `ArticleRevision` | повторить оценку для выбранных | переопределить балл; повтор оценки (стоимость) | `ai.score.override`, `ai.review.rerun` | `40-admin/ai-reviews.md` | 2 | на утверждении |
| 15 | Конфигурация рейтинга | `/admin/ranking` | admin | да | `RankingConfig`, `ArticleScore` (разложение), `ReadExclusion`, `ArticleBoost` | исключить дни прочтений для выбранных материалов | изменить веса (новая версия), полный пересчёт, завершить буст досрочно | `ranking.config.change`, `ranking.recompute`, `reads.exclude`, `boost.end` | `40-admin/ranking-config.md` | 2 | на утверждении |

## Этап 4

| # | Раздел | Маршрут | Минимальная роль | Read-only для analyst | Сущности | Массовые операции | Опасные операции | Аудит | Файл | Этап | Статус |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 16 | Аудит | `/admin/audit` | moderator | недоступен | `AuditLog` | экспорт CSV по фильтру | — (только чтение) | — | `40-admin/audit-log.md` | 4 | на утверждении |
| 17 | Медиа-библиотека | `/admin/media` | editor | недоступен | `MediaAsset` | пометить к удалению, сменить лицензию | заменить файл, физически удалить неиспользуемые, скрыть по претензии | `media.replace`, `media.delete`, `media.hide` | `40-admin/media-library.md` | 4 | на утверждении |
| 18 | Юридические тексты | `/admin/legal` | admin | недоступен | тексты с версиями, согласия | — | опубликовать новую версию (повторное согласие у всех) | `legal.update` | `40-admin/legal-texts.md` | 4 | на утверждении |
| 19 | Рассылка | `/admin/newsletter` | editor | да (счётчики) | `NewsletterIssue`, `NewsletterSubscriber` (счётчики) | — | отправить выпуск | `newsletter.send` | `40-admin/newsletter.md` | 4 | на утверждении |
| 20 | Настройки системы | `/admin/settings` | owner | недоступен | провайдеры (платежи, AI, почта, S3), домены, пороги AI, лимиты, бюджет AI | — | смена провайдера, ротация ключей | `settings.change`, `secrets.rotate` | `40-admin/system-settings.md` | 4 | на утверждении |

## Предложено сверх обязательного (владелец просил предложить)

| Раздел (№ выше) | Название | Обоснование в одну строку |
|---|---|---|
| №10 | Гранты и промокоды | Без ручного гранта нельзя завести редакцию и партнёров до оплаты; промокоды — единственный инструмент скидки (ADR-0035) |
| №13 | Фоновые задания | AI-проверка, продления и пересчёт живут в очереди в базе; без экрана застрявшее задание видно только в логах |
| №19 | Рассылка | Была в ревизии 1 (этап 5), сохраняется как инструмент возврата читателей (ADR-0026) |
| №20 | Настройки системы | Провайдеры, пороги AI и бюджет — параметры, а не код; менять должен владелец, а не деплой |

Разделы, которые могут понадобиться позже и **не** внесены: экспорт данных пользователя по
152-ФЗ (пока — через `users` и скрипт), история пересчётов рейтинга (внутри #15), здоровье
системы (внутри #1 и `/health`).

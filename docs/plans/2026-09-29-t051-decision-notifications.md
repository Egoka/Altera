# T-051: уведомления автору о решениях по статье по e-mail

**Цель:** автор получает письмо при автопубликации, отказе AI, запросе доработки, ручной
публикации, окончательном отказе и снятии с публикации; письмо о доработке и о снятии несёт
ссылку `edit?token=`; язык письма — язык аккаунта.

**Источник:** `docs/backlog/tasks/T-051-decision-notifications-email.md`,
`docs/spec/10-flows/write-and-publish.md` §6, `docs/spec/10-flows/moderation.md` §6,
`docs/spec/00-registries/routes.md` #68, ADR-0024.

**Стек:** уже принятый модуль почты T-021 (`server/src/mail/service.ts`), переходы T-049
(`server/src/review/queue.ts`, `server/src/ai/service.ts`).

## Соответствие решений и писем (по спецификации)

| Решение             | Письмо / шаблон            | Ссылка                                |
| ------------------- | -------------------------- | ------------------------------------- |
| Автопубликация (AI) | `article_published`        | публичная страница                    |
| Отказ AI            | `article_ai_rejected`      | `/me/articles/{id}/review`            |
| Запрос доработки    | `article_rework_requested` | `/me/articles/{id}/edit?token=` (#68) |
| Ручная публикация   | `article_published_manual` | публичная страница                    |
| Окончательный отказ | `article_rejected_final`   | `/me/articles/{id}/review`            |
| Снятие с публикации | `article_unpublished`      | `/me/articles/{id}/edit?token=` (#68) |

## Границы

- Входит: отправка писем из уже свершившихся переходов T-049, запись в историю писем (T-021),
  ссылка с токеном для доработки/снятия.
- Не входит: шаблоны как продуктовый текст (все шесть — `[ДОПУЩЕНИЕ]` до прохода почты, журнал
  §25.13), частота, согласия (F-05), страница `/me/articles/{id}/edit`, которая читает `?token=`
  (редактор не начат — она появится вместе с ним).

## Архитектура

- `server/src/mail/messages.ts` — шесть пар писем ru/en; у доработки и снятия — пара
  `{message, sanitizedBody}` с плейсхолетом вместо токена в копии истории (как у magic-link).
- `server/src/mail/article-notifications.ts` — `notifyArticleDecision(deps, input)`: сама
  загружает перевод, рубрику и автора по `translationId`, строит письмо и вызывает
  `mail.send`. Для доработки/снятия сама выдаёт токен (см. ниже) и собирает ссылку. Ошибка
  транспорта не выходит наружу — `mail.send` уже пишет `mail.failed` и историю письма, откатывать
  здесь нечего.
- Токен ссылки — два новых поля на `ArticleTranslation` (`editTokenHash`, `editTokenExpiresAt`),
  не отдельная таблица и не тот же `MagicLinkToken`: `MagicLinkToken` уникален по адресу
  (`docs/spec/20-public/login.md` §7) и его перевыпуск отозвал бы не связанный вход того же
  автора. Срок — семь дней `[ДОПУЩЕНИЕ]` (`moderation.md` §8), один активный токен на версию.
- Вызовы: `requestReviewRework`, `publishReviewManual`, `rejectReviewFinal`, `unpublishReview`
  (`server/src/review/queue.ts`) — после фиксации транзакции. Для AI —
  `AiCheckServiceOptions.onDecision` (`server/src/ai/service.ts`), новый колбэк рядом с
  `onPublished`: вызывается ровно один раз на реальном переходе (`transitioned`), а не на повторной
  обработке уже завершённого задания (журнал #14) — иначе повтор задания слал бы письмо дважды.

## Проверяемые риски

- Повтор `runCheck` уже завершённого задания не должен создать второе письмо решения.
- Копия письма в истории не должна содержать токен ссылки.
- Локаль письма должна идти по локали аккаунта автора, а не по локали версии статьи.
- Сбой транспорта не должен откатить уже применённое решение (не бросать наружу из мутации).

## Проверка

`pnpm format`, `pnpm lint`, `pnpm --filter server test`, `pnpm --filter server run build:ci`.

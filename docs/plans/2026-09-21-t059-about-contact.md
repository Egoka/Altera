# План T-059: «О проекте» и «Письмо в редакцию» с обращениями в поддержку

- **Задача**: `docs/backlog/tasks/T-059-about-and-contact.md`
  (file SHA `c241a3bf14ff8724d2e0d4380ec3b3b94b083b8b`)
- **Native issue**: ALTE-111 (`01a0c225-9782-7011-bdee-512631a79291`)
- **Эпик**: E-09 «Публичные страницы»
- **Baseline `origin/app`**: `a959d15160b61bed6579aab87602225c090c0b65`
- **Ветка**: `feat/t059-about-contact`, worktree `.worktrees/t059-about-contact`
- **Источники**: журнал §20.15, §21.18, §24.1, §28.4; `docs/spec/20-public/about.md`,
  `docs/spec/20-public/contact.md`, `docs/spec/20-public/not-found.md` §4,
  `docs/spec/80-observability/request-tracing.md` п. 4–5, `docs/spec/50-access/rate-limits.md`
  §2 п. 4, реестры `access-matrix.md` #117 и `events-and-logs.md` #80

## Что уже есть и чего нет

Зависимости в `app`: корзины `contact.ip` (3 в час) и `contact.user` (10 в сутки) записаны в
`server/src/rate-limits/policy.ts`, но точки применения нет (T-024); служба писем
`createMailService` с историей `/admin/mail` (T-021); механизм версий текстов `LegalText` с видом
`about` и раздел `/admin/legal` (T-101, T-083). Страница 404 (T-058) уже отправляет
`createSupportRequest` строкой — мутации в схеме нет, поэтому кнопка сейчас всегда отвечает
отказом. Страниц `/about` и `/contact` нет; ссылки на них уже стоят в футере, на 404 и 500.

## Что делаю

### Сервер

1. Модель `SupportRequest` и перечисление `SupportTopic` с миграцией: тема, адрес ответа, текст,
   путь без query, переданный `requestId`, аккаунт, локаль, номер обращения `ticketNo`.
2. `server/src/support/requests.ts` — валидация (текст 20–4000 знаков, адрес и согласие гостя,
   анонимная «битая ссылка» без адреса), лимит `contact.user` после валидации, запись, лог
   `support.request.created` (#80) без ПДн, уведомление `admin`/`owner` через службу писем.
   Отказ почты обращение не отменяет.
3. `createSupportRequest` в GraphQL; `contact.ip` применяет middleware до резолвера.
4. `staticText(kind: about, locale)` — тем же чтением, что `legalText`, с кешем по тегу вида.
5. `/about` и `/contact` добавляются в `sitemap.xml`.

### Веб

1. `/contact`: форма `ContactForm` по зонам §5, предзаполнение из `?topic=`, `?path=`,
   `?requestId=`, аккаунт — с адресом сессии, архивированная запись — как гость; строки §8.
2. `/about`: статические зоны 2, 3, 7, текст владельца (зоны 5–6) из `staticText`, непустые
   рубрики; ссылка «редактировать» для `owner`; строки §8.
3. Кнопка 404 переходит на сгенерированный документ операции.

### Проверки

Unit-тесты сервера и веба, Playwright-сценарий `web/tests/e2e/59-about-contact.spec.ts`,
format, lint, test, codegen, typecheck, `build:ci`, web build.

## Чего не делаю

Текст «О проекте» и список «что не работает» (OPEN-QUESTIONS #1, Q-08), статус обращения в
кабинете (OPEN-QUESTIONS #2), экран очереди обращений в админке (Q-08). Реквизиты и адрес
редакции (`contactInfo`) — факты владельца, которых нет в журнале: не выдумываются.

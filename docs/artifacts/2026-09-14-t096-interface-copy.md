# Артефакт T-096: тексты интерфейса, писем первичного потока и правил публикации

- **Задача**: ALTE-8 / T-096
- **Дата**: 2026-09-14
- **Источники**: журнал §24.3, §25.13; `docs/spec/10-flows/register-and-login.md`; `docs/spec/20-public/legal-content-rules.md`; `docs/vision/01-product.md`
- **Назначение артефакта**: для переноса в словари `web/i18n/locales/en.json` и `web/i18n/locales/ru.json` — работа выполняется в отдельной задаче

---

## 1. Глоссарий

Ключевые термины, которые используются в интерфейсе и должны быть согласованными во всех строках.

| Термин (ru) | Термин (en) | Комментарий |
|---|---|---|
| Материал | Article | Текст с метаданными, содержащий одну или несколько языковых версий |
| Языковая версия | Language version | Русская или английская версия материала |
| Ревизия | Revision | Снимок языковой версии; все изменения сохраняются |
| Рубрика | Category | Тема материала; список ведёт редакция |
| Формат | Format | Жанр: эссе, обзор, фоторепортаж, интервью, колонка |
| Тег | Tag | Свободное слово автора |
| Читатель | Reader | Аккаунт с бесплатным доступом (план free) |
| Автор | Author | Аккаунт, открывший авторские возможности |
| Ревьюер | Reviewer | Сотрудник, выполняющий ручную проверку материалов |
| Закладка | Bookmark | Приватное сохранение материала аккаунтом |
| Ссылка входа | Login link | Одноразовая ссылка для входа или регистрации, доставляемая письмом |
| Проверка | Review | Двухступенчатая проверка материала: AI, затем человек |
| Архив | Archive | Статус аккаунта; публичные материалы скрыты |
| Оспаривание | Appeal | Форма обращения к редакции по поводу блокировки аккаунта |
| Согласие | Consent | Принятие текущих версий оферты и политики персональных данных |

---

## 2. Страница входа `/login`

### 2.1 Основное состояние

**ru**

```
auth.login.title = Войти или зарегистрироваться
auth.login.emailLabel = Адрес электронной почты
auth.login.emailPlaceholder = your@email.com
auth.login.consentLabel = Я принимаю условия {offertaLink} и {privacyLink}
auth.login.consentOfferta = оферты
auth.login.consentPrivacy = политики персональных данных
auth.login.submitButton = Получить ссылку входа
auth.login.hint = На ваш адрес придёт письмо со ссылкой. Ссылка действует 15 минут и одноразовая.
```

**en**

```
auth.login.title = Sign in or register
auth.login.emailLabel = Email address
auth.login.emailPlaceholder = your@email.com
auth.login.consentLabel = I accept the {offertaLink} and {privacyLink}
auth.login.consentOfferta = terms of service
auth.login.consentPrivacy = privacy policy
auth.login.submitButton = Get login link
auth.login.hint = You will receive an email with a login link. The link is valid for 15 minutes and can only be used once.
```

### 2.2 Состояние после отправки (ссылка запрошена)

**ru**

```
auth.login.sent.title = Проверьте почту
auth.login.sent.body = Мы отправили ссылку входа на {email}. Откройте письмо и перейдите по ссылке — она действует 15 минут.
auth.login.sent.notReceived = Не получили письмо?
auth.login.sent.retry = Запросить снова
```

**en**

```
auth.login.sent.title = Check your email
auth.login.sent.body = We sent a login link to {email}. Open the email and follow the link — it is valid for 15 minutes.
auth.login.sent.notReceived = Didn't receive the email?
auth.login.sent.retry = Request again
```

### 2.3 Ошибки валидации и лимитов

**ru**

```
auth.login.error.invalidEmail = Введите корректный адрес электронной почты
auth.login.error.consentRequired = Необходимо принять условия оферты и политики персональных данных
auth.login.error.rateLimited = Слишком много запросов. Попробуйте через {retryAfter}.
auth.login.error.providerUnavailable = Письмо не удалось отправить. Попробуйте позже.
auth.login.error.generic = Что-то пошло не так. Попробуйте ещё раз (код: {requestId})
```

**en**

```
auth.login.error.invalidEmail = Please enter a valid email address
auth.login.error.consentRequired = You must accept the terms of service and privacy policy
auth.login.error.rateLimited = Too many requests. Please try again in {retryAfter}.
auth.login.error.providerUnavailable = The email could not be sent. Please try again later.
auth.login.error.generic = Something went wrong. Please try again (code: {requestId})
```

---

## 3. Страница подтверждения `/auth/verify`

### 3.1 Состояние ожидания (ссылка корректна, идёт вход)

**ru**

```
auth.verify.loading.title = Входим в систему…
auth.verify.loading.body = Пожалуйста, подождите.
```

**en**

```
auth.verify.loading.title = Signing you in…
auth.verify.loading.body = Please wait.
```

### 3.2 Ссылка недействительна (истекла или уже использована)

**ru**

```
auth.verify.expired.title = Ссылка недействительна
auth.verify.expired.body = Ссылка входа истекла или уже была использована. Ссылка действует 15 минут и подходит только для одного входа.
auth.verify.expired.action = Запросить новую ссылку
```

**en**

```
auth.verify.expired.title = Link is not valid
auth.verify.expired.body = The login link has expired or has already been used. Links are valid for 15 minutes and can only be used once.
auth.verify.expired.action = Request a new link
```

### 3.3 Согласие устарело

**ru**

```
auth.verify.consent.title = Обновите согласие
auth.verify.consent.body = Условия использования или политика персональных данных обновились с момента вашей последней сессии. Пожалуйста, ознакомьтесь с новыми версиями.
auth.verify.consent.offertaLink = Условия использования
auth.verify.consent.privacyLink = Политика персональных данных
auth.verify.consent.accept = Принять и продолжить
```

**en**

```
auth.verify.consent.title = Update your consent
auth.verify.consent.body = The terms of service or privacy policy have been updated since your last session. Please review the new versions.
auth.verify.consent.offertaLink = Terms of service
auth.verify.consent.privacyLink = Privacy policy
auth.verify.consent.accept = Accept and continue
```

### 3.4 Общая ошибка

**ru**

```
auth.verify.error.title = Ошибка входа
auth.verify.error.body = Не удалось выполнить вход. Попробуйте ещё раз (код: {requestId})
auth.verify.error.action = Вернуться к входу
```

**en**

```
auth.verify.error.title = Sign-in error
auth.verify.error.body = We were unable to sign you in. Please try again (code: {requestId})
auth.verify.error.action = Back to sign in
```

---

## 4. Страница архивированного аккаунта `/me/archived`

Состояние: аккаунт заархивирован самим пользователем (ветка `self`). Ограниченная сессия.

**ru**

```
account.archived.title = Аккаунт в архиве
account.archived.body = Ваш аккаунт деактивирован. Ваши материалы скрыты для читателей и не появляются в выдаче. Вы можете восстановить аккаунт в любой момент.
account.archived.restore = Восстановить аккаунт
account.archived.restoreNote = После восстановления аккаунт станет активным. Материалы остаются в архиве — их нужно вернуть к публикации отдельно.
```

**en**

```
account.archived.title = Account archived
account.archived.body = Your account is deactivated. Your articles are hidden from readers and do not appear in the feed. You can restore your account at any time.
account.archived.restore = Restore account
account.archived.restoreNote = After restoring, your account will be active again. Your articles remain archived — you will need to republish them separately.
```

---

## 5. Страница оспаривания блокировки `/auth/appeal`

Состояние: аккаунт заблокирован администратором или редакцией. Сессии нет.

**ru**

```
account.appeal.title = Аккаунт заблокирован
account.appeal.body = Ваш аккаунт заблокирован. Если вы считаете, что это ошибка, заполните форму — редакция рассмотрит обращение.
account.appeal.namePlaceholder = Ваше имя (необязательно)
account.appeal.messagePlaceholder = Опишите ситуацию и почему вы считаете блокировку ошибочной
account.appeal.submit = Отправить обращение
account.appeal.sent.title = Обращение отправлено
account.appeal.sent.body = Мы получили ваше обращение и рассмотрим его. Ответ придёт на адрес {email}.
```

**en**

```
account.appeal.title = Account blocked
account.appeal.body = Your account has been blocked. If you believe this is an error, please fill out the form — our team will review your appeal.
account.appeal.namePlaceholder = Your name (optional)
account.appeal.messagePlaceholder = Describe the situation and why you believe the block is a mistake
account.appeal.submit = Submit appeal
account.appeal.sent.title = Appeal submitted
account.appeal.sent.body = We have received your appeal and will review it. A response will be sent to {email}.
```

---

## 6. Письма первичного потока

### 6.1 Письмо со ссылкой входа (magic link)

Отправляется на шаге 1 флоу входа/регистрации.

**ru**

```
mail.magicLink.subject = Ссылка входа в Altera
mail.magicLink.preheader = Ваша одноразовая ссылка для входа
mail.magicLink.body = Здравствуйте,\n\nвы запросили ссылку входа в Altera. Перейдите по кнопке ниже — она действует 15 минут и подходит только для одного входа.\n\nЕсли вы не запрашивали ссылку — просто проигнорируйте это письмо.
mail.magicLink.button = Войти в Altera
mail.magicLink.expiry = Ссылка действует 15 минут.
mail.magicLink.footer = Altera — журнал о жизни.
```

**en**

```
mail.magicLink.subject = Your Altera login link
mail.magicLink.preheader = Your one-time sign-in link
mail.magicLink.body = Hello,\n\nyou requested a login link for Altera. Click the button below — it is valid for 15 minutes and can only be used once.\n\nIf you did not request this, you can safely ignore this email.
mail.magicLink.button = Sign in to Altera
mail.magicLink.expiry = This link expires in 15 minutes.
mail.magicLink.footer = Altera — a journal about life.
```

### 6.2 Уведомление о входе с нового устройства

`[ДОПУЩЕНИЕ из spec]` — решение о фактической отправке — в §25.13 (проход почты).

**ru**

```
mail.newDevice.subject = Вход в Altera с нового устройства
mail.newDevice.preheader = Кто-то вошёл в ваш аккаунт
mail.newDevice.body = Здравствуйте,\n\nв ваш аккаунт Altera только что выполнен вход. Если это были вы — всё в порядке.\n\nЕсли нет — перейдите в настройки безопасности и завершите подозрительные сессии.
mail.newDevice.device = Устройство: {device}
mail.newDevice.browser = Браузер: {browser}
mail.newDevice.time = Время: {datetime}
mail.newDevice.action = Управление сессиями
mail.newDevice.footer = Altera — журнал о жизни.
```

**en**

```
mail.newDevice.subject = New sign-in to your Altera account
mail.newDevice.preheader = Someone signed into your account
mail.newDevice.body = Hello,\n\nsomeone just signed into your Altera account. If this was you — all is well.\n\nIf not — go to your security settings and end any suspicious sessions.
mail.newDevice.device = Device: {device}
mail.newDevice.browser = Browser: {browser}
mail.newDevice.time = Time: {datetime}
mail.newDevice.action = Manage sessions
mail.newDevice.footer = Altera — a journal about life.
```

---

## 7. Правила публикации — раздел общих категорий причин отказа

Источник: журнал §24.3, `docs/spec/20-public/legal-content-rules.md`.

Этот раздел описывает **общие критические категории** причин отказа статьи. При каждом конкретном отказе автор получает объяснение в кабинете: автоматическая проверка формирует текст причины; рецензент при своём отказе может добавить комментарий. Точные пороги, внутренние признаки и логика проверки не публикуются.

### 7.1 Текст раздела «Причины отказа» для страницы `/legal/content-rules`

**ru**

```
legal.contentRules.decisionCategories.heading = Категории причин отказа
legal.contentRules.decisionCategories.intro = При каждом отказе вы получаете объяснение в личном кабинете — автоматическая проверка формирует текст причины, рецензент может добавить комментарий. Ниже перечислены общие категории нарушений, которые приводят к отказу.

legal.contentRules.decisionCategories.copyright.title = Нарушение авторских прав
legal.contentRules.decisionCategories.copyright.body = Использование чужих текстов или изображений без разрешения правообладателя и без указания источника и лицензии.

legal.contentRules.decisionCategories.illegal.title = Незаконный контент
legal.contentRules.decisionCategories.illegal.body = Материалы, нарушающие действующее законодательство: в том числе призывы к насилию, пропаганда дискриминации, материалы сексуальной эксплуатации.

legal.contentRules.decisionCategories.spam.title = Спам и скрытая реклама
legal.contentRules.decisionCategories.spam.body = Материалы, основная цель которых — продвижение товаров, услуг или ссылок без редакционной ценности; скрытая коммерческая реклама.

legal.contentRules.decisionCategories.personalData.title = Персональные данные третьих лиц
legal.contentRules.decisionCategories.personalData.body = Публикация личной информации о людях без их согласия: адреса, телефоны, идентификационные данные.

legal.contentRules.decisionCategories.ageRestricted.title = Контент с возрастными ограничениями
legal.contentRules.decisionCategories.ageRestricted.body = Материалы, предназначенные только для совершеннолетних и не отмеченные соответствующим образом, или контент, недопустимый в журнале по возрастным критериям.

legal.contentRules.decisionCategories.offTopic.title = Несоответствие теме и правилам журнала
legal.contentRules.decisionCategories.offTopic.body = Материалы, не относящиеся к тематике журнала или противоречащие его редакционным стандартам.

legal.contentRules.decisionCategories.howToLearn = Как узнать точную причину
legal.contentRules.decisionCategories.howToLearnBody = После каждого отказа вы получаете объяснение в разделе «История решений» вашего кабинета. Рецензент может добавить комментарий к своему решению.
```

**en**

```
legal.contentRules.decisionCategories.heading = Refusal categories
legal.contentRules.decisionCategories.intro = After each refusal you will receive an explanation in your account — the automated review generates the reason text, and the reviewer may add a comment. The general categories of violations that lead to a refusal are listed below.

legal.contentRules.decisionCategories.copyright.title = Copyright infringement
legal.contentRules.decisionCategories.copyright.body = Use of others' texts or images without the rights holder's permission and without attribution or a licence.

legal.contentRules.decisionCategories.illegal.title = Illegal content
legal.contentRules.decisionCategories.illegal.body = Content that violates applicable law, including incitement to violence, hate speech, and sexually exploitative material.

legal.contentRules.decisionCategories.spam.title = Spam and covert advertising
legal.contentRules.decisionCategories.spam.body = Content whose primary purpose is to promote products, services, or links without editorial value; undisclosed commercial advertising.

legal.contentRules.decisionCategories.personalData.title = Third-party personal data
legal.contentRules.decisionCategories.personalData.body = Publication of personal information about individuals without their consent: addresses, phone numbers, identification data.

legal.contentRules.decisionCategories.ageRestricted.title = Age-restricted content
legal.contentRules.decisionCategories.ageRestricted.body = Content intended only for adults and not labelled accordingly, or content that does not meet the journal's age-appropriateness standards.

legal.contentRules.decisionCategories.offTopic.title = Off-topic or against editorial standards
legal.contentRules.decisionCategories.offTopic.body = Content that is unrelated to the journal's topics or that does not meet its editorial standards.

legal.contentRules.decisionCategories.howToLearn = How to find out the specific reason
legal.contentRules.decisionCategories.howToLearnBody = After each refusal you will receive an explanation in the "Review history" section of your account. The reviewer may add a comment to their decision.
```

---

## 8. Таблица покрытия

Каждая страница и каждое письмо первичного потока × наличие утверждённых текстов состояний.

| Страница / письмо | Маршрут / тип | Состояния | Покрыто в этом артефакте |
|---|---|---|---|
| Страница входа | `/login` | Основное, после отправки, ошибка валидации, rate limit, провайдер недоступен, общая ошибка | ✓ |
| Страница подтверждения | `/auth/verify` | Ожидание, ссылка недействительна, согласие устарело, общая ошибка | ✓ |
| Страница архивированного аккаунта | `/me/archived` | Основное, восстановление | ✓ |
| Страница оспаривания блокировки | `/auth/appeal` | Основное (форма), успешная отправка | ✓ |
| Письмо со ссылкой входа | `mail.magicLink` | Письмо (ru + en) | ✓ |
| Уведомление о новом устройстве | `mail.newDevice` | Письмо (ru + en) [ДОПУЩЕНИЕ — отправка решается в §25.13] | ✓ (текст) |
| Правила публикации — категории причин | `/legal/content-rules#decisionCategories` | Раздел без порогов и признаков | ✓ |

**Примечания к таблице:**

- Приветственное письмо нового пользователя — отложено (журнал §25.13, проход почты).
- Шаблоны рассылок (F-05) — не входят в scope.
- Юридические тексты (Q-07: оферта, политика ПД, лицензия) — не входят в scope.
- Тексты для `/dashboard`, `/profile-edit` и остальных страниц кабинета — отдельные задачи.

---

## 9. Примечания по переносу в словари

При переносе в `web/i18n/locales/` рекомендуется:

- Добавить секцию `auth` (расширить существующую) для ключей страниц входа и подтверждения.
- Добавить секцию `account` для ключей архива и оспаривания.
- Добавить секцию `mail` для текстов писем (используется серверной частью).
- Добавить секцию `legal` для текстов правил публикации.
- Ключи писем могут располагаться в отдельных файлах шаблонов на серверной стороне.

Плейсхолдеры в фигурных скобках (`{email}`, `{retryAfter}`, `{requestId}`, `{device}`, `{browser}`, `{datetime}`) — параметры подстановки при рендеринге.

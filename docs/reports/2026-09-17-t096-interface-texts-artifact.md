# Артефакт T-096: Тексты интерфейса, писем и правил публикации

**Дата**: 2026-09-17  
**Задача**: ALTE-62  
**Роль**: редактор и бренд-стратег  
**Статус**: готово к ревью

---

## 1. Обзор и источники

Артефакт охватывает три группы текстов:

1. **Тексты интерфейса** первичного потока — экраны входа, верификации, состояний аккаунта.
2. **Письма первичного потока** — magic link, уведомление о новом устройстве, welcome-письмо.
3. **Правила публикации** — общая формулировка по §24.3 журнала.

Источники: журнал решений §24.1, §24.3, §25.1, §25.13; `docs/spec/10-flows/register-and-login.md`; `docs/spec/20-public/login.md`; `docs/spec/20-public/legal-content-rules.md`; `docs/vision/01-product.md` §8; `web/i18n/locales/en.json` и `ru.json`.

Тон бренда: прямой, культурный, без маркетинговых клише. Журнал о культуре, искусстве, спорте, музыке, фотографии, путешествиях и человеческой мысли. По-русски — Вы-форма, приветливая, но не фамильярная. По-английски — чистый, сдержанно-литературный регистр.

---

## 2. Тексты интерфейса — первичный поток

### 2.1 Экран входа (`/login`)

Действующие тексты в `web/i18n/locales/` — **приняты без изменений**, соответствуют бренду.

| Ключ | RU | EN |
|---|---|---|
| `auth.login.title` | Войти или зарегистрироваться | Sign in or register |
| `auth.login.emailLabel` | Адрес электронной почты | Email address |
| `auth.login.emailPlaceholder` | your@email.com | your@email.com |
| `auth.login.consentLabel` | Я принимаю условия {offertaLink} и {privacyLink} | I accept the {offertaLink} and {privacyLink} |
| `auth.login.consentOfferta` | оферты | terms of service |
| `auth.login.consentPrivacy` | политики персональных данных | privacy policy |
| `auth.login.submitButton` | Получить ссылку входа | Get login link |
| `auth.login.hint` | На ваш адрес придёт письмо со ссылкой. Ссылка действует 15 минут и одноразовая. | You will receive an email with a login link. The link is valid for 15 minutes and can only be used once. |

**Состояние «письмо отправлено»** (`VerifyState`):

| Ключ | RU | EN |
|---|---|---|
| `auth.login.sent.title` | Проверьте почту | Check your email |
| `auth.login.sent.body` | Мы отправили ссылку входа на {email}. Откройте письмо и перейдите по ссылке — она действует 15 минут. | We sent a login link to {email}. Open the email and follow the link — it is valid for 15 minutes. |
| `auth.login.sent.notReceived` | Не получили письмо? | Didn't receive the email? |
| `auth.login.sent.retry` | Запросить снова | Request again |

**Ошибки формы входа**:

| Ключ | RU | EN |
|---|---|---|
| `auth.login.error.invalidEmail` | Введите корректный адрес электронной почты | Please enter a valid email address |
| `auth.login.error.consentRequired` | Необходимо принять условия оферты и политики персональных данных | You must accept the terms of service and privacy policy |
| `auth.login.error.rateLimited` | Слишком много запросов. Попробуйте через {retryAfter}. | Too many requests. Please try again in {retryAfter}. |
| `auth.login.error.providerUnavailable` | Письмо не удалось отправить. Попробуйте позже. | The email could not be sent. Please try again later. |
| `auth.login.error.generic` | Что-то пошло не так. Попробуйте ещё раз (код: {requestId}) | Something went wrong. Please try again (code: {requestId}) |

### 2.2 Экран верификации (`/auth/verify`)

| Ключ | RU | EN |
|---|---|---|
| `auth.verify.loading.title` | Входим в систему… | Signing you in… |
| `auth.verify.loading.body` | Пожалуйста, подождите. | Please wait. |
| `auth.verify.expired.title` | Ссылка недействительна | Link is not valid |
| `auth.verify.expired.body` | Ссылка входа истекла или уже была использована. Ссылка действует 15 минут и подходит только для одного входа. | The login link has expired or has already been used. Links are valid for 15 minutes and can only be used once. |
| `auth.verify.expired.action` | Запросить новую ссылку | Request a new link |
| `auth.verify.consent.title` | Обновите согласие | Update your consent |
| `auth.verify.consent.body` | Условия использования или политика персональных данных обновились с момента вашей последней сессии. Пожалуйста, ознакомьтесь с новыми версиями. | The terms of service or privacy policy have been updated since your last session. Please review the new versions. |
| `auth.verify.consent.offertaLink` | Условия использования | Terms of service |
| `auth.verify.consent.privacyLink` | Политика персональных данных | Privacy policy |
| `auth.verify.consent.accept` | Принять и продолжить | Accept and continue |
| `auth.verify.error.title` | Ошибка входа | Sign-in error |
| `auth.verify.error.body` | Не удалось выполнить вход. Попробуйте ещё раз (код: {requestId}) | We were unable to sign you in. Please try again (code: {requestId}) |
| `auth.verify.error.action` | Вернуться к входу | Back to sign in |

### 2.3 Состояния аккаунта

**Архивированный аккаунт** (`/me/archived`):

| Ключ | RU | EN |
|---|---|---|
| `account.archived.title` | Аккаунт в архиве | Account archived |
| `account.archived.body` | Ваш аккаунт деактивирован. Ваши материалы скрыты для читателей и не появляются в выдаче. Вы можете восстановить аккаунт в любой момент. | Your account is deactivated. Your articles are hidden from readers and do not appear in the feed. You can restore your account at any time. |
| `account.archived.restore` | Восстановить аккаунт | Restore account |
| `account.archived.restoreNote` | После восстановления аккаунт станет активным. Материалы остаются в архиве — их нужно вернуть к публикации отдельно. | After restoring, your account will be active again. Your articles remain archived — you will need to republish them separately. |

**Заблокированный аккаунт — форма оспаривания** (`/auth/appeal`):

| Ключ | RU | EN |
|---|---|---|
| `account.appeal.title` | Аккаунт заблокирован | Account blocked |
| `account.appeal.body` | Ваш аккаунт заблокирован. Если вы считаете, что это ошибка, заполните форму — редакция рассмотрит обращение. | Your account has been blocked. If you believe this is an error, please fill out the form — our team will review your appeal. |
| `account.appeal.namePlaceholder` | Ваше имя (необязательно) | Your name (optional) |
| `account.appeal.messagePlaceholder` | Опишите ситуацию и почему вы считаете блокировку ошибочной | Describe the situation and why you believe the block is a mistake |
| `account.appeal.submit` | Отправить обращение | Submit appeal |
| `account.appeal.sent.title` | Обращение отправлено | Appeal submitted |
| `account.appeal.sent.body` | Мы получили ваше обращение и рассмотрим его. Ответ придёт на адрес {email}. | We have received your appeal and will review it. A response will be sent to {email}. |

### 2.4 Замечания к текущим текстам интерфейса

1. **Структурный дубль ключей**: в `auth` объекте обоих файлов существует и строка `"login": "Войти"`, и объект `"login": { ... }`. JSON не допускает дублирующих ключей — второй перезаписывает первый. Строки `auth.login` (верхнего уровня) фактически недоступны. Исправление — задача разработчика, не редактора; строки `auth.login.title` и `auth.login.submitButton` покрывают нужные тексты.

2. **`auth.login.title`**: текущий «Войти или зарегистрироваться» / «Sign in or register» корректен и соответствует концепции (вход и регистрация — одно действие по ADR-0022). Вариант из спецификации «Войти или создать аккаунт» — эквивалент, замена не обязательна.

3. **Отсутствующие тексты первичного потока**:
   - Приглашение заполнить профиль после первого входа (spec `register-and-login.md` §3, шаг 4: «новому — приглашение заполнить профиль») — ключей в локали нет. Добавляется в §2.5.
   - Момент «стать автором» при первом клике «Создать статью» (spec §25.1) — добавляется в §2.6.

### 2.5 Приглашение заполнить профиль (новый пользователь)

Новые тексты для добавления в локаль. Предлагаемые ключи: `account.onboarding.*`

| Ключ | RU | EN |
|---|---|---|
| `account.onboarding.profilePrompt.title` | Расскажите о себе | Tell us about yourself |
| `account.onboarding.profilePrompt.body` | Добавьте публичное имя, чтобы читатели могли вас узнать. Аватар и описание — по желанию. | Add a public name so readers can find you. Avatar and bio are optional. |
| `account.onboarding.profilePrompt.action` | Заполнить профиль | Complete your profile |
| `account.onboarding.profilePrompt.skip` | Пропустить | Skip for now |

### 2.6 Первое создание статьи (стать автором)

Новые тексты. Ключи: `author.becomeAuthor.*`

| Ключ | RU | EN |
|---|---|---|
| `author.becomeAuthor.title` | Вы теперь автор | You are now an author |
| `author.becomeAuthor.body` | Базовые возможности публикации открыты — бесплатно и без ограничений по времени. Напишите первый материал. | Basic authoring is now enabled — free, with no time limit. Write your first article. |

---

## 3. Письма первичного потока

### 3.1 Письмо с ссылкой входа (magic link)

Действующие тексты — **приняты без изменений**.

| Ключ | RU | EN |
|---|---|---|
| `mail.magicLink.subject` | Ссылка входа в Altera | Your Altera login link |
| `mail.magicLink.preheader` | Ваша одноразовая ссылка для входа | Your one-time sign-in link |
| `mail.magicLink.body` | Здравствуйте,\n\nвы запросили ссылку входа в Altera. Перейдите по кнопке ниже — она действует 15 минут и подходит только для одного входа.\n\nЕсли вы не запрашивали ссылку — просто проигнорируйте это письмо. | Hello,\n\nyou requested a login link for Altera. Click the button below — it is valid for 15 minutes and can only be used once.\n\nIf you did not request this, you can safely ignore this email. |
| `mail.magicLink.button` | Войти в Altera | Sign in to Altera |
| `mail.magicLink.expiry` | Ссылка действует 15 минут. | This link expires in 15 minutes. |
| `mail.magicLink.footer` | Altera — журнал о жизни. | Altera — a journal about life. |

### 3.2 Уведомление о входе с нового устройства

Действующие тексты — **приняты без изменений**.

| Ключ | RU | EN |
|---|---|---|
| `mail.newDevice.subject` | Вход в Altera с нового устройства | New sign-in to your Altera account |
| `mail.newDevice.preheader` | Кто-то вошёл в ваш аккаунт | Someone signed into your account |
| `mail.newDevice.body` | Здравствуйте,\n\nв ваш аккаунт Altera только что выполнен вход. Если это были вы — всё в порядке.\n\nЕсли нет — перейдите в настройки безопасности и завершите подозрительные сессии. | Hello,\n\nsomeone just signed into your Altera account. If this was you — all is well.\n\nIf not — go to your security settings and end any suspicious sessions. |
| `mail.newDevice.device` | Устройство: {device} | Device: {device} |
| `mail.newDevice.browser` | Браузер: {browser} | Browser: {browser} |
| `mail.newDevice.time` | Время: {datetime} | Time: {datetime} |
| `mail.newDevice.action` | Управление сессиями | Manage sessions |
| `mail.newDevice.footer` | Altera — журнал о жизни. | Altera — a journal about life. |

### 3.3 Приветственное письмо (welcome)

**Статус: черновик, ожидает подтверждения scope по §25.13.**

Журнал §25.13 относит приветственное письмо к отдельному проходу почты. Ниже — черновик для согласования в том же проходе. Финальный шаблон (HTML, отправщик, частота) определяется там.

| Ключ | RU | EN |
|---|---|---|
| `mail.welcome.subject` | Добро пожаловать в Altera | Welcome to Altera |
| `mail.welcome.preheader` | Ваш аккаунт создан | Your account is ready |
| `mail.welcome.body` | Здравствуйте,\n\nвы зарегистрированы в Altera. Читайте материалы, сохраняйте интересное в закладки и подписывайтесь на авторов.\n\nКогда будете готовы — нажмите «Создать статью», и базовые возможности автора откроются автоматически, бесплатно. | Hello,\n\nyou have joined Altera. Read articles, save your favourites, and follow authors.\n\nWhen you are ready — click "New article" and basic authoring will open automatically, at no cost. |
| `mail.welcome.action` | Перейти в журнал | Go to the journal |
| `mail.welcome.footer` | Altera — журнал о жизни. | Altera — a journal about life. |

---

## 4. Правила публикации — общая формулировка

**Назначение раздела**: текст для страницы `/legal/content-rules`, формулировки общего уровня по §24.3 журнала. Финальный юридический текст пишет владелец (ADR-0028, `docs/vision/01-product.md` §8). Ниже — структура и общая редакция категорий.

Маршрут: `/legal/content-rules` и `/en/legal/content-rules`.

---

### RU: Правила публикации

**Версия**: черновик, дата: 2026-09-17

Altera — журнал о культуре, искусстве, спорте, музыке, фотографии и путешествиях. Следующие правила распространяются на все материалы, публикуемые на платформе.

#### Что нельзя публиковать

1. **Чужой контент без прав.** Нельзя публиковать тексты, изображения, видео или другие материалы, защищённые авторским правом, без разрешения правообладателя. Это относится к фрагментам, переводам и адаптациям в равной мере.

2. **Незаконный контент.** Запрещено публиковать материалы, нарушающие законодательство: призывы к насилию, дискриминация, CSAM и аналогичный контент, недопустимый по возрасту.

3. **Спам и скрытая реклама.** Материалы, написанные исключительно для продвижения товаров или услуг без редакционной ценности, не принимаются. Коммерческое упоминание допустимо при раскрытии.

4. **Персональные данные третьих лиц.** Нельзя публиковать личные данные людей без их согласия: адреса, телефоны, документы, сведения, раскрывающие частную жизнь.

5. **Несоответствие теме.** Материалы, не имеющие отношения к тематике журнала (культура, искусство, спорт, музыка, фотография, путешествия, человеческая мысль) и очевидно выходящие за её пределы, отклоняются.

#### Права на контент

Автор сохраняет авторские права на опубликованный материал. Платформе предоставляется неисключительная лицензия на хранение, воспроизведение и показ материала в рамках работы журнала.

Все изображения должны сопровождаться атрибуцией источника и подтверждением наличия необходимых прав. Использование изображений без прав является нарушением настоящих правил.

Использование материалов Altera для обучения моделей искусственного интеллекта запрещено.

Экспорт собственных материалов доступен всегда в личном кабинете автора.

#### Как работает проверка

Каждый материал, отправленный к публикации, проходит две ступени:

1. **Автоматическая проверка**: система выносит бинарный вердикт — материал допускается к следующему шагу или отклоняется. При отклонении автор получает объяснение причины.

2. **Ревью редактора**: редактор просматривает материал и может его опубликовать, вернуть на доработку с комментарием или вынести окончательный отказ. При каждом решении автор получает объяснение.

Редакция не правит чужой текст. Автор может внести правки и подать материал повторно.

Точные критерии автоматической проверки не публикуются — это исключает возможность намеренного обхода.

#### Что происходит с материалами

- **Истечение подписки**: материалы остаются опубликованными, авторские разделы переходят в режим чтения.
- **Архивирование аккаунта**: материалы скрываются для читателей; при восстановлении аккаунта автор возвращает их к публикации отдельно.
- **Блокировка аккаунта**: материалы скрываются; автор сохраняет доступ к экспорту.

#### Претензии правообладателей

Жалобы на нарушение авторских прав направляются в редакцию через форму «Написать в редакцию».

#### Передача данных

При автоматической проверке текст материала передаётся AI-провайдеру. Имя автора и адрес электронной почты не включаются в передаваемые данные.

---

### EN: Publication Rules

**Version**: draft, date: 2026-09-17

Altera is a journal of culture, art, sport, music, photography, and travel. The following rules apply to all content published on the platform.

#### What you may not publish

1. **Third-party content without rights.** Do not publish texts, images, videos, or other materials protected by copyright without the rights holder's permission. This includes fragments, translations, and adaptations.

2. **Unlawful content.** Content that violates applicable law — incitement to violence, discrimination, CSAM, and similar age-restricted material — is prohibited.

3. **Spam and covert advertising.** Articles written solely to promote products or services, without editorial value, are not accepted. Commercial mentions are permitted with disclosure.

4. **Personal data of third parties.** Do not publish personal information about individuals without their consent: addresses, phone numbers, documents, or information that reveals private life.

5. **Off-topic material.** Articles clearly outside the journal's scope — culture, art, sport, music, photography, travel, and human thought — will be declined.

#### Content rights

Authors retain copyright over their published work. The platform is granted a non-exclusive licence to store, reproduce, and display the material as part of the journal's operation.

All images must include source attribution and confirmation that the necessary rights are held. Publishing images without rights is a violation of these rules.

Using Altera content to train artificial intelligence models is prohibited.

Authors may export their own content at any time from the author dashboard.

#### How review works

Every article submitted for publication passes through two stages:

1. **Automated review**: the system issues a binary verdict — the article proceeds or is declined. On decline, the author receives an explanation of the reason.

2. **Editorial review**: an editor reviews the article and may publish it, return it for revision with a comment, or issue a final rejection. The author receives an explanation with every decision.

The editorial team does not edit an author's text. The author may revise and resubmit.

Specific automated review criteria are not published — this prevents deliberate circumvention.

#### What happens to your content

- **Subscription expiry**: articles remain published; authoring sections become read-only.
- **Account archiving**: articles are hidden from readers; when the account is restored, the author republishes them separately.
- **Account block**: articles are hidden; the author retains access to export.

#### Copyright claims

Complaints about copyright infringement should be submitted to the editorial team via the "Contact us" form.

#### Data transmission

During automated review, the text of an article is transmitted to an AI provider. The author's name and email address are not included in the transmitted data.

---

## 5. Аудит тонального соответствия

### Критерии оценки (бренд-голос Altera)

- Прямой, без маркетинговых клише
- Культурный регистр (журнал, а не стартап)
- Уважительный, без снисхождения
- Конкретный: объясняет, что происходит, не скрывает факты
- Не обещает того, чего нет (бесплатный запуск, платные функции — отдельный этап)

### Результаты аудита

| Группа | Оценка | Замечания |
|---|---|---|
| Экран входа | Соответствует | Тон нейтральный, точный. «Пароля нет» не сказано явно — но это норм: подсказка «ссылка придёт на почту» достаточна. |
| Верификация | Соответствует | «Signing you in…» / «Входим в систему…» — живой, но не театральный. Хорошо. |
| Архивированный аккаунт | Соответствует | Чёткое объяснение состояния без эмоционального нагнетания. |
| Форма оспаривания | Соответствует | «Редакция рассмотрит» — уместный оборот, обещание без гарантии. |
| Magic link письмо | Соответствует | «Здравствуйте» / «Hello» — правильный старт, не «Привет» и не «Dear User». |
| New device письмо | Соответствует | Конкретика (устройство, браузер, время), не паника. |
| Welcome письмо | Черновик | Ждёт подтверждения §25.13. Тон — нейтральный, без восторга. |
| Правила публикации | Черновик | Общая формулировка согласована с §24.3; точные пороги не раскрыты. Финальный юридический текст — за владельцем. |

### Что не включено в артефакт (и почему)

| Тема | Причина исключения |
|---|---|
| Юридический текст оферты, политики ПД | Пишет владелец (ADR-0028) |
| Точные пороги и критерии AI-проверки | Не публикуются по §24.3 |
| Тексты платных функций (цены, checkout) | Отдельный этап (§24.1) |
| Тексты уведомлений о публикации, отказе | Отложено (§25.13) |
| Тексты смены почты, удаления аккаунта | Не входят в первичный поток T-096 |

---

## 6. Как проверено

1. **Источники**: все тексты сверены с журналом решений §24.1, §24.3, §25.1, §25.13 и соответствующими spec-страницами.
2. **Тон**: каждая группа текстов оценена по критериям бренд-голоса (§5). Замечания зафиксированы в таблице.
3. **Полнота**: определены три группы gap — дублирующие ключи (задача разработчика), отсутствующие onboarding-тексты (§2.5–2.6), welcome-письмо (§3.3).
4. **Ограничения**: правила публикации — общая формулировка, не финальный юридический текст. Welcome-письмо — черновик, scope подтверждается в §25.13.

---

*Готово к ревью независимым ревьюером.*

# Модель данных: целевая схема и путь от текущей

- **Ревизия**: 4 (2026-09-17), заменяет ревизию 3 (2026-09-14).
- **Статус**: синхронизировано с журналом Г1–Г9 и миграциями E-03 (T-109, ALTE-61).
- **Основание**: `server/prisma/schema.prisma` и миграции E-03 (T-011–T-019); ADR-0034…0046
  поверх ADR-0001…ADR-0010, ADR-0027; журнал §21.15–16, §25.6, §26.5, §27.6, §27.7,
  §29.5, §29.11, §29.13, #41.
- Этот документ владеет сущностями, полями, enum, индексами, инвариантами и миграциями.
  Права — в `04-roles-and-access.md`, процесс редактирования — в `05-editor.md`.
- Формат: таблицы полей для центральных сущностей, псевдо-схема Prisma для остальных, SQL
  бэкфилла там, где он нетривиален. Это проект, а не миграции: миграции создаются на этапах
  роадмапа и только с именем.

## История ревизий

### Ревизия 3 → 4 (2026-09-17, T-109/ALTE-61, согласование с E-03 миграциями)

| Было (ревизия 3) | Стало (ревизия 4) | Источник |
|---|---|---|
| `enum ArchiveMode { block delete }` | `enum AccountArchiveMode { self admin emergency }` | миграция `user_account_archive_state`; журнал #4, #30, #48 |
| `User.archiveMode ArchiveMode?` | `User.archiveMode AccountArchiveMode?` | то же |
| `model ErrorRecord` (упрощённая модель: code/message/context/status) | `model BackendError` с `BackendErrorStatusHistory`; `BackendErrorService`, `BackendErrorWorkStatus` enums | T-019, `admin_operational_records` |
| `model SentEmail` (упрощённая модель: toEmail/subject/body/status) | `model MailMessage` + `MailDeliveryEvent`; `MailDeliveryStatus` enum | T-019, `admin_operational_records` |
| Нет `model Job`, `model JobAttempt` | Очередь фоновых задач с историей попыток; `JobStatus` enum | T-019, `admin_operational_records` |
| Нет `model AiProcess`, `model AiCostAggregate` | Лог AI-процессов и агрегаты стоимости; `AiProcessKind`, `AiProcessStatus` enums | T-019, `admin_operational_records` |
| Нет `model LegalText`, `model UserLegalConsent` | Версионируемые юридические тексты и согласия пользователя; `LegalTextKind`, `LegalTextStatus` enums | T-019, `admin_operational_records` |
| Нет `model EmailChangeRequest` | Запрос на смену почты с хэшем кода и сроком | T-013, `user_profile_handle_locale`; журнал §25.8 |

### Ревизия 2 → 3 (2026-09-14, T-109, журнал Г5b–Г9)

| Было (ревизия 2) | Стало (ревизия 3) | Источник |
|---|---|---|
| `alt` у узла `figure` может переопределить `alt` медиафайла | `alt` хранится только в `MediaAsset.alt`; узел `figure` не содержит `alt`; исправляет только `admin` с аудитом | журнал §29.11, §29.13 |
| `ArticleStatus { draft ai_review review published archived }` | `ArticleStatus { draft ai_check review in_review rework published archived }` + признак `rejectedFinal` | журнал §26.5 |
| `ArticleAiReview.score`, `ArticleBoost` (24-часовой), `COALESCE(overriddenScore, score)` | Удалены; AI даёт только вердикт с причинами; надбавка Pro — в `AuthorScore`/`RankingConfig` (постоянная) | журнал #41, §21.15–16 |
| `ReadSalt` + `ReadEvent` | События вовлечённости с `visitorId` (см. `60-ranking/engagement-tracking.md`) | журнал §23 |
| `User.blockedAt`, `User.blockedById`, `User.blockReason` | Блокировка = архивирование с `archivedByActorId`, `archiveReason`, `archiveMode`; отдельных полей `blocked*` нет | журнал #4, #30, #48 |
| Нет `ReviewMessage`, `ReviewNote`, `ReviewDecision` | Добавлены: переписка по проверке и заметки к блокам (§25.6) | журнал §25.6 |
| Нет `ErrorRecord` | Добавлены записи ошибок со статусами `new / in_progress / resolved` (§27.7) | журнал §27.7 |
| Нет `SentEmail` | Добавлена история писем с адресом, темой, статусом доставки (§27.6) | журнал §27.6 |
| Нет предыдущей версии аватара | `User.prevAvatarId` — ссылка на прежний `MediaAsset` для возможного отката (§29.5) | журнал §29.5 |
| Нет `OwnerException` | `OwnerException(userId, expiresAt, reason)` — исключения владельца со сроком (#54) | журнал #54 |

### Ревизия 1 → 2 (2026-09-06, ADR-0034…0046)

| Было | Стало | Решение |
|---|---|---|
| `Article.contour`, `Commission`, `EditorialPick`, `Collection`, CHECK контуров | Удалены; `Article.access` зарезервирован | ADR-0036 |
| `User.trustLevel`, `trustChanged*`, `needsReview` | `User.planTier`, `planUntil`; грейд вычисляется из плана | ADR-0035, ADR-0037 |
| `PlanKind { author_support showcase }`, `Plan.authorId`, донаты, `PayoutProfile`, `Payout` | `PlanTier { free standard pro }`, `PlanGrant`; биллинг на этапе 1 | ADR-0035 |
| Прочтения — этап 3 | Прочтения, `ArticleScore`, `AuthorScore`, `RankingConfig` — этап 2 | ADR-0034, ADR-0038 |
| — | `ArticleAiCheck` (этап 1), `TranslationJob` (этап 3), `Bookmark` (этап 1) | ADR-0039, ADR-0046, ADR-0041 |
| `Role` из шести значений; `audit_log` с этапа 2 | `analyst`; `audit_log` с этапа 1 | ADR-0042 |
| `ArticleStatus` из четырёх значений | + `ai_check` | ADR-0045 |
| Миграции M9, M10, M12, M13, M15 | Перекроены: M9 — биллинг, жалобы, закладки, AI, аудит (1); M12 — прочтения и рейтинг (2); M13 — подписка на автора и переводы (3); M10 — замечания (4); M15 удалена | — |

---

## 0. Соглашения

| Правило | Почему |
|---|---|
| `id String @id @default(uuid())` → `TEXT`, как в существующих таблицах; `@db.Uuid` не вводим | Смешение типов в внешних ключах дороже 20 байт на строку |
| Исключение — append-only таблицы (`engagement_events`, `audit_log`): `BigInt @id @default(autoincrement())` | Дешёвая вставка, естественный порядок |
| Таблицы — snake_case через `@@map`; колонки — camelCase без `@map` (как сейчас: `"publishedAt"`) | Один стиль; полусмешанная схема хуже любой из чистых |
| `createdAt @default(now())`, `updatedAt @updatedAt` везде, кроме append-only | Как сейчас |
| Enum Prisma = тип PostgreSQL. Добавление значения — `ALTER TYPE … ADD VALUE` в **отдельной** миграции; использовать новое значение в той же транзакции нельзя | Ограничение PostgreSQL |
| Деньги — `Int` в копейках (`…Minor`); валюта — константа RUB в коде | Международный биллинг не проектируем |
| `enum Locale { ru en }`; русский без префикса | ADR-0002 |
| Soft delete по умолчанию **нет**; исключения — раздел 4.7 | Каждый `deletedAt` — фильтр в каждом запросе навсегда |
| Индексы — только под известные запросы (раздел 1.8) | Лишний индекс — цена на каждой записи |
| CHECK-ограничения — raw SQL в миграции; Prisma их не моделирует и не трогает при diff | Инварианты вроде «опубликовано ⇒ есть дата» дешевле держать в базе |
| Частичные unique-индексы не используем | Prisma их не поддерживает: drift при каждом diff |
| Персональные данные (152-ФЗ) живут только в PostgreSQL: `users.email/name/socialLinks`, `sessions.ip/userAgent`, `reports.reporterEmail`, `newsletter_subscribers.email`; платёжные реквизиты — у провайдера. В S3 — только медиа | Перенос в РФ = дамп базы + бакет (ADR-0011) |

---

## 1. Каталог сущностей по этапам

### 1.1. Этапы 0–1: модель v2

Состав: `User` (изменён), `MagicLinkToken` (изменён), `Session`, `HandleHistory`, `Section`
(бывший `ContentType`), `Format`, `Tag` (бывший `SectionTag`), `Article` (изменён),
`ArticleTranslation`, `ArticleRevision`, `ArticleSlugHistory`, `MediaAsset`, `Report`,
`Bookmark`, `ArticleAiReview`, `AuditLog`, `PlanGrant` и биллинг раздела 1.4. `Session` и
значения `moderator`/`owner`/`analyst` появляются на этапе 0 (миграции M1–M2), остальное —
на этапе 1.

#### User (`users`)

| Поле | Тип | Null | Default | Примечание |
|---|---|---|---|---|
| id | String @id | нет | uuid() | |
| name | String | нет | — | Публичное имя. При удалении аккаунта → `'deleted'`; рендер показывает «автор удалил аккаунт» по `deletedAt` |
| email | String @unique | нет | — | **Никогда не публичен** (ADR-0018): в GraphQL только в `me`. При удалении → `deleted+{id}@anonymized.invalid` |
| handle | String @unique | нет | — | Было `slug`. `[a-z0-9-]{3,32}`, нижний регистр; адрес `/authors/{handle}`. Новые пользователи получают случайный `u-{8 hex}` и меняют в кабинете |
| bio | String? | да | — | |
| photoUrl | String? | да | — | Устаревает после `avatarAssetId`; удаляется, когда веб перейдёт на медиа |
| avatarAssetId | String? → MediaAsset | да | — | С миграции медиа (M8) |
| role | Role | нет | reader | `reader/author/editor/moderator/analyst/admin/owner`; `reader`/`author` синхронизируются с планом (ADR-0035) |
| planTier | PlanTier | нет | free | Кэш активного плана (ADR-0035); истина — `subscriptions` и `plan_grants`; чинится планировщиком; грейд автора вычисляется отсюда (ADR-0037) |
| planUntil | DateTime? | да | — | Конец оплаченного периода или гранта; NULL для `free` |
| socialLinks | Json? | да | — | Как сейчас |
| archivedAt | DateTime? | да | — | Блокировка или удаление = архивирование (журнал #4, #30, #48) |
| archivedByActorId | String? → User | да | — | Кто выполнил архивирование |
| archiveReason | String? | да | — | Причина: блокировка, самостоятельное удаление и т. д. |
| archiveMode | AccountArchiveMode? | да | — | `self / admin / emergency`; кто выполнил архивирование |
| deletedAt | DateTime? | да | — | Аккаунт анонимизирован; запись остаётся как «надгробие» |
| lastLoginAt | DateTime? | да | — | |
| consentVersion | String? | да | — | Версия оферты и политики ПД, с которой согласился (ADR-0028) |
| consentAt | DateTime? | да | — | |
| prevAvatarId | String? → MediaAsset | да | — | Предыдущий аватар для отката рецензентом (журнал §29.5) |
| locale | Locale | нет | ru | **Этап 3**: язык писем |
| createdAt, updatedAt | DateTime | нет | | |

Уникальность: `email`, `handle`. Дополнительных индексов не нужно: таблица маленькая.

#### MagicLinkToken (`magic_link_tokens`) — изменение

Как сейчас (один токен на пользователя, upsert), но колонка `token` → `tokenHash` (sha256;
в базе не должно лежать то, чем можно войти); лишний индекс `magic_link_tokens_token_idx`
(дубликат unique) удаляется. Лимиты — прикладная логика (ADR-0024).

#### Session (`sessions`) — ADR-0009

| Поле | Тип | Null | Default | Примечание |
|---|---|---|---|---|
| id | String @id | нет | uuid() | В access-JWT как `sid`; контекст проверяет `revokedAt IS NULL` одним чтением |
| userId | String → User (Cascade) | нет | — | |
| tokenHash | String @unique | нет | — | sha256 случайных 32 байт refresh-токена |
| previousTokenHash | String? | да | — | Предыдущий хэш после ротации; его предъявление = кража → отзыв |
| expiresAt | DateTime | нет | — | 30 дней от последней ротации |
| revokedAt | DateTime? | да | — | «Выйти» — одна строка, «выйти везде» — все |
| userAgent | String? | да | — | Список устройств |
| ip | String? | да | — | ПД; чистка через 30 дней после истечения |
| createdAt, lastUsedAt | DateTime | нет | now() | |

Индексы: `@@unique([tokenHash])`, `@@index([userId])`, `@@index([previousTokenHash])`.

#### EmailChangeRequest (`email_change_requests`) — журнал §25.8

```prisma
model EmailChangeRequest {
  id        String   @id @default(uuid())
  userId    String   @unique               // → User, Cascade; один активный запрос на пользователя
  newEmail  String
  codeHash  String   @db.VarChar(64)       // sha256 кода; не хранить сырой код
  expiresAt DateTime
  createdAt DateTime @default(now())
  @@map("email_change_requests")
}
```

#### HandleHistory (`handle_history`)

```prisma
model HandleHistory {
  id        String   @id @default(uuid())
  handle    String   @unique      // старый handle → 301 на текущий
  userId    String                // → User, Cascade
  createdAt DateTime @default(now())
  @@index([userId])
  @@map("handle_history")
}
```

#### Section, Format, Tag — ADR-0005

```prisma
model Section {                     // бывший ContentType; в адресе: /{section.slug}/{slug}
  id            String        @id @default(uuid())
  name          String                      // RU
  nameEn        String?                     // EN-навигация; fallback на name
  slug          String        @unique       // латиница, общий для локалей: culture, art, photo, music, sport, travel
  description   String?
  descriptionEn String?
  order         Int
  status        SectionStatus @default(active)   // бывший ContentTypeStatus
  createdAt     DateTime      @default(now())
  updatedAt     DateTime      @updatedAt
  @@map("sections")
}

model Format {                      // жанр, не в адресе: essay, review, photo-story, interview, column
  id        String   @id @default(uuid())
  name      String
  nameEn    String?
  slug      String   @unique
  order     Int      @default(0)
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
  @@map("formats")
}

model Tag {                         // бывший SectionTag; свободные, создаёт автор, редакция сливает
  id          String   @id @default(uuid())
  name        String
  nameEn      String?
  slug        String   @unique
  description String?
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt
  articles    Article[]             // неявная M:N, таблица _ArticleToTag (переименованная _ArticleToSectionTag)
  @@map("tags")
}
```

Слаги рубрик не могут совпадать с зарезервированными сегментами адресов (ADR-0004); проверка
в резолвере, список в одном месте.

#### Article (`articles`) — общие метаданные материала

| Поле | Тип | Null | Default | Примечание |
|---|---|---|---|---|
| id | String @id | нет | uuid() | Никогда не в адресе |
| authorId | String → User (Restrict) | нет | — | Подпись; один автор (соавторы — YAGNI) |
| sectionId | String → Section (Restrict) | нет | — | Было `typeId` |
| formatId | String? → Format (SetNull) | да | — | |
| sourceLocale | Locale | нет | ru | Инвариант: версия с этой локалью существует всегда |
| firstPublishedAt | DateTime? | да | — | Ставится **один раз**, когда любая версия впервые опубликована; не сбрасывается |
| coverAssetId | String? → MediaAsset (SetNull) | да | — | Общая обложка |
| legacyFeaturedImage | String? | да | — | Бывший `featuredImage` (внешний URL); до M11 |
| access | AccessLevel | нет | free | **Зарезервировано** (ADR-0036): всегда `free`; резолверы и интерфейс не читают; включение — отдельным ADR |
| createdAt, updatedAt | DateTime | нет | | |

Индексы: `@@index([authorId, createdAt(sort: Desc)])`, `@@index([sectionId])`. Убрано из
`Article`: `title`, `slug`, `dek`, `body`, `excerpt`, `status`, `publishedAt` — свойства
языковой версии.

#### ArticleTranslation (`article_translations`) — ADR-0002

| Поле | Тип | Null | Default | Примечание |
|---|---|---|---|---|
| id | String @id | нет | uuid() | |
| articleId | String → Article (Cascade) | нет | — | |
| locale | Locale | нет | — | |
| slug | String | нет | — | Уникален в локали; до первой публикации меняется свободно, после — через историю |
| title | String | нет | — | |
| dek | String? | да | — | Подзаголовок |
| excerpt | String? | да | — | Для карточек; пусто → первый абзац при рендере |
| body | Json | нет | — | Документ ProseMirror (ADR-0001); изображения по `assetId` |
| legacyBody | String? | да | — | Исходная строка `articles.body`; до M11 |
| status | ArticleStatus | нет | draft | `draft/ai_check/review/in_review/rework/published/archived`; признак `rejectedFinal`; `ai_check` добавляется `ADD VALUE` (ADR-0045) |
| publishedAt | DateTime? | да | — | Первая публикация версии; при повторной публикации **не** сбрасывается. CHECK: `status <> 'published' OR publishedAt IS NOT NULL` |
| reviewRequestedAt | DateTime? | да | — | Порядок очереди ревьюера (ставится при переходе в `review`) |
| submittedAt | DateTime? | да | — | Момент отправки в `ai_check`; SLA считается отсюда |
| appealedAt | DateTime? | да | — | Оспаривание отказа AI (ADR-0045) |
| unpublishedAt, unpublishedById, unpublishReason | DateTime? / String? / String? | да | — | Снятие модератором; авторский архив их не заполняет |
| translatorId | String? → User | да | — | Подпись «перевод: …» |
| sourceRevisionId | String? → ArticleRevision (SetNull) | да | — | С какой ревизии оригинала сделан перевод (M6) |
| seoTitle, seoDescription | String? | да | — | Этап 2; колонки создаются сразу |
| followersNotifiedAt | DateTime? | да | — | **Этап 3**: идемпотентная рассылка подписчикам автора |
| bodyText | String? | да | — | **Этап 3**: плоский текст из `body`; источник для tsvector и времени чтения |
| searchVector | Unsupported("tsvector")? | да | — | **Этап 3**: generated column, GIN |
| createdAt, updatedAt | DateTime | нет | | |

```prisma
@@unique([articleId, locale])
@@unique([locale, slug])
@@index([locale, status, publishedAt(sort: Desc)])     // все публичные ленты
@@index([status, reviewRequestedAt])                   // очередь проверки, админский фильтр
@@map("article_translations")
```

#### ArticleRevision (`article_revisions`) — ADR-0007

| Поле | Тип | Null | Default | Примечание |
|---|---|---|---|---|
| id | String @id | нет | uuid() | |
| translationId | String → ArticleTranslation (Cascade) | нет | — | Снимок версии |
| kind | RevisionKind | нет | — | `autosave / manual / publish / editorial` |
| createdById | String → User (Restrict) | нет | — | У `editorial` ≠ автор |
| restoredFromId | String? → ArticleRevision | да | — | Восстановление создаёт новую ревизию |
| title, dek, excerpt | String / String? / String? | | | Снимок метаданных |
| body | Json | нет | — | Снимок документа |
| note | String? | да | — | Комментарий или причина правки |
| createdAt | DateTime | нет | now() | |

Индекс: `@@index([translationId, createdAt(sort: Desc)])`. Политика хранения — раздел 4.9.

#### ArticleSlugHistory (`article_slug_history`)

```prisma
model ArticleSlugHistory {
  id        String   @id @default(uuid())
  locale    Locale
  slug      String
  articleId String                    // → Article, Cascade
  createdAt DateTime @default(now())
  @@unique([locale, slug])
  @@index([articleId])
  @@map("article_slug_history")
}
```

Правило: `(locale, slug)` не найден в версиях → искать здесь → 301 на текущий адрес (рубрика
берётся из материала, поэтому смена рубрики тоже редиректится). Слаг, редиректящий на чужой
материал, занять нельзя; если старый слаг возвращают тому же материалу — строка удаляется.

#### MediaAsset (`media_assets`) — ADR-0008

| Поле | Тип | Null | Default | Примечание |
|---|---|---|---|---|
| id | String @id | нет | uuid() | В документе: `attrs.assetId` |
| ownerId | String → User (Restrict) | нет | — | Загрузивший = ответственный за права |
| kind | MediaKind | нет | image | `video/audio/file` — ADD VALUE на этапе 5 |
| storageKey | String @unique | нет | — | `{yyyy}/{mm}/{id}.{ext}` |
| mimeType | String | нет | — | |
| byteSize | Int | нет | — | |
| width, height | Int? | да | — | |
| sha256 | String | нет | — | Дедупликация загрузок владельца (индекс) |
| variants | Json | нет | [] | `[{name:"w480", key, width, height, bytes, format:"webp"}, …]` (ADR-0030) |
| focalX, focalY | Float? | да | — | Фокусная точка для обрезки вариантов |
| alt | String? | да | — | Формируется AI при загрузке (§29.11); единственный источник для вывода; узел документа не переопределяет; исправляет только `admin` с аудитом (§29.13) |
| caption | String? | да | — | |
| attribution | String | нет | — | Обязательна |
| license | MediaLicense | нет | — | Обязательна |
| licenseNote | String? | да | — | Ссылка на источник или условия |
| placeholder | String? | да | — | LQIP/blurhash |
| deletedAt | DateTime? | да | — | **Единственный** soft delete этапа 1 |
| createdAt, updatedAt | DateTime | нет | | |

Индексы: `@@unique([storageKey])`, `@@index([ownerId, createdAt(sort: Desc)])`, `@@index([sha256])`.

#### Bookmark (`bookmarks`) — ADR-0041

```prisma
model Bookmark {                    // закладка читателя; приватна; в рейтинг не входит
  userId    String                              // → User, Cascade
  articleId String                              // → Article, Cascade
  createdAt DateTime @default(now())
  @@id([userId, articleId])
  @@index([userId, createdAt(sort: Desc)])
  @@map("bookmarks")
}
```

#### Report (`reports`) — ADR-0026

| Поле | Тип | Null | Default | Примечание |
|---|---|---|---|---|
| id | String @id | нет | uuid() | |
| translationId | String → ArticleTranslation (Cascade) | нет | — | Жалоба на конкретную страницу |
| reporterId | String? → User | да | — | NULL — гость |
| reporterEmail | String? | да | — | ПД; для ответа гостю |
| reason | ReportReason | нет | — | `copyright / illegal / spam / personal_data / other` |
| message | String? | да | — | |
| status | ReportStatus | нет | open | `open / resolved / dismissed` |
| handledById, handledAt, resolution | String? / DateTime? / String? | да | — | |
| createdAt | DateTime | нет | now() | |

`@@index([status, createdAt])`, `@@index([translationId])`.

#### ArticleAiCheck (`article_ai_checks`) — ADR-0039

Переименовано из `ArticleAiReview` в ревизии 3 (журнал #41). Балла нет; AI даёт только
бинарный вердикт с категориями причин.

```prisma
model ArticleAiCheck {              // одна запись на публикуемую ревизию; история сохраняется
  id               String    @id @default(uuid())
  translationId    String                        // → ArticleTranslation, Cascade
  revisionId       String                        // → ArticleRevision, Restrict
  verdict          AiVerdict                     // pass / fail / uncertain
  reasons          Json?                         // категории причин отказа (журнал §24.3)
  explanations     Json?                         // пояснения автору, без ПДн
  model            String
  promptVersion    String                        // версия промта; включает версию правил публикации
  costMinor        Int       @default(0)
  createdAt        DateTime  @default(now())
  @@index([translationId, createdAt(sort: Desc)])
  @@unique([revisionId])
  @@map("article_ai_checks")
}
```

#### PlanGrant (`plan_grants`) — ADR-0035

```prisma
model PlanGrant {                   // ручной грант плана: редакция, партнёры, бэкфилл авторов
  id          String   @id @default(uuid())
  userId      String                              // → User, Cascade
  tier        PlanTier                            // standard / pro
  startsAt    DateTime @default(now())
  endsAt      DateTime
  grantedById String                              // → User, Restrict
  reason      String
  revokedAt   DateTime?
  createdAt   DateTime @default(now())
  @@index([userId, endsAt])
  @@map("plan_grants")
}
```

#### Enum модели v2

```prisma
enum Role             { reader author editor moderator analyst admin owner }
enum SectionStatus    { active archived }                       // переименованный ContentTypeStatus
enum ArticleStatus    { draft ai_check review in_review rework published archived }  // ai_check — ADD VALUE (ADR-0045); in_review, rework — §26.5
enum Locale           { ru en }
enum PlanTier         { free standard pro }
enum AiVerdict        { pass fail uncertain }
enum RevisionKind     { autosave manual publish editorial }
enum MediaKind        { image }
enum MediaLicense     { own cc_by cc_by_sa cc_by_nc cc0 public_domain permission }
enum ReportReason     { copyright illegal spam personal_data other }
enum ReportStatus     { open resolved dismissed }
enum AccountArchiveMode { self admin emergency }                 // журнал #4, #30, #48; #48=emergency
```

### 1.2. Аудит (этап 1) и замечания (этап 4)

```prisma
model ReviewNote {                  // замечание редактора к блоку
  id            String    @id @default(uuid())
  translationId String                       // → ArticleTranslation, Cascade
  authorId      String                       // → User: редактор/модератор
  blockId       String?                      // attrs.id блока ProseMirror; NULL — ко всему тексту
  body          String
  resolvedAt    DateTime?
  resolvedById  String?
  createdAt     DateTime  @default(now())
  @@index([translationId, createdAt])
  @@map("review_notes")
}

model AuditLog {                    // append-only, без FK: лог не зависит от судьбы сущностей
  id         BigInt   @id @default(autoincrement())
  actorId    String?
  actorRole  Role?                                   // снимок роли на момент действия
  action     String                                  // "user.role.change", "plan.grant", "translation.approve", "translation.unpublish", "ranking.config.change", "revision.restore", "report.resolve", "owner.transfer", "user.pii.view", "media.alt.edit" (список — 04-roles §5)
  targetType String                                  // "user" | "article_translation" | "article" | "report" | …
  targetId   String
  diff       Json?                                   // { before, after } только изменённые поля
  ip         String?
  createdAt  DateTime @default(now())
  @@index([targetType, targetId, createdAt(sort: Desc)])
  @@index([actorId, createdAt(sort: Desc)])
  @@index([createdAt])
  @@map("audit_log")
}
```

Требование к редактору: схема присваивает блокам стабильный `attrs.id` при создании узла.
`audit_log` пишется с этапа 1 для действий из списка `04-roles-and-access.md` §5 (ADR-0042);
интерфейс просмотра и `ReviewNote` — этап 4.

### 1.3. Этап 2: прочтения и рейтинг; этап 3: подписка на автора, переводы, поиск

```prisma
// Прочтения: события вовлечённости с visitorId (журнал §23; детали — 60-ranking/engagement-tracking.md)
model EngagementEvent {             // события; хранятся ограниченное время
  id          BigInt   @id @default(autoincrement())
  articleId   String                       // → Article, Cascade
  visitorId   String                       // анонимный идентификатор, без IP
  day         DateTime @db.Date
  kind        String                       // read / scroll / share и т. д.
  createdAt   DateTime @default(now())
  @@unique([day, articleId, visitorId, kind])
  @@map("engagement_events")
}

model ArticleReadDaily {            // агрегат; бессрочно
  articleId   String                       // → Article, Cascade
  day         DateTime @db.Date
  uniqueReads Int      @default(0)
  @@id([articleId, day])
  @@index([day])                           // «популярное»: WHERE day >= today-6
  @@map("article_read_daily")
}

model ArticleScore {                // материализованный рейтинг статьи (ADR-0034); пересчёт по расписанию и событиям
  articleId     String   @id                     // → Article, Cascade
  score         Float
  components    Json                             // { topic, freshness, author, views } — разложение (журнал §21.15–16)
  configVersion Int                              // → RankingConfig.version
  computedAt    DateTime
  @@index([score(sort: Desc)])
  @@map("article_scores")
}

model AuthorScore {                 // рейтинг автора: грейд из плана (ADR-0037) + история материалов
  userId        String   @id                     // → User, Cascade
  score         Float
  components    Json
  configVersion Int
  computedAt    DateTime
  @@map("author_scores")
}

model RankingConfig {               // веса и окна как версионируемая конфигурация; меняется из админки с аудитом
  version     Int      @id @default(autoincrement())
  weights     Json                               // именованные параметры и окна
  changedById String                             // → User
  note        String?
  createdAt   DateTime @default(now())
  @@map("ranking_configs")
}

// ArticleBoost (ADR-0040) удалён в ревизии 3: временного 24-часового буста нет (журнал §21.15–16).
// Pro-надбавка является постоянным компонентом AuthorScore.

model ReadExclusion {               // исключение подозрительных событий из рейтинга (антинакрутка)
  articleId   String                              // → Article, Cascade
  day         DateTime @db.Date
  reason      String
  excludedById String                             // → User
  createdAt   DateTime @default(now())
  @@id([articleId, day])
  @@map("read_exclusions")
}

model TranslationJob {              // AI-перевод для pro (ADR-0046), этап 3
  id                  String    @id @default(uuid())
  translationId       String                      // → ArticleTranslation (создаваемая версия), Cascade
  sourceTranslationId String                      // → ArticleTranslation
  sourceRevisionId    String                      // → ArticleRevision
  provider            String
  model               String
  status              String                      // queued / running / done / failed
  costMinor           Int       @default(0)
  error               String?
  createdAt           DateTime  @default(now())
  completedAt         DateTime?
  @@index([translationId])
  @@map("translation_jobs")
}

model AuthorFollow {
  followerId String                            // → User, Cascade
  authorId   String                            // → User, Cascade
  createdAt  DateTime @default(now())
  @@id([followerId, authorId])
  @@index([authorId])
  @@map("author_follows")
}
```

Запись события вовлечённости — дедуплицированная: `INSERT INTO engagement_events … ON CONFLICT DO NOTHING`.
Агрегат за окно из `RankingConfig` используется как вход рейтинга «просмотры» минус дни из
`read_exclusions` (ADR-0038). Ленты — `SELECT … FROM article_scores s JOIN article_translations t
… WHERE t.locale = $1 AND t.status = 'published' ORDER BY s.score DESC`; формула пересчёта —
`docs/spec/60-ranking/`.
Изменения существующих сущностей: `User.locale`, `ArticleTranslation.bodyText`,
`followersNotifiedAt`, `searchVector` (generated column + GIN, raw SQL).

### 1.4. Этап 1: биллинг — ADR-0010, ADR-0035

```prisma
enum PspProvider         { tkassa yookassa }    // Т-Касса первой (журнал §8.14)
enum PlanInterval        { month year }
enum PlanStatus          { active archived }
enum SubscriptionStatus  { active past_due canceled expired }
enum PaymentKind         { subscription_charge plan_upgrade }
enum PaymentStatus       { pending succeeded canceled refunded }
enum PromoKind           { percent fixed }
enum AccessLevel         { free members }          // Article.access — зарезервировано (ADR-0036)

model Customer {                    // плательщик; один на пользователя
  id                 String      @id @default(uuid())
  userId             String      @unique         // → User, Restrict
  pspProvider        PspProvider
  pspCustomerId      String?
  pspPaymentMethodId String?                      // сохранённый способ для автоплатежей
  createdAt          DateTime    @default(now())
  updatedAt          DateTime    @updatedAt
  @@unique([pspProvider, pspCustomerId])
  @@map("customers")
}

model Plan {                        // платный план; free — не запись, а отсутствие подписки
  id         String       @id @default(uuid())
  tier       PlanTier                              // standard / pro; CHECK: tier <> 'free'
  name       String
  priceMinor Int
  interval   PlanInterval @default(month)
  features   Json                                  // коды возможностей и лимиты; читает хелпер прав
  status     PlanStatus   @default(active)
  createdAt  DateTime     @default(now())
  updatedAt  DateTime     @updatedAt
  @@unique([tier, interval, status])
  @@map("plans")
}

model Subscription {
  id                String             @id @default(uuid())
  customerId        String                         // → Customer, Restrict
  planId            String                         // → Plan, Restrict
  status            SubscriptionStatus
  startedAt         DateTime
  currentPeriodEnd  DateTime
  cancelAtPeriodEnd Boolean            @default(false)
  canceledAt        DateTime?
  promoCodeId       String?                        // → PromoCode
  createdAt         DateTime           @default(now())
  updatedAt         DateTime           @updatedAt
  @@index([customerId, status])
  @@index([status, currentPeriodEnd])               // продление, просрочка, истечение → planTier
  @@index([planId])
  @@map("subscriptions")
}

model Payment {                     // финансовая запись: никогда не удаляется, FK — Restrict
  id             String        @id @default(uuid())
  customerId     String
  subscriptionId String?
  kind           PaymentKind
  amountMinor    Int
  status         PaymentStatus @default(pending)
  pspProvider    PspProvider
  pspPaymentId   String
  receiptUrl     String?                          // чек 54-ФЗ формирует провайдер
  paidAt         DateTime?
  refundedAt     DateTime?
  refundMinor    Int?
  metadata       Json?                            // сырой ответ провайдера
  createdAt      DateTime      @default(now())
  updatedAt      DateTime      @updatedAt
  @@unique([pspProvider, pspPaymentId])
  @@index([customerId, createdAt(sort: Desc)])
  @@map("payments")
}

model PromoCode {
  id             String    @id @default(uuid())
  code           String    @unique
  kind           PromoKind
  value          Int                                  // проценты или копейки
  planId         String?                              // NULL — любой платный план
  maxRedemptions Int?
  redemptions    Int       @default(0)
  validFrom      DateTime?
  validUntil     DateTime?
  createdById    String
  createdAt      DateTime  @default(now())
  @@map("promo_codes")
}

model PspWebhookEvent {             // идемпотентная обработка вебхуков
  id          String      @id @default(uuid())
  pspProvider PspProvider
  eventId     String
  type        String
  payload     Json
  receivedAt  DateTime    @default(now())
  processedAt DateTime?
  error       String?
  @@unique([pspProvider, eventId])
  @@map("psp_webhook_events")
}
```

CHECK: `plans_tier_is_paid: tier <> 'free'`. Инвариант «`users.role = 'author'` ⇔ активная
подписка standard/pro ∨ действующий `plan_grants`» держит приложение (планировщик и вебхук) и
тест; в базе — нет, потому что срок подписки — функция времени. `PlanGrant` — раздел 1.1.
Выплат, `PayoutProfile`, `Payout`, донатов нет (ADR-0035).

### 1.5. Этап 4: рассылка, шаблоны

```prisma
enum NewsletterStatus { draft scheduled sending sent }

model NewsletterSubscriber {
  id             String    @id @default(uuid())
  email          String    @unique
  locale         Locale    @default(ru)
  userId         String?
  tokenHash      String    @unique                    // подтверждение и отписка
  confirmedAt    DateTime?
  unsubscribedAt DateTime?
  source         String?
  createdAt      DateTime  @default(now())
  updatedAt      DateTime  @updatedAt
  @@map("newsletter_subscribers")
}

model NewsletterIssue {
  id             String           @id @default(uuid())
  locale         Locale
  subject        String
  preheader      String?
  body           Json                                  // тот же ProseMirror, тот же рендер
  status         NewsletterStatus @default(draft)
  scheduledAt    DateTime?
  sentAt         DateTime?
  recipientCount Int?
  createdById    String
  createdAt      DateTime         @default(now())
  updatedAt      DateTime         @updatedAt
  @@index([status, scheduledAt])
  @@map("newsletter_issues")
}

model Template {                    // шаблон материала: каркас документа + предустановки
  id          String   @id @default(uuid())
  name        String
  description String?
  sectionId   String?
  formatId    String?
  body        Json
  createdById String
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt
  @@map("templates")
}
```

`MediaKind` получает `video`, `audio`, `file` отдельной миграцией.

Добавляются сущности, отсутствовавшие в ревизии 2 (журнал §25.6, §27.6, §27.7, #54):

```prisma
// Переписка по проверке (§25.6) — этап 1
model ReviewMessage {
  id             String   @id @default(uuid())
  translationId  String                       // → ArticleTranslation, Cascade
  authorId       String                       // → User: кто написал
  role           Role                         // снимок роли на момент сообщения
  body           String
  createdAt      DateTime @default(now())
  @@index([translationId, createdAt])
  @@map("review_messages")
}

// Фоновые задачи (§13.1) — этап 1; T-019
enum JobStatus { queued running completed failed cancelled stuck }
model Job {
  id           String     @id @default(uuid())
  kind         String
  status       JobStatus  @default(queued)
  objectType   String?
  objectId     String?
  parameters   Json?
  availableAt  DateTime   @default(now())
  startedAt    DateTime?
  finishedAt   DateTime?
  cancelledAt  DateTime?
  attemptCount Int        @default(0)
  createdAt    DateTime   @default(now())
  updatedAt    DateTime   @updatedAt
  @@index([status, availableAt])
  @@index([kind, status])
  @@index([objectType, objectId])
  @@map("jobs")
}

model JobAttempt {
  id              String    @id @default(uuid())
  jobId           String                        // → Job, Cascade
  number          Int
  status          JobStatus @default(queued)
  startedAt       DateTime?
  finishedAt      DateTime?
  errorRequestId  String?
  errorClass      String?
  createdAt       DateTime  @default(now())
  updatedAt       DateTime  @updatedAt
  @@unique([jobId, number])
  @@map("job_attempts")
}

// AI-процессы (§13.2) — этап 1; T-019
enum AiProcessKind   { check translate profile alt }
enum AiProcessStatus { created started running completed failed }
model AiProcess {
  id                  String          @id @default(uuid())
  jobId               String?                       // → Job, SetNull
  kind                AiProcessKind
  status              AiProcessStatus @default(created)
  objectType          String
  objectId            String
  model               String?
  promptVersion       String?
  verdict             String?
  reasons             Json?
  providerErrorClass  String?
  startedAt           DateTime?
  finishedAt          DateTime?
  durationMs          Int?
  createdAt           DateTime        @default(now())
  updatedAt           DateTime        @updatedAt
  @@index([kind, status, createdAt])
  @@index([objectType, objectId])
  @@map("ai_processes")
}

/// Стоимость хранится только в агрегатах, не у отдельного AI-процесса.
model AiCostAggregate {
  id             String        @id @default(uuid())
  bucketStart    DateTime
  bucketEnd      DateTime
  kind           AiProcessKind
  totalCostMinor BigInt
  processCount   Int
  createdAt      DateTime      @default(now())
  updatedAt      DateTime      @updatedAt
  @@unique([bucketStart, bucketEnd, kind])
  @@map("ai_cost_aggregates")
}

// История писем (§27.6, §13.1) — этап 1; T-019
enum MailDeliveryStatus { queued sent bounced failed }
model MailMessage {
  id                  String             @id @default(uuid())
  jobId               String?                        // → Job, SetNull
  template            String
  recipientEmail      String
  subject             String
  sanitizedBody       String                         // очищено: нет токенов и секретов
  status              MailDeliveryStatus @default(queued)
  objectType          String?
  objectId            String?
  provider            String?
  messageId           String?
  deliveryErrorClass  String?
  queuedAt            DateTime           @default(now())
  sentAt              DateTime?
  createdAt           DateTime           @default(now())
  updatedAt           DateTime           @updatedAt
  @@index([status, createdAt])
  @@index([recipientEmail])
  @@map("mail_messages")
}

model MailDeliveryEvent {
  id              String             @id @default(uuid())
  mailMessageId   String                              // → MailMessage, Cascade
  status          MailDeliveryStatus
  providerEventId String?
  errorClass      String?
  occurredAt      DateTime           @default(now())
  @@index([mailMessageId, occurredAt])
  @@map("mail_delivery_events")
}

// Сгруппированные записи ошибок бэкенда (§27.7) — этап 1; T-019
enum BackendErrorService    { api web worker }
enum BackendErrorWorkStatus { new_record in_progress resolved }
model BackendError {
  id                String                  @id @default(uuid())
  signature         String                  @unique
  service           BackendErrorService
  code              String
  errorClass        String?
  sanitizedMessage  String
  route             String?
  requestMethod     String?
  requestId         String?
  sanitizedStack    String?
  actorRole         Role?
  jobId             String?                             // → Job, SetNull
  workStatus        BackendErrorWorkStatus  @default(new_record)
  assignedActorId   String?
  assignedActorRole Role?
  firstSeenAt       DateTime               @default(now())
  lastSeenAt        DateTime               @default(now())
  occurrenceCount   Int                    @default(1)
  createdAt         DateTime               @default(now())
  updatedAt         DateTime               @updatedAt
  @@index([workStatus, lastSeenAt])
  @@index([service, code])
  @@map("backend_errors")
}

model BackendErrorStatusHistory {
  id                  String                  @id @default(uuid())
  backendErrorId      String                              // → BackendError, Cascade
  fromStatus          BackendErrorWorkStatus?
  toStatus            BackendErrorWorkStatus
  changedByActorId    String
  changedByActorRole  Role
  comment             String?
  createdAt           DateTime               @default(now())
  @@index([backendErrorId, createdAt])
  @@map("backend_error_status_history")
}

// Юридические тексты и согласия (ADR-0028) — этап 1; T-019
enum LegalTextKind   { terms privacy cookie content_policy moderation_rules imprint about }
enum LegalTextStatus { draft published archived }
model LegalText {
  id                  String          @id @default(uuid())
  kind                LegalTextKind
  locale              Locale
  version             Int
  status              LegalTextStatus @default(draft)
  body                String
  summaryOfChanges    String
  isMaterial          Boolean         @default(false)
  publishedAt         DateTime?
  publishedByActorId  String?
  publishedByRole     Role?
  createdAt           DateTime        @default(now())
  updatedAt           DateTime        @updatedAt
  @@unique([kind, locale, version])
  @@index([kind, locale, status])
  @@map("legal_texts")
}

model UserLegalConsent {
  id          String    @id @default(uuid())
  userId      String                          // → User, Cascade
  legalTextId String                          // → LegalText, Restrict
  acceptedAt  DateTime  @default(now())
  @@unique([userId, legalTextId])
  @@map("user_legal_consents")
}

// Исключения владельца со сроком (#54) — этап 1
model OwnerException {
  id        String   @id @default(uuid())
  userId    String                            // → User, Cascade
  expiresAt DateTime
  reason    String
  grantedById String                         // → User
  createdAt DateTime @default(now())
  @@index([userId, expiresAt])
  @@map("owner_exceptions")
}
```

### 1.6. Инварианты, которые держит приложение

| Инвариант | Где проверяется |
|---|---|
| У материала всегда есть версия с `locale = sourceLocale` | Создание материала и версии — одна транзакция |
| Слаг не занят ни версией, ни историей другого материала; не из списка зарезервированных | Один хелпер `assignSlug(locale, base, articleId)` |
| Базовые авторские возможности открыты ∨ активная подписка standard/pro ∨ действующий грант | Планировщик; хелпер `ensureAuthor`/`ensureExtendedAuthor`; тест (журнал §25.1, ADR-0035) |
| Редактор правит чужой текст только при `status = review`, всегда с ревизией `editorial` | Один хелпер `assertCanEditTranslation(user, translation)` (ADR-0036) |
| Любая отправка к публикации проходит `ai_check`, затем `review`/`in_review`; публикует только человек | `submitTranslation` и `publishManual`/`approveTranslation`; прямого `draft → published` нет (ADR-0045) |
| `analyst` не имеет ни одной мутации | Контрактный тест по SDL (ADR-0042) |
| Пересчёт `ArticleScore` детерминирован; закладки в него не входят | Тест на фикстуре (ADR-0034, ADR-0041) |
| Гость и `reader` видят только `status = published` в нужной локали | Один `where`-конструктор для публичных резолверов |
| Не ноль `owner`; нельзя снять последнего владельца | Транзакция передачи владения + тест (журнал §26.7) |
| `Article.access` всегда `free`, пока paywall не включён отдельным ADR | Тест: публичные резолверы поле не читают (ADR-0036) |

### 1.7. Индексы под известные запросы

| Запрос | Таблица и индекс |
|---|---|
| Материал по адресу `/{section}/{slug}`, `/en/…` | `article_translations (locale, slug)` unique; промах → `article_slug_history (locale, slug)` |
| Лента: последние опубликованные в локали (главная, RSS, sitemap) | `article_translations (locale, status, publishedAt DESC)` |
| Ленты по рейтингу: главная, рубрика, тег, автор (2) | `article_scores (score DESC)` + join версий локали со `status = published`; до этапа 2 — индекс лент по дате |
| Рубрика | `articles (sectionId)` + индекс версий |
| Автор (публично и кабинет) | `articles (authorId, createdAt DESC)` + версии по `(articleId, locale)` |
| Тег | `_ArticleToTag (B)` + версии |
| Очередь проверки, админский фильтр по статусу | `article_translations (status, reviewRequestedAt)` |
| Прочтения за окно для рейтинга (2) | `article_read_daily (day)` → sum минус `read_exclusions` |
| Ревизии версии | `article_revisions (translationId, createdAt DESC)` |
| Сессия по refresh-токену, отзыв | `sessions (tokenHash)`, `(previousTokenHash)`, `(userId)` |
| Автор `/authors/{handle}` | `users (handle)`; промах → `handle_history (handle)` |
| Медиа автора | `media_assets (ownerId, createdAt DESC)` |
| Закладки пользователя | `bookmarks (userId, createdAt DESC)` |
| AI-вердикт версии | `article_ai_checks (translationId, createdAt DESC)` |
| Истечение подписок и грантов | `subscriptions (status, currentPeriodEnd)`; `plan_grants (userId, endsAt)` |
| Поиск (этап 3) | GIN по `article_translations.searchVector` |

---

## 2. Изменения enum при данных в базе

| Enum | Изменение | Механика | Опасности |
|---|---|---|---|
| `Role` | + `moderator`, + `owner`, + `analyst` | `ALTER TYPE "Role" ADD VALUE …` — так и оставить. **Не** повторять паттерн `update_roles` (пересоздание через `Role_new`): он нужен только при удалении значений и держит `ACCESS EXCLUSIVE` на `users` | Новое значение нельзя использовать в той же транзакции: никаких `UPDATE users SET role = 'owner'` и `DEFAULT` в этой миграции |
| `ArticleStatus` | Переезжает с `articles.status` на `article_translations.status` | Тип не меняется: новая колонка того же типа, бэкфилл, удаление старой | Нет |
| `ContentTypeStatus` | → `SectionStatus` | `ALTER TYPE … RENAME TO` — метаданные, мгновенно. Prisma при переименовании генерирует DROP/CREATE — миграцию править руками (раздел 3.2) | Нет |
| Новые enum | `CREATE TYPE` | Можно сразу использовать в `ADD COLUMN … DEFAULT` | Нет |
| `ArticleStatus` | + `ai_check`, `in_review`, `rework` (M9a) | `ADD VALUE` отдельными миграциями перед M9 | Использовать только из кода этапа 1 |
| `MediaKind` | Будущие `ADD VALUE` | Отдельная миграция на добавление, следующая — на использование | То же правило |

Безопасный порядок при данных:

1. **Добавление значения**: миграция только с `ADD VALUE` → код, который пишет значение →
   бэкфилл отдельным скриптом (`owner` назначается скриптом по e-mail владельца, не
   миграцией).
2. **Перенос колонки**: новая колонка тем же типом с `NOT NULL DEFAULT` (на PostgreSQL ≥ 11
   мгновенно) → бэкфилл в той же транзакции → CHECK → удаление старой.
3. **Переименование типа**: `ALTER TYPE … RENAME TO` вместе с переименованием модели; после —
   `prisma migrate diff` пуст.
4. **Удаление значения**: только пересоздание типа с guard-запросом
   (`RAISE EXCEPTION`, если значение используется).

Механика переименований в Prisma: изменить `schema.prisma` → `prisma migrate dev --create-only`
→ заменить в `migration.sql` пары DROP/CREATE на `ALTER TABLE … RENAME TO`, `RENAME COLUMN`,
`ALTER TYPE … RENAME`, `RENAME CONSTRAINT`, `ALTER INDEX … RENAME` с именами, которые сгенерировал
бы Prisma (`{table}_{column}_fkey`, `{table}_{column}_key`, `{table}_pkey`) → `migrate dev` →
`prisma migrate diff --from-migrations … --to-schema-datamodel …` = «No difference detected».

---

## 3. Путь миграций от текущей схемы

### 3.0. Подготовка (один раз, до M1)

| Шаг | Действие | Зачем |
|---|---|---|
| Вынести `prisma migrate deploy` из `build` в отдельный шаг релиза [ФАКТ: `server/package.json:8`] | Сейчас миграции применяются при каждой сборке; M11 нельзя применять до проверки данных |
| Починить `prisma:seed` (`seed/seed.ts` не существует [ФАКТ: `server/package.json:16`]): сид идемпотентный (`upsert` по `slug`) — 6 рубрик, 4 формата, владелец, тестовые материалы | Пустая база поднимается одной командой |
| `npx prisma migrate status` → «Database schema is up to date» | Иначе сначала выровнять |
| `pg_dump -Fc --no-owner "$DATABASE_URL_UNPOOLED" > altera-pre-v2.dump` | Единственный настоящий откат для деструктивных шагов |
| Снять счётчики `count(*)` по `users`, `articles`, `content_types`, `section_tags`, `_ArticleToSectionTag` и контрольную сумму материалов (3.4) | Сверка после каждой миграции |
| Репетиция на копии: ветка Neon от прода → весь путь M1–M11 + проверки → только потом прод | Neon здесь — инструмент репетиции, не зависимость рантайма |

Prisma не имеет down-миграций: «откат» — либо новая forward-миграция, либо восстановление
дампа.

### 3.1. Список миграций

| № | Имя | Этап | Что добавляет | Бэкфилл | Откат |
|---|---|---|---|---|---|
| M1 | `role_add_moderator_owner_analyst` | 0 | 3 значения `Role` | нет | практически — оставить |
| M2 | `sessions_and_magic_link_hash` | 0 | `sessions`; `magic_link_tokens.token → tokenHash` | `DELETE FROM magic_link_tokens` (живут 15 минут) | `DROP TABLE sessions`, rename обратно |
| M3 | `users_handle_plan_block_consent` | 1 | `slug → handle` + нормализация; `PlanTier`, `planTier`, `planUntil`, `archivedAt/archivedByActorId/archiveReason/archiveMode` (заменяют `blocked*`), `deletedAt`, `lastLoginAt`, `consentVersion`, `consentAt`, `prevAvatarId`; временная таблица `_v2_legacy_authors` | список авторов с опубликованным (для гранта в M9) | rename обратно, drop колонок и таблицы |
| M4 | `taxonomy_sections_formats_tags` | 1 | rename `content_types → sections`, `ContentTypeStatus → SectionStatus`, `typeId → sectionId`, `section_tags → tags`, `_ArticleToSectionTag → _ArticleToTag`; `nameEn/descriptionEn`; `formats`; `articles.formatId`; индекс `sectionId` | нет (форматы — сидом) | обратные rename, drop `formats` |
| M5 | `article_translations` | 1 | `Locale`; `articles.sourceLocale/firstPublishedAt`, `featuredImage → legacyFeaturedImage`; таблица версий; **перенос строк**; **конверсия body → JSON**; удаление перенесённых колонок; индексы; CHECK | да, SQL в 3.2 | forward-миграция «обратно» (3.2) или дамп |
| — | скрипт `verify:legacy-bodies` | 1 | не миграция: валидация JSON схемой + сверка текста | — | — |
| M6 | `article_revisions` | 1 | таблица; `article_translations.sourceRevisionId` | базовая ревизия на каждую версию | `DROP TABLE` |
| M7 | `slug_and_handle_history` | 1 | `article_slug_history`, `handle_history` | нет | `DROP` ×2 |
| M8 | `media_assets` | 1 | `MediaKind`, `MediaLicense`, таблица; `articles.coverAssetId`, `users.avatarAssetId` | нет (обложки — dev-скрипт импорта, если есть реальные) | drop колонок и таблицы |
| M9a | `article_status_add_ai_check` | 1 | значения `ai_check`, `in_review`, `rework` | нет | оставить |
| M9 | `billing_reports_bookmarks_ai_audit` | 1 | биллинг раздела 1.4, `plan_grants`, `reports`, `bookmarks`, `article_ai_checks`, `audit_log`, `articles.access`, `submittedAt`/`appealedAt`; enum | грант `standard` для `_v2_legacy_authors`, `planTier`/`planUntil` | `DROP` (до первого платежа) |
| M9b | `admin_operational_records` | 1 | `Job`, `JobAttempt`, `AiProcess`, `AiCostAggregate`, `MailMessage`, `MailDeliveryEvent`, `BackendError`, `BackendErrorStatusHistory`, `LegalText`, `UserLegalConsent`; 9 enum значений | нет | `DROP` |
| M10 | `review_notes` | 4 | 1 таблица | нет | `DROP` |
| M11 | `drop_legacy_columns` | конец 1 | `DROP COLUMN legacyBody, legacyFeaturedImage` | нет; **только после** `verify:legacy-bodies` = 0 расхождений и импорта обложек | только дамп |
| M12 | `reads_and_ranking` | 2 | `engagement_events`, `article_read_daily`, `read_exclusions`, `article_scores`, `author_scores`, `ranking_configs` | конфигурация рейтинга по умолчанию (версия 1) | `DROP` |
| M13 | `follows_user_locale_translation_jobs` | 3 | `author_follows`, `translation_jobs`, `User.locale`, `ArticleTranslation.followersNotifiedAt` | нет | `DROP`, drop колонок |
| M14 | `search_vector` | 3 | `bodyText`; generated `searchVector` + GIN (raw SQL) | скрипт заполняет `bodyText` из `body` | drop колонок |
| M16 | `newsletter` | 4 | 2 таблицы | нет | `DROP` |
| M17 | `templates_media_kinds` | 4 | таблица; `MediaKind` + `video/audio/file` | нет | `DROP` |

Порядок M3 → M5 важен: `_v2_legacy_authors` в M3 строится по `articles.status`, которого
после M5 нет; M9 выдаёт гранты по этой таблице, M11 её удаляет. Номер M15 не используется
(биллинг вошёл в M9).

### 3.2. Нетривиальные миграции

**M2 — сессии.** Создать `sessions` с индексами; `DELETE FROM magic_link_tokens` (открытые
токены нельзя превратить в хэши; они живут 15 минут); `RENAME COLUMN token TO tokenHash`;
переименовать unique-индекс; удалить дублирующий индекс. Проверка: логин через ссылку создаёт
строку сессии; `refresh` меняет `tokenHash`, старый попадает в `previousTokenHash`; повторное
предъявление старого → `revokedAt`.

**M3 — пользователи.** Переименовать `slug → handle`, снять unique на время нормализации,
привести к `[a-z0-9-]`, разрешить дубликаты суффиксом `-2`, `-3` по порядку создания, короткие
(< 3 символов) дополнить фрагментом `md5(id)`, вернуть unique. Добавить `PlanTier`, колонки
`planTier` (default `free`) и `planUntil`; зафиксировать авторов с опубликованным материалом,
пока `articles.status` существует (грант выдаёт M9):

```sql
CREATE TABLE "_v2_legacy_authors" AS
SELECT DISTINCT a."authorId" AS "userId" FROM "articles" a WHERE a."status" = 'published';
```

Существующие хэндлы всё ещё равны локальной части e-mail: для реальных людей после M7 —
замена на `u-{8 hex}` с записью в `handle_history` (или просьба сменить). Проверка:
`SELECT handle FROM users WHERE handle !~ '^[a-z0-9-]{3,32}$'` → 0; `count(users)` не изменился.

**M4 — таксономия.** Только `RENAME` таблиц, колонок, ограничений, индексов и типа;
`CREATE TABLE formats`; `articles.formatId` с FK `SET NULL`; индекс `articles_sectionId_idx`.
В `schema.prisma` модель `Tag` с `articles Article[]` **без** имени relation (тогда Prisma ждёт
таблицу `_ArticleToTag`). Проверка: `migrate diff` пуст; счётчики совпадают.

**M5 — версии и конверсия тела.** Порядок внутри одной транзакции:

1. Тип `Locale`; колонки `articles.sourceLocale`, `firstPublishedAt`;
   `featuredImage → legacyFeaturedImage`; таблица `article_translations`.
2. Перенос строк: для каждого `articles` — версия с `locale = ru`, копией `slug/title/dek/
   excerpt/status/publishedAt/createdAt/updatedAt`, `legacyBody = body`, `body` = маркер
   `{"type":"doc","content":[]}`; `id` — `gen_random_uuid()::text` (Prisma DEFAULT в базе не
   ставит).
3. Инвариант «опубликовано ⇒ есть дата»: `publishedAt = createdAt` там, где пусто;
   `articles.firstPublishedAt` из русской версии.
4. Конверсия: пустая строка между абзацами → `paragraph`, одиночный перенос → пробел,
   пустые абзацы выбрасываются; пустой `legacyBody` → документ с одним пустым абзацем:

```sql
UPDATE "article_translations" t
SET "body" = COALESCE((
  SELECT jsonb_build_object('type', 'doc', 'content',
    jsonb_agg(jsonb_build_object('type', 'paragraph', 'content',
      jsonb_build_array(jsonb_build_object('type', 'text', 'text', p.txt))) ORDER BY p.ord))
  FROM (
    SELECT s.ord, btrim(regexp_replace(s.chunk, '\s*\n\s*', ' ', 'g')) AS txt
    FROM regexp_split_to_table(replace(t."legacyBody", E'\r', ''), '\n[ \t]*\n+') WITH ORDINALITY AS s(chunk, ord)
  ) p
  WHERE p.txt <> ''
), '{"type":"doc","content":[{"type":"paragraph"}]}'::jsonb)
WHERE t."legacyBody" IS NOT NULL AND t."body" = '{"type":"doc","content":[]}'::jsonb;
```

5. Ограничения и индексы: `@@unique([articleId, locale])`, `@@unique([locale, slug])`,
   индекс лент, индекс очереди, FK, CHECK «опубликовано ⇒ дата», CHECK «body ≠ маркер» (гарантия,
   что миграция не завершится с неконвертированной строкой).
6. Удаление перенесённых колонок из `articles`; индекс `(authorId, createdAt DESC)`.

Если в `legacyBody` окажется Markdown (`##`, `**`), правило «абзацы по пустой строке» оставит
разметку буквальным текстом — тогда `verify:legacy-bodies --reconvert` перезаписывает `body`
конвертером Markdown → JSON из пакета `content`, пока `legacyBody` существует. Локаль всех
существующих строк — `ru`; если среди них английские тексты, поправить `locale` руками до M11.

Откат M5 — forward-миграция, пока `legacyBody` существует: вернуть колонки в `articles`,
заполнить из русской версии (`body` из `legacyBody`), восстановить `articles_slug_key`,
удалить `article_translations` и новые типы. После M11 — только дамп.

**Скрипт `verify:legacy-bodies`** (только чтение): для каждой строки с `legacyBody` —
(1) `schema.nodeFromJSON(body).check()` — 0 исключений; (2) текст документа с
нормализованными пробелами равен нормализованному `legacyBody` — 0 расхождений; (3) число
абзацев равно числу непустых фрагментов между пустыми строками. Результат — вход для решения
о M11.

**M6 — ревизии.** Таблица; базовая ревизия на каждую версию (`kind = publish` для
опубликованных, иначе `manual`; `createdById = authorId`; `note = 'import: baseline v2'`;
`createdAt = updatedAt` версии); затем `sourceRevisionId`. Проверка:
`count(article_revisions) = count(article_translations)`.

**M8 — медиа.** Бэкфилла нет: `legacyFeaturedImage` — внешние адреса, а `MediaAsset` живёт
только в нашем S3. Импорт — dev-скрипт «скачать → загрузить → создать asset → проставить
`coverAssetId`», если на проде есть строки с реальными обложками; если ноль — M11 просто
удаляет колонку.

**M14 — поиск.** `bodyText` заполняется скриптом; `searchVector` — generated column
`to_tsvector(CASE locale WHEN 'ru' THEN 'russian' ELSE 'english' END, title ‖ dek ‖ bodyText)`
и GIN через raw SQL; в `schema.prisma` — `Unsupported("tsvector")?` и `@@index(..., type: Gin)`.

**M9 — биллинг, жалобы, закладки, AI, аудит.** После M9a (`ADD VALUE 'ai_check'`). Таблицы
раздела 1.4, `plan_grants`, `reports`, `bookmarks`, `article_ai_checks`, `audit_log`;
`articles.access` (зарезервировано, default `free`); `article_translations.submittedAt`,
`appealedAt`; CHECK `plans_tier_is_paid`. Бэкфилл: `INSERT INTO plan_grants (userId, tier,
endsAt, grantedById, reason) SELECT userId, 'standard', <дата> [ДОПУЩЕНИЕ], <owner>, 'import:
legacy author' FROM _v2_legacy_authors`; затем `users.planTier = 'standard'`, `planUntil =
<дата>` для них. Проверка: у каждого автора с опубликованным материалом есть грант;
`count(users WHERE planTier = 'standard') = count(_v2_legacy_authors)`. `_v2_legacy_authors`
удаляется в M11.

### 3.3. Пустая база и база с данными

| | Пустая база (dev, превью) | База с данными (прод) |
|---|---|---|
| Как применять | `prisma migrate reset` (все M подряд) + `prisma db seed`; бэкфиллы — no-op на нуле строк | `pg_dump` → репетиция на ветке → `migrate deploy` до **M9 включительно** → `verify:legacy-bodies` → импорт обложек → M11 отдельным релизом |
| Конверсия тел | Нечего конвертировать; сид создаёт материалы в JSON | SQL внутри M5; проверка скриптом; при Markdown — reconvert |
| Хэндлы | Сид задаёт явно | Нормализация в M3, затем замена на случайные с историей |
| `owner` | Сид создаёт владельца | Скрипт по e-mail после M1 |
| Проверка drift | `migrate diff` пуст после каждой миграции — шаг CI | То же плюс счётчики и контрольные суммы |
| Откат | `migrate reset` | forward-миграция или дамп; после M11 — только дамп |
| Переезд в РФ | — | После миграций этапа 1: `pg_dump -Fc` → `pg_restore` в РФ-инстанс (`_prisma_migrations` едет вместе с дампом) → `DATABASE_URL`; бакет — `rclone sync` |

### 3.4. Проверки по шагам

| После | Проверка | Ожидание |
|---|---|---|
| M1 | `SELECT enum_range(NULL::"Role")` | `{reader,author,editor,moderator,analyst,admin,owner}` |
| M2 | `\d magic_link_tokens`; `count(sessions)` | колонка `tokenHash`, один unique; 0 |
| M3 | `count(users)` = снимок; хэндлы по регулярному выражению; unique создан | |
| M4 | `count(sections)`, `count(tags)`, `count("_ArticleToTag")` = снимок; `migrate diff` пуст | |
| M5 | `count(articles) = count(article_translations WHERE locale='ru')`; контрольная сумма `md5(string_agg(title‖slug‖status‖publishedAt ORDER BY id))` до и после совпадает; строк с маркером 0; `firstPublishedAt` заполнен у опубликованных | |
| скрипт | 0 невалидных документов, 0 расхождений текста | |
| M6 | `count(article_revisions) = count(article_translations)` | |
| M7–M9 | `migrate diff` пуст; новые таблицы пусты, кроме `plan_grants` (= `count(_v2_legacy_authors)`) и `users.planTier` | |
| M11 | только после скрипта; `\d article_translations` без `legacyBody`; `_v2_legacy_authors` удалена | |
| каждый шаг | `prisma migrate status` без pending; `tsc --noEmit`; smoke-запрос материала по адресу | |

---

## 4. Напряжения и решения

### 4.1. Статус на версии или на материале

Статус только на `ArticleTranslation`; у `Article` статуса нет, даже производного.
«Опубликованный материал» в списке = версия локали запроса со `status = published`. Ленты,
страницы рубрик, авторов, тегов, RSS и sitemap строятся по версиям локали. Материал только с
английской версией на русском сайте не показывается нигде; `/en/…` работает; hreflang
связывает только опубликованные сёстры. Никакого «показать английский текст русскому
читателю с пометкой». Админский список и очередь — по версиям с бейджем локали; «архивировать
материал» = архивировать все версии одной транзакцией. Отдельного `translation_review` нет.

### 4.2. `publishedAt` версии и дата первой публикации материала

Оба поля, разные обязанности. `ArticleTranslation.publishedAt` — первая публикация версии,
порядок в ленте своей локали, при повторной публикации **не** сбрасывается (текущий код
сбрасывает [ФАКТ: `server/src/graphql/article/resolver.ts:640`] — для журнала это ошибка:
исправленный текст не должен всплывать наверх). `Article.firstPublishedAt` — первая публикация
в любой локали, ставится один раз; это дата материала в шапке обеих версий и порядок в
подборках.

### 4.3. Область уникальности слага

`@@unique([locale, slug])`. Не на (локаль, рубрика): рубрику меняет редакция, и слаг мог бы
столкнуться в новой; при уникальности на локаль перенос — только редирект. Не глобально:
RU и EN версии могут иметь одинаковый латинский слаг (`/photo/venice` и `/en/photo/venice`).
Уникальность распространяется на черновики (черновик резервирует слаг). Проверяется и против
истории.

### 4.4. Где живёт план и роль

Истина о плане — `subscriptions` (и `plan_grants` для исключений); `users.planTier` и
`planUntil` — кэш, который обновляют вебхук провайдера и планировщик истечения. Роль
`author` — производная: хелпер прав читает кэш, а инвариант «роль ⇔ подписка» проверяет
планировщик и тест, не CHECK (срок — функция времени). Расхождение кэша и подписки чинится
пересчётом, не интерфейсом. Грейд автора (`basic | pro`) не хранится — вычисляется из
`planTier` (ADR-0037); при истечении статьи остаются, права закрываются (ADR-0044).

### 4.5. Рейтинг как материализованное представление

`article_scores` — не истина, а производная от прочтений, AI-оценок, бустов, планов и
`ranking_configs`; её можно снести и пересчитать целиком. Хранится ради дешёвых лент и
воспроизводимости: `components` и `configVersion` объясняют каждый балл. Пересчёт — по событиям
(публикация, буст, оценка, исключение прочтений) и полный ночью; ленты читают только таблицу.
Отдельные веса по локали — YAGNI: одна конфигурация, один балл на материал.

### 4.6. AI-записи и ревизии

`article_ai_checks` привязаны к ревизии (`@@unique([revisionId])`): у каждой публикуемой
ревизии — свой вердикт с причинами; история не перезаписывается. Смена промта или модели не
пересчитывает старые записи; повторная проверка — новая ревизия или ручной повтор из админки.
Текст ревизии провайдеру уходит без ПДн; в записи хранятся только структурированный ответ и
стоимость. Балла нет (журнал #41).

### 4.7. Политика удаления по сущностям

| Сущность | Политика |
|---|---|
| Материал | `deletedAt` **нет**. Никогда не публиковавшийся (`firstPublishedAt IS NULL`) — hard delete с каскадом. Публиковавшийся — удалить нельзя, только архив каждой версии; адрес отвечает «снято» (410) |
| Пользователь | Только анонимизация («надгробие»): `deletedAt`, e-mail → технический, имя → «удалённый автор», хэндл → случайный (старый в историю не пишется), профиль очищен, сессии и ссылки для входа удалены. Материалы — по умолчанию все версии в `archived`; выбор «оставить с подписью» применяется в момент удаления; активная подписка отменяется; закладки удаляются каскадом |
| Медиа | `deletedAt` (единственный soft delete этапа 1); физическая чистка — этап 5 |
| Сессии, magic link, `engagement_events` | Hard delete по сроку в housekeeping |
| Ревизии | Прореживание по 4.9 |
| Платежи, подписки, гранты, аудит | Никогда не удаляются; FK `Restrict` |
| AI-записи, бусты, рейтинг | Каскад с материалом (удаляется только никогда не публиковавшийся); `article_scores` пересчитываются |
| Рубрика | `status = archived`; FK `Restrict` — сначала переназначить материалы |
| Формат, тег | Hard delete: формат — `SET NULL`; тег — каскад по join-таблице или `mergeTags` |

### 4.8. Владение медиа после удаления автора

`ownerId` остаётся указывать на надгробие (`Restrict`). Владелец — «кто отвечает за права»
(ADR-0008); `attribution` и `license` остаются дословно. Файлы не удаляются, пока на них
ссылается хотя бы одна версия, ревизия или обложка; неиспользуемые ассеты помечаются
`deletedAt`. Передача «платформенному пользователю» отвергнута: стирает атрибуцию
ответственности.

### 4.9. Хранение ревизий

Создание: `publish` — на каждую публикацию; `editorial` — на каждое сохранение не автором;
`manual` — по кнопке; `autosave` — не чаще одного снимка в 5 минут на версию (свежий
перезаписывает предыдущий). Хранение: `publish`, `editorial`, `manual` — бессрочно; `autosave` —
последние 20 на версию, лишние удаляются в той же транзакции, что вставка. Оценка объёма —
ADR-0007.

### 4.10. Вовлечённость без профилирования

`visitorId` — анонимный идентификатор без IP; уникальность событий в пределах (день,
материал, visitorId, kind). Детальная модель `visitorId`, виды событий и окна хранения
определяются в `60-ranking/engagement-tracking.md` (журнал §23). Housekeeping (один скрипт по
расписанию): `engagement_events` старше установленного срока, сессии старше 30 дней после
истечения, использованные magic link, прореживание `autosave`. Боты отсекаются по user-agent.
Redis для HyperLogLog не используется (ADR-0019).

### 4.11. Локализация справочников

Две локали → пара колонок `name`/`nameEn` (и `title`/`titleEn`), не таблицы переводов. Слаг
один, латинский, общий. Теги — `name` плюс необязательный `nameEn`; кириллица на EN-сайте
терпима и лечится слиянием.

---

## 5. Что сознательно не моделируем

| Не делаем | Почему |
|---|---|
| Производный `Article.status` | Дублирует версии, расходится при первом баге; списки всегда по локали |
| `translation_review` | Общий `review` + `translatorId` достаточно (ADR-0002) |
| Таблица вариантов изображений, `MediaUsage` | JSON `variants`; «где используется» — этап 5 при потребности |
| Таблицы переводов справочников | Две локали, десятки строк — колонки |
| Общий `deletedAt` | Раздел 4.7 |
| Соавторы (`ArticleAuthor` M:N) | Одна подпись + `translatorId`; не запрашивалось |
| Отложенная публикация (`scheduledAt`) | Одна колонка на этапе 5 (профессиональный инструмент) |
| Хранение diff между ревизиями | Вычисляется из двух снимков |
| Очередь уведомлений, таблица `Notification` | Колонка `followersNotifiedAt` |
| `PromoRedemption` | Колонка `Subscription.promoCodeId` |
| Уровни доверия | Проверка двухступенчатая для всех (ADR-0045, ADR-0037) |
| Выплаты авторам, `PayoutProfile`, `Payout`, донаты | Только планы пользователя (ADR-0035) |
| `EditorialPick`, `Commission`, `Collection` | Витрины, заказов и подборок нет (ADR-0036) |
| Персональные веса рейтинга, рейтинг на чтении | Материализованный `ArticleScore`, одинаковый для всех (ADR-0034) |
| Валюта в платежах | Только RUB |
| OAuth-аккаунты (`Account`) | ADR-0022 |
| Комментарии, реакции | ADR-0026 |
| Прочтения по локали и по пользователю | Метрика — о материале; по пользователю — профилирование |
| Частичные unique-индексы, deferrable-ограничения | Prisma их не моделирует → drift |
| `@db.Uuid`, uuid v7, ULID | Смешение с существующими TEXT-id дороже пользы |
| Мультитенантность, ClickHouse, внешние очереди | ADR-0043; очередь фоновых задач — таблица в базе |

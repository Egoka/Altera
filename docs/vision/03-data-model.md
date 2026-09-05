# Модель данных: целевая схема и путь от текущей

- **Статус**: принято владельцем 2026-09-05 (решения ADR-0001…ADR-0010, ADR-0013, ADR-0027).
- **Основание**: `server/prisma/schema.prisma` и четыре миграции июля 2025
  [ФАКТ: `docs/vision/00-reality-check.md` §2]; содержимое прод-базы не проверялось
  [НЕ ПРОВЕРЕНО].
- Этот документ владеет сущностями, полями, enum, индексами, инвариантами и миграциями.
  Права — в `04-roles-and-access.md`, процесс редактирования — в `05-editor.md`.
- Формат: таблицы полей для центральных сущностей, псевдо-схема Prisma для остальных, SQL
  бэкфилла там, где он нетривиален. Это проект, а не миграции: миграции создаются на этапах
  роадмапа и только с именем.

---

## 0. Соглашения

| Правило | Почему |
|---|---|
| `id String @id @default(uuid())` → `TEXT`, как в существующих таблицах; `@db.Uuid` не вводим | Смешение типов в внешних ключах дороже 20 байт на строку |
| Исключение — append-only таблицы (`read_events`, `audit_log`): `BigInt @id @default(autoincrement())` | Дешёвая вставка, естественный порядок |
| Таблицы — snake_case через `@@map`; колонки — camelCase без `@map` (как сейчас: `"publishedAt"`) | Один стиль; полусмешанная схема хуже любой из чистых |
| `createdAt @default(now())`, `updatedAt @updatedAt` везде, кроме append-only | Как сейчас |
| Enum Prisma = тип PostgreSQL. Добавление значения — `ALTER TYPE … ADD VALUE` в **отдельной** миграции; использовать новое значение в той же транзакции нельзя | Ограничение PostgreSQL |
| Деньги — `Int` в копейках (`…Minor`); валюта — константа RUB в коде | Международный биллинг не проектируем |
| `enum Locale { ru en }`; русский без префикса | ADR-0002 |
| Soft delete по умолчанию **нет**; исключения — раздел 4.7 | Каждый `deletedAt` — фильтр в каждом запросе навсегда |
| Индексы — только под известные запросы (раздел 1.8) | Лишний индекс — цена на каждой записи |
| CHECK-ограничения — raw SQL в миграции; Prisma их не моделирует и не трогает при diff | Инварианты вроде «опубликовано ⇒ есть дата» дешевле держать в базе |
| Частичные unique-индексы не используем | Prisma их не поддерживает: drift при каждом diff |
| Персональные данные (152-ФЗ) живут только в PostgreSQL: `users.email/name/socialLinks`, `sessions.ip/userAgent`, `reports.reporterEmail`, `payout_profiles.*`, `newsletter_subscribers.email`. В S3 — только медиа | Перенос в РФ = дамп базы + бакет (ADR-0011) |

---

## 1. Каталог сущностей по этапам

### 1.1. Этапы 0–1: модель v2

Состав: `User` (изменён), `MagicLinkToken` (изменён), `Session`, `HandleHistory`, `Section`
(бывший `ContentType`), `Format`, `Tag` (бывший `SectionTag`), `Article` (изменён),
`ArticleTranslation`, `ArticleRevision`, `ArticleSlugHistory`, `MediaAsset`, `EditorialPick`,
`Report`, `Commission`. `Session` и значения `moderator`/`owner` появляются на этапе 0
(миграции M1–M2), остальное — на этапе 1.

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
| role | Role | нет | reader | `reader/author/editor/moderator/admin/owner` |
| trustLevel | TrustLevel | нет | probation | ADR-0013 |
| trustChangedAt | DateTime? | да | — | |
| trustChangedById | String? → User | да | — | Кто повысил или сбросил |
| socialLinks | Json? | да | — | Как сейчас |
| blockedAt | DateTime? | да | — | ADR-0014: заморозка; сессии отозваны, вход запрещён |
| blockedById | String? → User | да | — | |
| blockReason | String? | да | — | |
| deletedAt | DateTime? | да | — | Аккаунт анонимизирован; запись остаётся как «надгробие» |
| lastLoginAt | DateTime? | да | — | |
| consentVersion | String? | да | — | Версия оферты и политики ПД, с которой согласился (ADR-0028) |
| consentAt | DateTime? | да | — | |
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
| contour | Contour | нет | open | `open \| editorial` (ADR-0006); свойство материала, не версии |
| sourceLocale | Locale | нет | ru | Инвариант: версия с этой локалью существует всегда |
| firstPublishedAt | DateTime? | да | — | Ставится **один раз**, когда любая версия впервые опубликована; не сбрасывается |
| coverAssetId | String? → MediaAsset (SetNull) | да | — | Общая обложка |
| legacyFeaturedImage | String? | да | — | Бывший `featuredImage` (внешний URL); до M11 |
| access | AccessLevel | нет | free | **Этап 4**; CHECK: `contour = 'editorial' OR access = 'free'` |
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
| status | ArticleStatus | нет | draft | `draft/review/published/archived` — тот же тип PostgreSQL |
| publishedAt | DateTime? | да | — | Первая публикация версии; при повторной публикации **не** сбрасывается. CHECK: `status <> 'published' OR publishedAt IS NOT NULL` |
| reviewRequestedAt | DateTime? | да | — | Порядок очереди проверки |
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
| alt | String? | да | — | Значение по умолчанию; узел документа может переопределить |
| caption | String? | да | — | |
| attribution | String | нет | — | Обязательна |
| license | MediaLicense | нет | — | Обязательна |
| licenseNote | String? | да | — | Ссылка на источник или условия |
| placeholder | String? | да | — | LQIP/blurhash |
| deletedAt | DateTime? | да | — | **Единственный** soft delete этапа 1 |
| createdAt, updatedAt | DateTime | нет | | |

Индексы: `@@unique([storageKey])`, `@@index([ownerId, createdAt(sort: Desc)])`, `@@index([sha256])`.

#### EditorialPick (`editorial_picks`) — ADR-0016

| Поле | Тип | Null | Default | Примечание |
|---|---|---|---|---|
| id | String @id | нет | uuid() | |
| articleId | String → Article (Cascade) | нет | — | Отбирается материал, не версия (4.5) |
| placement | PickPlacement | нет | — | `home`, `showcase` |
| position | Int | нет | 0 | Сортировка `position, startsAt desc` |
| startsAt | DateTime | нет | now() | |
| expiresAt | DateTime? | да | — | NULL — бессрочно |
| pickedById | String → User (Restrict) | нет | — | |
| note | String? | да | — | Внутренняя пометка |
| createdAt, updatedAt | DateTime | нет | | |

`@@unique([placement, articleId])` — повторный отбор = обновление строки; история — в
`audit_log`. `@@index([placement, position])`.

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

#### Commission (`commissions`) — ADR-0006

```prisma
model Commission {                  // заказной материал; Article.contour обязан быть editorial (проверка в резолвере)
  id          String           @id @default(uuid())
  articleId   String           @unique          // → Article, Restrict
  editorId    String                            // → User, кто заказал
  status      CommissionStatus @default(proposed)   // proposed / accepted / delivered / paid / cancelled
  brief       String?
  feeMinor    Int?                              // копейки; NULL — без гонорара
  deadline    DateTime?
  terms       String?                           // условия, включая судьбу материала при удалении аккаунта
  agreedAt    DateTime?
  deliveredAt DateTime?
  createdAt   DateTime         @default(now())
  updatedAt   DateTime         @updatedAt
  @@map("commissions")
}
```

#### Enum модели v2

```prisma
enum Role             { reader author editor moderator admin owner }
enum SectionStatus    { active archived }                       // переименованный ContentTypeStatus
enum ArticleStatus    { draft review published archived }       // без изменений, теперь на версии
enum Locale           { ru en }
enum Contour          { open editorial }
enum TrustLevel       { probation trusted }
enum RevisionKind     { autosave manual publish editorial }
enum MediaKind        { image }
enum MediaLicense     { own cc_by cc_by_sa cc_by_nc cc0 public_domain permission }
enum PickPlacement    { home showcase }
enum ReportReason     { copyright illegal spam personal_data other }
enum ReportStatus     { open resolved dismissed }
enum CommissionStatus { proposed accepted delivered paid cancelled }
```

### 1.2. Этап 2: замечания и аудит

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
  action     String                                  // "user.role.change", "translation.unpublish", "trust.reset", "pick.create", "revision.restore", "report.resolve", "owner.transfer"
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
На этапе 1 след дают поля `*ById` и ревизии `editorial`; `audit_log` пишется с этапа 2 для
действий из списка `04-roles-and-access.md`, интерфейс просмотра — этап 5.

### 1.3. Этап 3: прочтения, подборки, подписка на автора, поиск

```prisma
model ReadSalt {                    // суточная соль; строки старше 2 дней удаляются → старые хэши необратимы
  day  DateTime @id @db.Date
  salt Bytes
  @@map("read_salts")
}

model ReadEvent {                   // сырые дедуплицированные события; хранятся 8 дней
  id          BigInt   @id @default(autoincrement())
  articleId   String                       // → Article, Cascade
  day         DateTime @db.Date
  visitorHash Bytes                        // sha256(salt(day) ‖ ip ‖ userAgent), 32 байта
  createdAt   DateTime @default(now())
  @@unique([day, articleId, visitorHash])  // INSERT … ON CONFLICT DO NOTHING = дедупликация в базе
  @@map("read_events")
}

model ArticleReadDaily {            // агрегат; бессрочно
  articleId   String                       // → Article, Cascade
  day         DateTime @db.Date
  uniqueReads Int      @default(0)
  @@id([articleId, day])
  @@index([day])                           // «популярное»: WHERE day >= today-6
  @@map("article_read_daily")
}

model Collection {                  // подборка
  id            String           @id @default(uuid())
  slug          String           @unique      // /collections/{slug}, общий для локалей
  title         String
  titleEn       String?
  description   String?
  descriptionEn String?
  coverAssetId  String?
  curatorId     String                        // → User
  status        CollectionStatus @default(draft)   // draft / published
  publishedAt   DateTime?
  createdAt     DateTime         @default(now())
  updatedAt     DateTime         @updatedAt
  @@map("collections")
}

model CollectionItem {
  collectionId String                         // → Collection, Cascade
  articleId    String                         // → Article, Cascade
  position     Int
  addedAt      DateTime @default(now())
  @@id([collectionId, articleId])
  @@index([articleId])
  @@map("collection_items")
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

Запись прочтения — одна транзакция: `INSERT INTO read_events … ON CONFLICT DO NOTHING
RETURNING` и при успехе `INSERT INTO article_read_daily … ON CONFLICT DO UPDATE uniqueReads + 1`.
«Популярное» — `SELECT articleId, sum(uniqueReads) FROM article_read_daily WHERE day >= current_date - 6
GROUP BY 1 ORDER BY 2 DESC LIMIT 10`, затем join к версиям локали со `status = published`.
Изменения существующих сущностей: `User.locale`, `ArticleTranslation.bodyText`,
`followersNotifiedAt`, `searchVector` (generated column + GIN, raw SQL).

### 1.4. Этап 4: биллинг — ADR-0010

```prisma
enum PspProvider         { yookassa tkassa }
enum PlanKind            { author_support showcase }
enum PlanInterval        { month year }
enum PlanStatus          { active archived }
enum SubscriptionStatus  { active past_due canceled expired }
enum PaymentKind         { donation subscription_charge }
enum PaymentStatus       { pending succeeded canceled refunded }
enum PayoutStatus        { pending processing paid failed }
enum PayoutRecipientKind { self_employed individual sole_proprietor }
enum PromoKind           { percent fixed }
enum AccessLevel         { free members }          // Article.access

model Customer {                    // плательщик; «подписчик» = активная Subscription, не роль
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

model Plan {
  id             String       @id @default(uuid())
  kind           PlanKind
  authorId       String?                         // → User; обязателен для author_support (CHECK)
  name           String
  priceMinor     Int
  interval       PlanInterval @default(month)
  platformFeeBps Int                              // комиссия платформы, базисные пункты (1500 = 15 %)
  status         PlanStatus   @default(active)
  createdAt      DateTime     @default(now())
  updatedAt      DateTime     @updatedAt
  @@unique([kind, authorId, interval])
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
  @@index([status, currentPeriodEnd])               // продление и просрочка
  @@index([planId])
  @@map("subscriptions")
}

model Payment {                     // финансовая запись: никогда не удаляется, FK — Restrict
  id               String        @id @default(uuid())
  customerId       String
  subscriptionId   String?
  kind             PaymentKind
  recipientUserId  String?                          // автор-получатель; NULL — витрина
  amountMinor      Int
  platformFeeMinor Int           @default(0)
  status           PaymentStatus @default(pending)
  pspProvider      PspProvider
  pspPaymentId     String
  receiptUrl       String?                          // чек 54-ФЗ формирует провайдер
  paidAt           DateTime?
  refundedAt       DateTime?
  refundMinor      Int?
  payoutId         String?                          // → Payout
  metadata         Json?                            // сырой ответ провайдера
  createdAt        DateTime      @default(now())
  updatedAt        DateTime      @updatedAt
  @@unique([pspProvider, pspPaymentId])
  @@index([customerId, createdAt(sort: Desc)])
  @@index([recipientUserId, paidAt])
  @@index([payoutId])
  @@map("payments")
}

model PayoutProfile {               // куда платить автору; только токены провайдера, не реквизиты
  id                String              @id @default(uuid())
  userId            String              @unique
  kind              PayoutRecipientKind
  pspRecipientToken String?
  verifiedAt        DateTime?                        // подтверждение статуса самозанятого провайдером
  createdAt         DateTime            @default(now())
  updatedAt         DateTime            @updatedAt
  @@map("payout_profiles")
}

model Payout {
  id              String       @id @default(uuid())
  recipientUserId String                              // → User, Restrict
  amountMinor     Int
  periodStart     DateTime     @db.Date
  periodEnd       DateTime     @db.Date
  status          PayoutStatus @default(pending)
  pspPayoutId     String?
  paidAt          DateTime?
  failureReason   String?
  createdById     String?
  createdAt       DateTime     @default(now())
  updatedAt       DateTime     @updatedAt
  @@index([recipientUserId, createdAt(sort: Desc)])
  @@map("payouts")
}

model PromoCode {
  id             String    @id @default(uuid())
  code           String    @unique
  kind           PromoKind
  value          Int                                  // проценты или копейки
  planId         String?                              // NULL — любой план
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

CHECK: `articles_open_contour_is_free: contour = 'editorial' OR access = 'free'`;
`plans_author_support_has_author: kind <> 'author_support' OR authorId IS NOT NULL`.
Открытый вопрос для `07-commerce.md`: хранить ли ИНН самозанятого у себя или передавать
провайдеру один раз; в модели места нет намеренно.

### 1.5. Этап 5: рассылка, шаблоны

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

`MediaKind` получает `video`, `audio`, `file` отдельной миграцией. Доставка писем по
адресатам (логи, bounce) — на стороне провайдера; своей таблицы нет.

### 1.6. Инварианты, которые держит приложение

| Инвариант | Где проверяется |
|---|---|
| У материала всегда есть версия с `locale = sourceLocale` | Создание материала и версии — одна транзакция |
| Слаг не занят ни версией, ни историей другого материала; не из списка зарезервированных | Один хелпер `assignSlug(locale, base, articleId)` |
| `Commission` ⇒ `Article.contour = editorial` | Резолвер создания заказа |
| Редактор правит чужой текст только при `contour = editorial` или `status = review`, всегда с ревизией `editorial` | Один хелпер `assertCanEditTranslation(user, translation)` |
| `needsReview(user, article) = contour = open ∧ trustLevel = probation ∧ role ∉ {editor, moderator, admin, owner}` | Одна функция, вызывается из `publish` |
| Гость и `reader` видят только `status = published` в нужной локали | Один `where`-конструктор для публичных резолверов |
| Ровно один `owner` | Транзакция передачи владения + тест |
| `open`-материал никогда не `members` | CHECK в базе + тест |

### 1.7. Индексы под известные запросы

| Запрос | Таблица и индекс |
|---|---|
| Материал по адресу `/{section}/{slug}`, `/en/…` | `article_translations (locale, slug)` unique; промах → `article_slug_history (locale, slug)` |
| Лента: последние опубликованные в локали (главная, RSS, sitemap) | `article_translations (locale, status, publishedAt DESC)` |
| Открытый поток и витрина (фильтр по `contour`) | тот же индекс + join `articles`; `contour` без индекса |
| Рубрика | `articles (sectionId)` + индекс версий |
| Автор (публично и кабинет) | `articles (authorId, createdAt DESC)` + версии по `(articleId, locale)` |
| Тег | `_ArticleToTag (B)` + версии |
| Очередь проверки, админский фильтр по статусу | `article_translations (status, reviewRequestedAt)` |
| Популярное за 7 дней | `article_read_daily (day)` → sum → версии |
| Ревизии версии | `article_revisions (translationId, createdAt DESC)` |
| Сессия по refresh-токену, отзыв | `sessions (tokenHash)`, `(previousTokenHash)`, `(userId)` |
| Автор `/authors/{handle}` | `users (handle)`; промах → `handle_history (handle)` |
| Медиа автора | `media_assets (ownerId, createdAt DESC)` |
| Избранное на главной | `editorial_picks (placement, position)` |
| Поиск (этап 3) | GIN по `article_translations.searchVector` |

---

## 2. Изменения enum при данных в базе

| Enum | Изменение | Механика | Опасности |
|---|---|---|---|
| `Role` | + `moderator`, + `owner` | `ALTER TYPE "Role" ADD VALUE …` — так и оставить. **Не** повторять паттерн `update_roles` (пересоздание через `Role_new`): он нужен только при удалении значений и держит `ACCESS EXCLUSIVE` на `users` | Новое значение нельзя использовать в той же транзакции: никаких `UPDATE users SET role = 'owner'` и `DEFAULT` в этой миграции |
| `ArticleStatus` | Переезжает с `articles.status` на `article_translations.status` | Тип не меняется: новая колонка того же типа, бэкфилл, удаление старой | Нет |
| `ContentTypeStatus` | → `SectionStatus` | `ALTER TYPE … RENAME TO` — метаданные, мгновенно. Prisma при переименовании генерирует DROP/CREATE — миграцию править руками (раздел 3.2) | Нет |
| Новые enum | `CREATE TYPE` | Можно сразу использовать в `ADD COLUMN … DEFAULT` | Нет |
| `MediaKind`, `PickPlacement` | Будущие `ADD VALUE` | Отдельная миграция на добавление, следующая — на использование | То же правило |

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
| M1 | `role_add_moderator_owner` | 0 | 2 значения `Role` | нет | практически — оставить |
| M2 | `sessions_and_magic_link_hash` | 0 | `sessions`; `magic_link_tokens.token → tokenHash` | `DELETE FROM magic_link_tokens` (живут 15 минут) | `DROP TABLE sessions`, rename обратно |
| M3 | `users_handle_trust_block_consent` | 1 | `slug → handle` + нормализация; `trustLevel`, `trustChanged*`, `blocked*`, `deletedAt`, `lastLoginAt`, `consentVersion`, `consentAt` | `trustLevel = trusted` для editor/admin/owner и авторов с опубликованным | rename обратно, drop колонок |
| M4 | `taxonomy_sections_formats_tags` | 1 | rename `content_types → sections`, `ContentTypeStatus → SectionStatus`, `typeId → sectionId`, `section_tags → tags`, `_ArticleToSectionTag → _ArticleToTag`; `nameEn/descriptionEn`; `formats`; `articles.formatId`; индекс `sectionId` | нет (форматы — сидом) | обратные rename, drop `formats` |
| M5 | `article_translations` | 1 | `Locale`, `Contour`; `articles.contour/sourceLocale/firstPublishedAt`, `featuredImage → legacyFeaturedImage`; таблица версий; **перенос строк**; **конверсия body → JSON**; удаление перенесённых колонок; индексы; CHECK | да, SQL в 3.2 | forward-миграция «обратно» (3.2) или дамп |
| — | скрипт `verify:legacy-bodies` | 1 | не миграция: валидация JSON схемой + сверка текста | — | — |
| M6 | `article_revisions` | 1 | таблица; `article_translations.sourceRevisionId` | базовая ревизия на каждую версию | `DROP TABLE` |
| M7 | `slug_and_handle_history` | 1 | `article_slug_history`, `handle_history` | нет | `DROP` ×2 |
| M8 | `media_assets` | 1 | `MediaKind`, `MediaLicense`, таблица; `articles.coverAssetId`, `users.avatarAssetId` | нет (обложки — dev-скрипт импорта, если есть реальные) | drop колонок и таблицы |
| M9 | `editorial_picks_reports_commissions` | 1 | 3 таблицы + 4 enum | нет | `DROP` |
| M10 | `review_notes_audit_log` | 2 | 2 таблицы | нет | `DROP` |
| M11 | `drop_legacy_columns` | конец 1 | `DROP COLUMN legacyBody, legacyFeaturedImage` | нет; **только после** `verify:legacy-bodies` = 0 расхождений и импорта обложек | только дамп |
| M12 | `reads` | 3 | `read_salts`, `read_events`, `article_read_daily` | нет | `DROP` |
| M13 | `collections_follows_user_locale` | 3 | `collections`, `collection_items`, `author_follows`, `User.locale`, `ArticleTranslation.followersNotifiedAt` | нет | `DROP`, drop колонок |
| M14 | `search_vector` | 3 | `bodyText`; generated `searchVector` + GIN (raw SQL) | скрипт заполняет `bodyText` из `body` | drop колонок |
| M15 | `billing` | 4 | 11 enum, 8 таблиц, `articles.access` + CHECK | нет | `DROP` (до первого платежа) |
| M16 | `newsletter` | 5 | 2 таблицы | нет | `DROP` |
| M17 | `templates_media_kinds` | 5 | таблица; `MediaKind` + `video/audio/file` | нет | `DROP` |

Порядок M3 → M5 важен: бэкфилл `trustLevel` в M3 смотрит на `articles.status`, которого
после M5 нет.

### 3.2. Нетривиальные миграции

**M2 — сессии.** Создать `sessions` с индексами; `DELETE FROM magic_link_tokens` (открытые
токены нельзя превратить в хэши; они живут 15 минут); `RENAME COLUMN token TO tokenHash`;
переименовать unique-индекс; удалить дублирующий индекс. Проверка: логин через ссылку создаёт
строку сессии; `refresh` меняет `tokenHash`, старый попадает в `previousTokenHash`; повторное
предъявление старого → `revokedAt`.

**M3 — пользователи.** Переименовать `slug → handle`, снять unique на время нормализации,
привести к `[a-z0-9-]`, разрешить дубликаты суффиксом `-2`, `-3` по порядку создания, короткие
(< 3 символов) дополнить фрагментом `md5(id)`, вернуть unique. Добавить `TrustLevel` и
колонки; бэкфилл:

```sql
UPDATE "users" u SET "trustLevel" = 'trusted'
WHERE u."role" IN ('editor', 'admin', 'owner')
   OR EXISTS (SELECT 1 FROM "articles" a WHERE a."authorId" = u.id AND a."status" = 'published');
```

Существующие хэндлы всё ещё равны локальной части e-mail: для реальных людей после M7 —
замена на `u-{8 hex}` с записью в `handle_history` (или просьба сменить). Проверка:
`SELECT handle FROM users WHERE handle !~ '^[a-z0-9-]{3,32}$'` → 0; `count(users)` не изменился.

**M4 — таксономия.** Только `RENAME` таблиц, колонок, ограничений, индексов и типа;
`CREATE TABLE formats`; `articles.formatId` с FK `SET NULL`; индекс `articles_sectionId_idx`.
В `schema.prisma` модель `Tag` с `articles Article[]` **без** имени relation (тогда Prisma ждёт
таблицу `_ArticleToTag`). Проверка: `migrate diff` пуст; счётчики совпадают.

**M5 — версии и конверсия тела.** Порядок внутри одной транзакции:

1. Типы `Locale`, `Contour`; колонки `articles.contour`, `sourceLocale`, `firstPublishedAt`;
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

**M15 — биллинг.** Таблицы раздела 1.4 плюс `articles.access` и оба CHECK.

### 3.3. Пустая база и база с данными

| | Пустая база (dev, превью) | База с данными (прод) |
|---|---|---|
| Как применять | `prisma migrate reset` (все M подряд) + `prisma db seed`; бэкфиллы — no-op на нуле строк | `pg_dump` → репетиция на ветке → `migrate deploy` до **M10 включительно** → `verify:legacy-bodies` → импорт обложек → M11 отдельным релизом |
| Конверсия тел | Нечего конвертировать; сид создаёт материалы в JSON | SQL внутри M5; проверка скриптом; при Markdown — reconvert |
| Хэндлы | Сид задаёт явно | Нормализация в M3, затем замена на случайные с историей |
| `owner` | Сид создаёт владельца | Скрипт по e-mail после M1 |
| Проверка drift | `migrate diff` пуст после каждой миграции — шаг CI | То же плюс счётчики и контрольные суммы |
| Откат | `migrate reset` | forward-миграция или дамп; после M11 — только дамп |
| Переезд в РФ | — | После миграций этапа 1: `pg_dump -Fc` → `pg_restore` в РФ-инстанс (`_prisma_migrations` едет вместе с дампом) → `DATABASE_URL`; бакет — `rclone sync` |

### 3.4. Проверки по шагам

| После | Проверка | Ожидание |
|---|---|---|
| M1 | `SELECT enum_range(NULL::"Role")` | `{reader,author,editor,moderator,admin,owner}` |
| M2 | `\d magic_link_tokens`; `count(sessions)` | колонка `tokenHash`, один unique; 0 |
| M3 | `count(users)` = снимок; хэндлы по регулярному выражению; unique создан | |
| M4 | `count(sections)`, `count(tags)`, `count("_ArticleToTag")` = снимок; `migrate diff` пуст | |
| M5 | `count(articles) = count(article_translations WHERE locale='ru')`; контрольная сумма `md5(string_agg(title‖slug‖status‖publishedAt ORDER BY id))` до и после совпадает; строк с маркером 0; `firstPublishedAt` заполнен у опубликованных | |
| скрипт | 0 невалидных документов, 0 расхождений текста | |
| M6 | `count(article_revisions) = count(article_translations)` | |
| M7–M10 | `migrate diff` пуст; таблицы пусты | |
| M11 | только после скрипта; `\d article_translations` без `legacyBody` | |
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

### 4.4. Где живёт `contour`

На `Article`: контур — экономика и права материала, они не зависят от языка. Ставится при
создании по роли; меняется редко и только редактором с аудитом. Отбор не меняет контур
(ADR-0006); CHECK на этапе 4 держит «открытое всегда бесплатно».

### 4.5. `EditorialPick` и версии

Отбирается материал, не версия. При рендере главной в локали L отбор показывается, только
если у материала есть опубликованная версия L; иначе молча пропускается. Снятие
единственной опубликованной версии → отбор «спит», админка показывает список «отборов без
опубликованной версии». Позиция и срок общие для локалей; раздельные витрины RU/EN — YAGNI.

### 4.6. Уровень доверия

`User.trustLevel: probation | trusted` — enum, не число. Счётчик проверенных материалов не
хранится — выводится: `count(articles WHERE authorId = u AND firstPublishedAt IS NOT NULL)`.
Оценка в момент «Опубликовать»: `needsReview` (1.6) → `review` с `reviewRequestedAt`. При
одобрении: если материалов с `firstPublishedAt` стало ≥ 2 → `trusted`. Сброс модератором —
`probation` с указанием, кто; действующие публикации не трогаются. Доверие общее для локалей.

### 4.7. Политика удаления по сущностям

| Сущность | Политика |
|---|---|
| Материал | `deletedAt` **нет**. Никогда не публиковавшийся (`firstPublishedAt IS NULL`) — hard delete с каскадом. Публиковавшийся — удалить нельзя, только архив каждой версии; адрес отвечает «снято» (410) |
| Пользователь | Только анонимизация («надгробие»): `deletedAt`, e-mail → технический, имя → «удалённый автор», хэндл → случайный (старый в историю не пишется), профиль очищен, сессии и ссылки для входа удалены. Материалы открытого контура — по умолчанию все версии в `archived`; выбор «оставить с подписью» применяется в момент удаления. Заказные — по `Commission.terms` |
| Медиа | `deletedAt` (единственный soft delete этапа 1); физическая чистка — этап 5 |
| Сессии, magic link, `read_events`, `read_salts` | Hard delete по сроку в housekeeping |
| Ревизии | Прореживание по 4.9 |
| Платежи, выплаты, аудит | Никогда не удаляются; FK `Restrict` |
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

### 4.10. Прочтения без профилирования

Суточная соль: `visitorHash = sha256(salt(day) ‖ ip ‖ userAgent)`; уникальность в пределах
(день, материал). «Уникальные прочтения за 7 дней» — сумма суточных уникальных читателей за
последние 7 дней; читатель, вернувшийся на третий день, считается дважды — это честно и
объяснимо в подписи. Соль хранится в `read_salts` (не в памяти процесса — перезапуск не должен
ломать дедупликацию) и удаляется через 2 дня: после этого хэши необратимы. Аккаунт в хэш не
подмешивается. Housekeeping (один скрипт по расписанию): `read_events` старше 8 дней,
`read_salts` старше 2 дней, сессии старше 30 дней после истечения, использованные magic
link, прореживание `autosave`. Что считать прочтением — решение клиента (маяк после ~10
секунд или прокрутки до середины); боты отсекаются по user-agent. Redis для HyperLogLog не
используется (ADR-0019).

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
| Отложенная публикация (`scheduledAt`) | Не в этапах; одна колонка, когда попросят (этап 6, платный инструмент) |
| Хранение diff между ревизиями | Вычисляется из двух снимков |
| Очередь уведомлений, таблица `Notification` | Колонка `followersNotifiedAt` |
| `PromoRedemption`, `PayoutItem` | Колонки `Subscription.promoCodeId`, `Payment.payoutId` |
| Валюта в платежах | Только RUB |
| OAuth-аккаунты (`Account`) | ADR-0022 |
| Комментарии, реакции | ADR-0026 |
| Прочтения по локали и по пользователю | Метрика — о материале; по пользователю — профилирование |
| Частичные unique-индексы, deferrable-ограничения | Prisma их не моделирует → drift |
| `@db.Uuid`, uuid v7, ULID | Смешение с существующими TEXT-id дороже пользы |
| Отдельные витрины RU/EN, рубричные отборы | Нет EN-редакции; `PickPlacement` расширяется `ADD VALUE` |
| Мультитенантность, ClickHouse, очереди | `02-target-architecture.md` §9 |

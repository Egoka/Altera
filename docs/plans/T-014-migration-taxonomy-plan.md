# T-014: миграция таксономии — план реализации

> **Для агентных исполнителей:** выполнять план по шагам с TDD и отдельной проверкой каждого изменения. До первого изменения продуктового кода прочитать все источники из раздела 1; generated Prisma client вручную не редактировать.

- **Дата**: 2026-09-15
- **Ветка**: `docs/t-014-taxonomy-plan`
- **Задача**: T-014 / ALTE-37
- **Authorization**: native issue `01a0a5d1-d512-7db4-bd2e-452640728155`, поручение оркестратора в треде `01a0a60f-38c4-7cdf-8190-27e0eb1d4fb6`
- **Базовый коммит**: `96ef15c06f3596b8eea2f9421d0915f9b6f31c4a`
- **Исходное дерево**: clean
- **Отчёт**: `docs/reports/T-014-migration-taxonomy-plan-report.md` (заполняется разработчиком по завершении)
- **Статус**: утверждён для передачи в разработку

**Цель:** без потери существующих данных разделить таксономию на обязательную перед подачей рубрику `Section`, необязательный жанр `Format` и свободный тег `Tag`, сохранив возможность черновика без таксономии, архивирование и вечный резерв публичных слагов.

**Архитектура:** физические таблицы и внешние ключи переименовываются, а не пересоздаются. Архив рубрики защищён локальными DB-ограничениями и транзакционной проверкой активного преемника; вечная уникальность реализована едиными append-only реестрами слагов по принятому в T-013 паттерну `HandleHistory`.

**Стек:** Prisma 6.12, PostgreSQL, GraphQL Yoga, TypeScript, Vitest.

**Спецификация:** `docs/backlog/tasks/T-014-migration-taxonomy.md`; `docs/spec/40-admin/categories.md`; `docs/spec/40-admin/tags.md`; `docs/spec/20-public/sections-index.md`; `docs/spec/20-public/tags-index.md`; ADR-0004 и ADR-0005 с уточнениями журнала.

## 1. Контракт и границы

Источники применяются по старшинству:

1. `docs/decisions/role-review-working-log-2026-09-08.md`: #29, §25.3, §26.2, §26.3, §26.10;
2. перечисленные спецификации;
3. `docs/decisions/ADR-0005-taxonomy-section-format-tag.md` и `docs/decisions/ADR-0004-identifiers-and-urls.md`.

Инварианты реализации:

1. `Section` — бывший `ContentType`; у материала не более одной рубрики. База допускает `NULL` у черновика, а T-039/T-049 проверят обязательность рубрики перед подачей и публикацией.
2. Архивированный `Section` всегда имеет отличного от себя преемника. На момент архива преемник обязан быть активен, а статьи переносятся к нему в той же транзакции.
3. `Format` — отдельный необязательный жанр, не входит в URL; у материала не более одного формата.
4. `Tag` — бывший `SectionTag`; тег может создать автор, но переименование, слияние, архивирование и восстановление доступны только `admin`/`owner`. Это правило прав проверяется в resolver/service, а не новым значением enum роли.
5. Один публичный `slug` используется в обеих локалях; локализуются имена и описания. Это следует ADR-0004/0005: отдельное поле `slugEn` не добавляется.
6. Каждый когда-либо выданный слаг рубрики или тега остаётся в append-only реестре после переименования, архива, слияния и физического удаления. Возврат даже к собственному прежнему слагу запрещён.
7. UI админки T-070/T-071, автокомплит T-040, проверка рубрики на переходе статьи T-039/T-049 и permanent-delete flow T-076 не входят.

## 2. Наблюдаемое исходное состояние

На baseline `96ef15c…` схема содержит `ContentType`/`content_types`, `SectionTag`/`section_tags`, обязательный `Article.typeId`, M:N-таблицу `_ArticleToSectionTag` и enum `ContentTypeStatus` (`server/prisma/schema.prisma:100-142,174-177`). `ContentType.slug` и `SectionTag.slug` уникальны только среди существующих строк; после hard delete адрес освобождается. `Format`, локализованные поля, преемник, акторы архива и реестры слагов отсутствуют.

## 3. Принятые технические решения

### 3.1. Переименование вместо копирования

Использовать PostgreSQL `ALTER ... RENAME`: `content_types → sections`, `section_tags → tags`, `articles.typeId → sectionId`, `_ArticleToSectionTag → _ArticleToTag`. Это сохраняет UUID, timestamps, связи и порядок строк. Создание новых таблиц с `INSERT ... SELECT` отклонено: оно добавляет риск неполной копии и расхождения M:N.

### 3.2. Ограничение архива

Prisma не выражает условный `CHECK`, поэтому migration SQL создаёт:

```sql
CONSTRAINT "sections_archive_successor_check"
CHECK (
  ("status" = 'active' AND "successorId" IS NULL)
  OR
  ("status" = 'archived' AND "successorId" IS NOT NULL)
),
CONSTRAINT "sections_successor_not_self_check"
CHECK ("successorId" IS NULL OR "successorId" <> "id")
```

FK `successorId → sections.id` использует `ON DELETE RESTRICT`. Статический `CHECK` не может доказать статус другой строки, поэтому сервис архива в transaction блокирует source и target (`SELECT ... FOR UPDATE`), проверяет `target.status = active`, переносит все статьи и лишь затем ставит source `archived`. Восстановление очищает `successorId` и archive metadata.

### 3.3. Вечный резерв слагов

Два `@unique` — на текущей модели и истории — не образуют общего пространства имён. Поэтому `Section.slug` и `Tag.slug` являются FK на первичный ключ соответствующего append-only реестра. Выделение нового слага начинается с `INSERT` в реестр; конфликт PK — доменный `CONFLICT`. Строки реестров не удаляются, FK владельца использует `ON DELETE SET NULL`.

История хранит отдельно первоначального владельца и текущую цель редиректа. При rename старый слаг продолжает вести на тот же объект; при archive рубрики все её слаги ведут на преемника; при merge тега все слаги источника ведут на target. Обычный архив тега очищает redirect, восстановление возвращает его на сам тег. Это не освобождает слаг.

## 4. Точная целевая Prisma-схема

Изменить `server/prisma/schema.prisma`. Существующие поля, не показанные у `User` и `Article`, сохраняются.

```prisma
enum TaxonomyStatus {
  active
  archived
}

model User {
  // существующие поля и отношения
  createdTags Tag[] @relation("TagCreator")
}

model Section {
  id                    String               @id @default(uuid())
  name                  String
  nameEn                String?
  slug                  String               @unique
  description           String?
  descriptionEn         String?
  seoTitle              String?
  seoTitleEn            String?
  seoDescription        String?
  seoDescriptionEn      String?
  order                 Int
  status                TaxonomyStatus       @default(active)
  successorId           String?
  archivedAt            DateTime?
  archivedByActorId     String?
  archivedByRole        Role?
  createdAt             DateTime             @default(now())
  updatedAt             DateTime             @updatedAt
  articles              Article[]
  successor             Section?             @relation("SectionSuccessor", fields: [successorId], references: [id], onDelete: Restrict)
  predecessors          Section[]            @relation("SectionSuccessor")
  currentSlug           SectionSlugHistory   @relation("CurrentSectionSlug", fields: [slug], references: [slug], onDelete: Restrict, onUpdate: Restrict)
  slugHistory           SectionSlugHistory[] @relation("SectionSlugOwner")
  redirectedSlugHistory SectionSlugHistory[] @relation("SectionSlugRedirect")

  @@index([status, order])
  @@index([successorId])
  @@map("sections")
}

/// Append-only registry: issued section slugs are never deleted or reused.
model SectionSlugHistory {
  slug                String   @id
  ownerSectionId      String?
  redirectToSectionId String?
  createdAt           DateTime @default(now())
  ownerSection        Section? @relation("SectionSlugOwner", fields: [ownerSectionId], references: [id], onDelete: SetNull)
  redirectToSection   Section? @relation("SectionSlugRedirect", fields: [redirectToSectionId], references: [id], onDelete: SetNull)
  currentSection      Section? @relation("CurrentSectionSlug")

  @@index([ownerSectionId])
  @@index([redirectToSectionId])
  @@map("section_slug_history")
}

model Format {
  id            String         @id @default(uuid())
  name          String
  nameEn        String?
  slug          String         @unique
  description   String?
  descriptionEn String?
  status        TaxonomyStatus @default(active)
  archivedAt    DateTime?
  createdAt     DateTime       @default(now())
  updatedAt     DateTime       @updatedAt
  articles      Article[]

  @@index([status])
  @@map("formats")
}

model Tag {
  id                    String           @id @default(uuid())
  name                  String
  nameEn                String?
  slug                  String           @unique
  description           String?
  status                TaxonomyStatus   @default(active)
  mergedIntoId          String?
  createdByActorId      String?
  createdByRole         Role?
  archivedAt            DateTime?
  archivedByActorId     String?
  archivedByRole        Role?
  createdAt             DateTime         @default(now())
  updatedAt             DateTime         @updatedAt
  articles              Article[]        @relation("ArticleToTag")
  creator               User?            @relation("TagCreator", fields: [createdByActorId], references: [id], onDelete: SetNull)
  mergedInto            Tag?             @relation("TagMerge", fields: [mergedIntoId], references: [id], onDelete: Restrict)
  mergedFrom            Tag[]            @relation("TagMerge")
  currentSlug           TagSlugHistory   @relation("CurrentTagSlug", fields: [slug], references: [slug], onDelete: Restrict, onUpdate: Restrict)
  slugHistory           TagSlugHistory[] @relation("TagSlugOwner")
  redirectedSlugHistory TagSlugHistory[] @relation("TagSlugRedirect")

  @@index([status])
  @@index([mergedIntoId])
  @@index([createdByActorId])
  @@map("tags")
}

/// Append-only registry: issued tag slugs are never deleted or reused.
model TagSlugHistory {
  slug            String   @id
  ownerTagId      String?
  redirectToTagId String?
  createdAt       DateTime @default(now())
  ownerTag        Tag?     @relation("TagSlugOwner", fields: [ownerTagId], references: [id], onDelete: SetNull)
  redirectToTag   Tag?     @relation("TagSlugRedirect", fields: [redirectToTagId], references: [id], onDelete: SetNull)
  currentTag      Tag?     @relation("CurrentTagSlug")

  @@index([ownerTagId])
  @@index([redirectToTagId])
  @@map("tag_slug_history")
}

model Article {
  // существующие поля
  sectionId String?
  formatId  String?
  section   Section? @relation(fields: [sectionId], references: [id], onDelete: Restrict)
  format    Format?  @relation(fields: [formatId], references: [id], onDelete: SetNull)
  tags      Tag[]    @relation("ArticleToTag")

  @@index([sectionId])
  @@index([formatId])
  @@map("articles")
}
```

`nameEn`/локализованные описания остаются nullable: в legacy-таблицах нет утверждённого перевода, а миграция не должна выдумывать текст. API создания новых `Section`/`Format` требует обе локали по спецификации. `Format.slug` уникален среди форматов, но отдельный вечный реестр не создаётся: формат не является публичным адресом, а T-014 требует вечного резерва именно рубрик и тегов.

Raw SQL дополнительно создаёт:

- оба `CHECK` из §3.2;
- `tags_merge_not_self_check`: `mergedIntoId IS NULL OR mergedIntoId <> id`;
- `sections_slug_format_check` и `tags_slug_format_check`: `slug ~ '^[a-z0-9-]+$'`;
- `sections_slug_reserved_check` для значений `en`, `authors`, `tags`, `collections`, `search`, `me`, `admin`, `auth`, `login`, `legal`, `api`, `rss`, `sitemap.xml` из ADR-0004;
- FK текущих слагов на реестры с `ON DELETE/UPDATE RESTRICT` и FK history owner/redirect с `ON DELETE SET NULL`.

## 5. Стратегия миграции существующих данных

Создать одну именованную миграцию `server/prisma/migrations/<timestamp>_taxonomy_section_format_tag/migration.sql` и выполнить в одной transaction.

1. Preflight без вывода самих значений:
   - проверить отсутствие дублей `lower(slug)` отдельно в `content_types` и `section_tags`;
   - проверить regex и зарезервированные слаги рубрик;
   - проверить число `content_types.status = archived`. Если такие строки есть, остановить migration: активного преемника должен выбрать владелец данных, автоматический выбор запрещён;
   - сохранить counts `content_types`, `section_tags`, `_ArticleToSectionTag`, `articles` и число ненулевых `typeId` для rehearsal.
2. Переименовать enum `ContentTypeStatus → TaxonomyStatus`, таблицы, PK/index/constraint names и `articles.typeId → sectionId`; переименовать FK в `articles_sectionId_fkey`.
3. Переименовать `_ArticleToSectionTag → _ArticleToTag`, её PK/index/FK constraints; значения колонок `A`/`B` не менять.
4. Добавить nullable поля `Section`, затем `successorId` FK, индексы и `CHECK`. `sectionId` сделать nullable только после сохранения всех существующих значений.
5. Создать `formats`; добавить nullable `articles.formatId` и FK `ON DELETE SET NULL`.
6. Добавить поля `Tag`; backfill `status = active`, `createdBy*`, `archived*`, `mergedIntoId`, `nameEn` оставить `NULL`; затем сделать `status NOT NULL DEFAULT active`.
7. Создать `section_slug_history` и `tag_slug_history`. Одним `INSERT ... SELECT` перенести каждый существующий слаг с owner и redirect на тот же UUID. Только после сравнения count/set добавить FK текущего `sections.slug`/`tags.slug` на registry PK.
8. Добавить оставшиеся indexes/checks, выполнить `prisma generate`, `prisma validate` и проверить drift на чистой тестовой базе.
9. Postcondition в rehearsal: before/after counts равны; множества `(id, slug)` рубрик и тегов равны; множества `(A, B)` M:N равны; для каждой статьи прежний `typeId` равен новому `sectionId`; каждый текущий slug имеет ровно одну registry row.

Не использовать `DROP TABLE`, каскадное удаление реестров или `INSERT ... SELECT` в новые `sections`/`tags`. Production/development Neon на стадии разработки не мигрировать.

## 6. Атомарные операции после миграции

- **Создание/rename Section или Tag**: нормализовать slug; в Prisma transaction сначала вставить history row. `P2002` по registry PK вернуть как `CONFLICT`; затем создать/обновить объект и заполнить owner/redirect. Старую registry row не менять при rename.
- **Архив Section**: только `admin`/`owner`; залочить source/target, проверить target active и distinct, перенести все `Article.sectionId`, обновить redirect всех history rows source на target, записать successor/archive metadata. Любая ошибка откатывает всю transaction.
- **Restore Section**: только допустимая роль; поставить active, очистить successor/archive metadata, вернуть redirect history на сам Section.
- **Create Tag**: разрешить `author`, `admin`, `owner`; сохранить creator ID и snapshot роли. Создание не требует очереди предложений.
- **Merge/Archive/Restore Tag**: только `admin`/`owner`. Merge переносит M:N-связи без дублей, архивирует source, ставит `mergedIntoId`, направляет все source slugs на target. Обычный архив не удаляет M:N, но очищает redirect; restore возвращает redirect на тег. Permanent delete остаётся T-076, registry rows переживают его.

## 7. Файлы реализации

- Изменить `server/prisma/schema.prisma` — модели, enum, отношения и индексы из §4.
- Создать `server/prisma/migrations/<timestamp>_taxonomy_section_format_tag/migration.sql` — preflight, rename/backfill, FK/checks и postconditions.
- Переименовать серверные модули `server/src/graphql/contentType/ → section/` и `server/src/graphql/sectionTag/ → tag/`; обновить Prisma delegates, SDL `ContentType → Section`, `SectionTag → Tag`, `contentType/sectionTags → section/tags` и подключение схем в `server/src/server.ts`.
- Изменить `server/src/graphql/article/schema.graphql` и resolver статьи — nullable section для draft, optional format, tags.
- Добавить сервисные transaction helpers для резервирования slug, архива Section и merge/archive Tag; resolver не должен разносить одну операцию по нескольким transaction.
- Обновить затронутые web GraphQL operations/types, чтобы удалённые имена контракта не оставались compile-time строками; UI T-070/T-071 не создавать.
- Создать `server/tests/taxonomy-migration-database.test.ts` — PostgreSQL integration tests миграции и raw constraints.
- Создать/обновить unit tests прав и transaction orchestration для Section/Tag.
- Создать `docs/reports/T-014-migration-taxonomy-plan-report.md` с фактическими командами, выводом rehearsal и отклонениями.

## 8. TDD-последовательность разработчика

### Задача 1. Зафиксировать миграционную сохранность

- [ ] Поднять отдельную PostgreSQL 16 и применить схему до T-014; development Neon не использовать.
- [ ] Создать fixture минимум с двумя `ContentType`, двумя `SectionTag`, статьями и M:N-связями; сохранить before snapshot counts и ID/slug/pair sets.
- [ ] Написать failing rehearsal test, ожидающий новые таблицы/колонки и полное равенство snapshot после migration.
- [ ] Реализовать только rename/backfill часть SQL и добиться PASS этого теста.

### Задача 2. Зафиксировать архивный инвариант Section

- [ ] Написать failing DB-test: `status = archived` при `successorId = NULL` отклоняется SQLSTATE `23514`; successor=self также отклоняется.
- [ ] Добавить self-relation, FK и named `CHECK`, повторить DB-test.
- [ ] Написать service tests: inactive successor отклоняется; active successor переносит статьи и обновляет source/history в одной transaction.
- [ ] Реализовать минимальный transaction helper и добиться PASS.

### Задача 3. Разделить Format и Tag

- [ ] Написать failing schema/service tests: draft сохраняется без section/format; format nullable; author создаёт tag; author не может merge/archive; `admin`/`owner` могут.
- [ ] Добавить `Format`, `Tag`, новые Article relations и GraphQL rename.
- [ ] Реализовать role checks и tag operations; проверить перенос M:N без duplicate pairs.

### Задача 4. Зафиксировать вечный резерв

- [ ] Написать failing PostgreSQL tests: после rename/archive/merge и hard delete попытка зарезервировать прежний Section/Tag slug отклоняется registry PK.
- [ ] Добавить обе history models, backfill, FK и транзакционный allocator.
- [ ] Проверить 301 target metadata для rename Section, archive Section и merge Tag; обычный archive Tag не имеет redirect target.

### Задача 5. Полная проверка и отчёт

- [ ] Выполнить `pnpm --filter server exec prisma validate` и `pnpm --filter server run build:ci`.
- [ ] Выполнить `pnpm --filter server test`, затем из корня `pnpm format`, `pnpm lint`, `pnpm test`.
- [ ] На копии legacy PostgreSQL выполнить `prisma migrate deploy`, сохранить before/after snapshot и фактический вывод AC-1/AC-2.
- [ ] Заполнить парный отчёт с revision SHA, dirty fingerprint, командами, exit codes, executed tests и ограничениями.

## 9. Критерии готовности

- **AC-1 / `t014-section-archive-successor-db`**: прямой DB update/insert архивного Section без successor отклоняется named constraint с SQLSTATE `23514`. Дополнительные service tests доказывают запрет self/inactive successor и атомарный перенос всех статей к активному successor. Проверка только GraphQL-валидации без DB-test недостаточна.
- **AC-2 / `t014-taxonomy-migration-preserves-data`**: rehearsal на копии схемы до T-014 сравнивает before/after counts и множества UUID/slug для `content_types → sections`, `section_tags → tags`, пары `_ArticleToSectionTag → _ArticleToTag` и `typeId → sectionId`. Все равны; миграция не создаёт новые и не теряет существующие рубрики, теги, назначения статей или M:N-связи.

Дополнительные contract checks: Prisma schema содержит `Section`, optional `Format`, `Tag`, `TaxonomyStatus`; текущие Section/Tag slugs имеют registry rows; повторная выдача прежнего slug получает DB unique conflict; server build не содержит старых Prisma delegates.

## 10. Риски и снятие

- **Legacy archived Section без successor**: migration abort с безопасным count; successor не выбирается автоматически.
- **Невалидный или case-fold duplicate slug**: preflight abort до DDL; значения не печатаются в CI/evidence.
- **Частичная taxonomy operation**: все переносы, history и status выполняются одной transaction с row locks.
- **Prisma drift удалит raw CHECK**: constraints именованы, проверяются DB-test и должны сохраняться при будущих migration diff.
- **Hard delete освободит адрес**: owner FK history использует `SET NULL`, current FK — `RESTRICT`, delete API для history отсутствует.
- **Сломанный GraphQL после Prisma rename**: все старые delegates/типы ищутся после `prisma generate`; server build обязателен.
- **Неутверждённый перевод legacy name**: `nameEn` не фабрикуется и остаётся nullable до редакционного заполнения.

## 11. Стадии и handoff

- **Архитектура**: actor `Altera — архитектор`; вход — ALTE-37, triggering thread и pinned sources; выход — этот план на baseline `96ef15c…`. Окончание run означает готовность архитектурного evidence, не реализацию AC.
- **Разработка**: продолжает выделенный T-014 worktree/ветку либо создаёт отдельную implementation-ветку по решению оркестратора, не переносит чужие dirty changes; выход — schema, migration, сервисы, tests и парный отчёт.
- **Тестирование**: проверяет актуальный implementation SHA; обязательны отдельные evidence по `t014-section-archive-successor-db` и `t014-taxonomy-migration-preserves-data`.
- **Независимое ревью**: сверяет источники, отсутствие data-copy/drop, nullable draft taxonomy, active-successor transaction, role matrix и append-only registry.
- **Релиз**: backend/schema change; после merge отдельно фиксируются CI, merge SHA, Render deploy, HTTP smoke, DB и Redis checks. Migration сначала репетируется на копии; destructive rollback schema запрещён.

План замораживается до первого коммита разработчика. Отклонения фиксируются в парном отчёте или новым планом, а не переписыванием этого файла задним числом.

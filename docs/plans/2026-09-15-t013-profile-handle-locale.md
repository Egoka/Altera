# T-013: профиль, вечный резерв хэндлов и основной язык

- **Дата**: 2026-09-15
- **Ветка**: `docs/adr-0047-plus` (архитектурный артефакт; реализация — новая `server/t-013-profile-handle-locale` от свежей `origin/app`)
- **Задача**: T-013 / ALTE-36
- **Authorization**: native issue `01a0a59c-0037-7654-a1e0-e2b3073a2e76`, комментарий оркестратора `01a0a5d3-b661-7af3-a6a7-1074893d4c32`; scope зафиксирован ревизией `bf5931670fc7145ac7a4a8994afb735dff83b3c4`
- **Базовый коммит**: `4c059f1e609464aec3135984fa623ca42c478330`
- **Исходное дерево**: dirty, только чужие артефакты: `AGENTS.md` (SHA-256 diff `bb08f43dac0e5a10a8651166a78538f70367ed84f299a5abea9055add04c762f`) и `docs/plans/2026-09-15-t012-sessions-magic-link.md` (SHA-256 `7d27fe871a6c7930b12dbd57ad6090639f8230041eaea05fbc1ecc525ff69b07`); не изменялись этим планом
- **Отчёт**: `docs/reports/2026-09-15-t013-profile-handle-locale-report.md` (заполняется разработчиком по завершении)
- **Статус**: утверждён для передачи в разработку

## 1. Цель и контракт

Добавить в Prisma-модель и PostgreSQL поля профиля пользователя: публичное имя, текущий публичный хэндл, основной язык аккаунта, ссылки на текущий и предыдущий аватары и состояние автоматической проверки имени/аватара. Любой когда-либо выданный хэндл должен навсегда остаться занятым после смены, архива или физического удаления пользователя.

Источники по старшинству:

- `docs/decisions/role-review-working-log-2026-09-08.md`: §20.11, §25.4, §26.10, §29.5;
- `docs/spec/30-account/reader/profile-edit.md` §1, §4, §7;
- `docs/spec/20-public/author.md` §1, §3–4;
- `docs/spec/85-media-and-binary/avatars.md` §2;
- ADR-0004 п. 4, 6–7 и ADR-0018 п. 1–3;
- `docs/vision/03-data-model.md`, ревизия 3, `User` и `HandleHistory`, как ориентир физической модели.

Зафиксированные инварианты:

1. текущий хэндл каноничен: нижний регистр, `^[a-z0-9-]{3,32}$`;
2. все текущие и прежние хэндлы находятся в одном глобальном пространстве имён;
3. архивирование и удаление пользователя не удаляют резерв хэндла;
4. новый обычный пользователь получает случайный хэндл формата `u-{8 hex}`; e-mail не участвует ни в хэндле, ни в публичном URL;
5. аватар применяется сразу после технической обработки, предыдущий сохраняется для отката;
6. основной язык — `ru` или `en`; приложение передаёт язык регистрации явно, а `ru` служит безопасным backfill/default базы;
7. служебные аккаунты без публичного профиля, создание `MediaAsset`, UI профиля и полная очередь ручной проверки не входят в T-013.

## 2. Рассмотренные варианты

### 2.1. `users.handle @unique` плюс отдельный `handle_history.handle @unique`

Отклонён: два уникальных индекса не образуют общего пространства имён. База разрешит назначить пользователю текущий хэндл, который уже лежит в истории другого пользователя, если прикладная проверка проиграет гонку.

### 2.2. Проверяющий trigger над двумя таблицами

Отклонён: требует блокировок или advisory lock для гонок, усложняет Prisma drift и дублирует один логический реестр двумя физическими источниками истины.

### 2.3. Единый append-only `handle_history` как история и реестр резервов

Выбран. Каждая каноническая строка появляется в таблице ровно один раз. Текущий `users.handle` является внешним ключом на эту запись; прежняя запись остаётся для 301. Первичный ключ `handle_history.handle` одновременно обеспечивает вечный резерв и атомарное разрешение гонок регистрации.

## 3. Целевая Prisma-схема

Изменить `server/prisma/schema.prisma` следующим образом. Имена полей являются контрактом реализации.

```prisma
enum Locale {
  ru
  en
}

enum ProfileCheckStatus {
  ok
  pending
  rejected
}

model User {
  // существующие id, email, role, archive-поля и отношения сохраняются
  name               String
  handle             String             @unique
  locale             Locale             @default(ru)
  avatarAssetId      String?
  prevAvatarId       String?
  nameCheckStatus    ProfileCheckStatus @default(ok)
  avatarCheckStatus  ProfileCheckStatus @default(ok)
  currentHandle      HandleHistory      @relation("CurrentUserHandle", fields: [handle], references: [handle], onDelete: Restrict, onUpdate: Restrict)
  handleHistory      HandleHistory[]    @relation("HandleOwner")

  @@index([nameCheckStatus])
  @@index([avatarCheckStatus])
  @@map("users")
}

model HandleHistory {
  handle      String    @id
  userId      String?
  user        User?     @relation("HandleOwner", fields: [userId], references: [id], onDelete: SetNull)
  currentUser User?     @relation("CurrentUserHandle")
  createdAt   DateTime  @default(now())

  @@index([userId])
  @@map("handle_history")
}
```

Пояснения:

- `name` уже существует и остаётся публичным отображаемым именем; переименование без продуктовой пользы не требуется.
- `slug` удаляется после backfill и заменяется на `handle`. Совместимый GraphQL rename и публичный тип относятся к реализации того же изменения, иначе новый контракт базы останется неиспользуемым.
- `HandleHistory.userId` nullable только для сохранения резерва после физического удаления пользователя. При обычной записи он устанавливается в той же транзакции, что и создание/смена хэндла.
- `avatarAssetId` и `prevAvatarId` пока являются nullable scalar ID. T-016 создаст `MediaAsset` и добавит внешние ключи; T-013 не создаёт фиктивную media-таблицу. Устаревший `photoUrl` не удаляется до отдельного переноса потребителей.
- `nameCheckStatus` и `avatarCheckStatus` хранят только актуальное состояние `ok | pending | rejected`. Снимки нового/предыдущего значения, причина и решение рецензента принадлежат будущей очереди проверки; не добавлять их без отдельного контракта.
- Нужны raw SQL `CHECK` на `users.handle ~ '^[a-z0-9-]{3,32}$'` и на различие ненулевых `avatarAssetId`/`prevAvatarId`. Частичные индексы не использовать.

## 4. Миграция и backfill

Создать именованную миграцию `server/prisma/migrations/20260915170000_user_profile_handle_locale/migration.sql`. Перед генерацией разработчик обязан начать T-013 в отдельном чистом worktree от свежей `origin/app`; если свежая схема отличается от наблюдаемой `52910e46fda736df668073f656973d919052e1cb`, адаптировать SQL к фактической базе и записать отклонение в отчёте, не менять инварианты плана.

Порядок SQL внутри одной транзакции миграции:

1. Создать enums `Locale`, `ProfileCheckStatus` и таблицу `handle_history` с `handle TEXT PRIMARY KEY`, nullable `userId`, `createdAt` и индексом `userId`.
2. Добавить в `users` nullable `handle`, `locale`, `avatarAssetId`, `prevAvatarId`, `nameCheckStatus`, `avatarCheckStatus`.
3. Выполнить preflight по `lower(slug)`: если два legacy slug совпадают без учёта регистра, остановить миграцию с диагностикой числа конфликтов без вывода e-mail или самих значений. Молчаливый выбор владельца редиректа запрещён.
4. Для каждого существующего пользователя зарезервировать `lower(slug)` в `handle_history` как прежний адрес. Таблица допускает legacy-строки вне нового regex: они нужны только для старых 301, а не для назначения текущим хэндлом.
5. Для каждого существующего пользователя подобрать новый `u-{8 hex}`. Кандидат строится без e-mail; `INSERT ... ON CONFLICT DO NOTHING` в `handle_history` повторяется с новым кандидатом, пока вставка не успешна. Затем `users.handle` и `handle_history.userId` заполняются тем же `userId`.
6. Backfill: `locale = 'ru'`, оба статуса проверки = `ok`; avatar ID остаются `NULL`, существующий `photoUrl` сохраняется.
7. Сделать `users.handle`, `locale`, `nameCheckStatus`, `avatarCheckStatus` `NOT NULL`, установить defaults, создать `users_handle_key`, status-индексы, FK текущего хэндла и FK истории с `ON DELETE SET NULL`.
8. Добавить `users_handle_format_check` и `users_avatar_versions_distinct_check`, удалить старый `users_slug_key`, затем колонку `users.slug`.

Миграция не удаляет строки из `handle_history`. Запрет удаления реестра должен быть отражён в комментарии Prisma-модели и в сервисном API: для него не создаётся обычная delete-операция.

## 5. Атомарные операции

### 5.1. Регистрация

Создать `server/src/auth/handle.ts` с двумя функциями:

```ts
export function generateRandomHandle(): string
export async function createUserWithReservedHandle(
  prisma: PrismaClient,
  input: { email: string; name: string; locale: Locale }
): Promise<User>
```

Алгоритм `createUserWithReservedHandle`:

1. сгенерировать `u-${crypto.randomBytes(4).toString("hex")}`;
2. открыть Prisma transaction;
3. вставить `HandleHistory { handle, userId: null }`;
4. создать `User { ...input, handle }`;
5. установить `HandleHistory.userId` созданного пользователя;
6. при `P2002` именно по PK/unique `handle_history.handle` повторить с новым кандидатом; остальные ошибки не маскировать;
7. если параллельная регистрация столкнулась по `users.email`, прочитать уже созданного пользователя и продолжить выдачу magic link, а не выдавать внутреннюю ошибку.

Rollback транзакции не оставляет «осиротевший» резерв для кандидата, который фактически не был выдан.

### 5.2. Смена хэндла

В одной transaction: нормализовать и проверить новый хэндл, вставить новую строку `HandleHistory` с `userId`, затем обновить `User.handle`. Конфликт PK возвращается наружу как доменный `CONFLICT`; прежняя строка уже присутствует в истории и не меняется. Возврат к любому прежнему хэндлу, даже того же пользователя, запрещён требованием «уникален навсегда».

### 5.3. Архив и физическое удаление

Архив меняет только поля состояния пользователя. При физическом удалении FK `HandleHistory.userId` выполняет `SET NULL`; строки реестра остаются, поэтому все когда-либо выданные адреса по-прежнему заняты на уровне базы.

## 6. Файлы реализации

- Изменить `server/prisma/schema.prisma`: enums, профильные поля, отношения и индексы.
- Создать `server/prisma/migrations/20260915170000_user_profile_handle_locale/migration.sql`: DDL, preflight, backfill и constraints.
- Создать `server/src/auth/handle.ts`: генерация и транзакционное выделение хэндла.
- Изменить `server/src/graphql/auth/resolver.ts`: заменить slug из local-part e-mail на allocator и передавать locale регистрации.
- Изменить `server/src/graphql/user/schema.graphql` и соответствующие resolver/operations: публичное поле `handle` вместо `slug`, без публичного `email` по ADR-0018.
- Создать `server/tests/profile-handle-database.test.ts`: интеграционные проверки миграции и ограничений PostgreSQL.
- Создать `server/tests/profile-handle-allocation.test.ts`: контролируемая коллизия случайного кандидата и email-race.
- Дополнить `server/tests/auth-schema-contract.test.ts`: публичный профиль содержит `handle`, но не `email`.
- Создать `docs/reports/2026-09-15-t013-profile-handle-locale-report.md`: фактический diff, отклонения и evidence.

## 7. TDD-последовательность

### Задача 1. Зафиксировать DB-инвариант вечного резерва

- [ ] Поднять отдельную тестовую PostgreSQL 16 из `docker-compose.yml`; не использовать development Neon.
- [ ] Написать failing integration test: пользователь получает `first-handle`, меняет его на `second-handle`, архивируется и удаляется; повторный `INSERT` записи `first-handle` в `handle_history` отклоняется PK базы.
- [ ] Добавить schema и migration, применить миграции к пустой тестовой базе.
- [ ] Повторить test и отдельно проверить, что `handle_history` переживает удаление пользователя с `userId = NULL`.

### Задача 2. Проверить backfill

- [ ] На схеме до T-013 создать двух legacy-пользователей с разными slug.
- [ ] Применить миграцию и проверить: e-mail local-part не стал текущим handle; оба legacy slug находятся в `handle_history`; текущие handle соответствуют regex; locale/status заполнены.
- [ ] Отдельным тестом создать `Ivan` и `ivan` и проверить, что preflight прерывает миграцию до изменения данных.

### Задача 3. Разрешить коллизию при регистрации

- [ ] В unit test подменить генератор: первый кандидат уже существует, второй свободен.
- [ ] Реализовать allocator и проверить, что создаётся пользователь со вторым хэндлом, а ожидаемый `P2002` не выходит из `requestMagicLink`.
- [ ] Проверить, что не-handle Prisma error пробрасывается, а конфликт e-mail приводит к чтению существующего пользователя.

### Задача 4. Обновить контракт API и завершить проверку

- [ ] Обновить GraphQL SDL/resolvers/operations с `slug` на `handle` и сохранить запрет публичного `email`.
- [ ] Выполнить `pnpm --filter server test`, `pnpm --filter server run build:ci`, затем из корня `pnpm format`, `pnpm lint`, `pnpm test`.
- [ ] На свежей локальной копии PostgreSQL выполнить `prisma migrate deploy`, DB-тесты и rollback-rehearsal восстановлением snapshot/новой копии; production/development миграцию на этой стадии не запускать.
- [ ] Записать точные команды, exit code, число выполненных тестов, revision SHA и ограничения evidence в парный отчёт.

## 8. Критерии готовности

- **AC-1 / `t013-handle-reservation-db`**: после смены, архива и физического удаления владельца база отклоняет повторное резервирование прежнего хэндла. Доказательство — integration test против PostgreSQL 16, проверяющий constraint/PK, а не только прикладную валидацию.
- **AC-2 / `t013-registration-handle-collision`**: при занятом первом случайном `u-{8 hex}` регистрация выбирает новый кандидат и возвращает обычный успешный результат; ожидаемый unique conflict не выходит в GraphQL.
- **AC-3 / `t013-profile-schema`**: `User` содержит `name`, `handle`, `locale`, avatar IDs и оба review status; legacy `slug` не является источником нового публичного адреса.
- **AC-4 / `t013-migration-rehearsal`**: migration deploy успешно применён к чистой тестовой базе и к снимку схемы до T-013; destructive backfill проверен до release.

## 9. Риски и меры

- **Cross-table race**: снята единым PK `handle_history.handle`; прикладной `checkHandle` остаётся подсказкой, но не источником истины.
- **Case-fold collision legacy slug**: migration abort через preflight; автоматическое переназначение редиректа запрещено.
- **PII в старом slug**: каждый существующий пользователь получает новый случайный текущий handle; legacy значение хранится только ради редиректа и никогда не строится из e-mail для новых пользователей.
- **Осиротевший случайный резерв**: создание резерва и пользователя происходит в одной transaction.
- **Удаление пользователя**: `ON DELETE SET NULL` сохраняет строку реестра; `CASCADE` для истории запрещён.
- **T-016 ещё не выполнена**: avatar IDs остаются nullable scalar и не притворяются существующими media relations.
- **Prisma не моделирует CHECK**: constraints поддерживаются raw SQL миграции и проверяются DB-тестом; при будущих diff их нельзя удалять.

## 10. Сознательно не входит

- создание `MediaAsset`, upload pipeline, CDN variants и очистка бинарных объектов (T-016);
- UI/UX редактирования профиля (T-031);
- правила содержания имени/аватара, AI-провайдер и полная ручная очередь;
- жалобы на имя/аватар;
- публикация миграции в Render/Neon: её выполняет release engineer после CI, независимого review и репетиции на копии.

## 11. Стадии и handoff

- **Архитектура**: вход — ALTE-36, pinned source revision и перечисленные источники; выход — этот замороженный план. Actor: Altera — архитектор; trace — triggering thread `01a0a5d3-b661-7af3-a6a7-1074893d4c32`.
- **Разработка**: новый чистый worktree от свежей `origin/app`, ветка `server/t-013-profile-handle-locale`; выход — migration, schema, allocator, тесты и парный отчёт.
- **Тестирование**: актуальный implementation SHA; выход — evidence по AC-1…AC-4 с отдельными `check_id` и фактическим выводом.
- **Независимое ревью**: сверяет единое пространство имён, отсутствие `CASCADE` из пользователя в реестр, P2002 routing и pinned sources; verdict `принято` или `вернуть`.
- **Релиз**: backend/shared-input change, поэтому после merge обязательны отдельные CI/merge/deploy/HTTP/DB/Redis evidence по Render/Neon runbook. Миграция сначала репетируется на копии; destructive rollback схемы запрещён, восстановление — из проверенного snapshot/instant restore.

Завершение этого run означает только готовность архитектурного evidence; оно не означает реализацию, прохождение AC или выпуск.

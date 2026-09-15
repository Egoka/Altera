# T-012: сессии и хэшированные токены

- **Дата**: 2026-09-15
- **Задача**: T-012 / Multica ALTE-35
- **Authorization**: допуск оркестратора в ALTE-35; архитектурный запрос
  `01a0a566-a775-7b29-9c23-5b9813ea1944`
- **Базовый коммит задачи**: `4064de2c0eb1342096c5340fd314e31893109de4`
- **Снимок checkout при создании плана**: `065d858ea6a6754e0a4342d22707ecb487906bb8`, ветка
  `docs/adr-0047-plus`; checkout не совпадает с переданным baseline, поэтому план не разрешает
  коммитить или реализовывать T-012 в этой ветке
- **Рабочая ветка реализации**: отдельная `server/t-012-sessions-magic-link` от указанного baseline
- **Отчёт реализации**: `docs/reports/2026-09-15-t012-sessions-magic-link-report.md`
- **Статус**: готов к независимой проверке архитектуры

## 1. Цель и источники контракта

T-012 переводит одноразовые ссылки входа с открытого токена на хэш, добавляет постоянную запись
refresh-сессии и минимальное состояние запроса смены e-mail по коду. Схема должна позволить T-022
реализовать вход, T-023 — ротацию и отзыв, а T-032 — смену e-mail, не реализуя их API и UI в этой
задаче.

Источники по старшинству:

- `docs/decisions/role-review-working-log-2026-09-08.md` §25.8–25.9;
- `docs/spec/50-access/session-lifecycle.md`;
- `docs/spec/30-account/reader/sessions.md`;
- `docs/spec/30-account/reader/email-change.md`;
- `docs/decisions/ADR-0009-sessions-refresh-rotation.md`;
- `docs/decisions/ADR-0022-magic-link-only-login.md`;
- поясняющая модель `docs/vision/03-data-model.md`.

Baseline уже содержит семь ролей и состояние архива из T-011. `MagicLinkToken.token` хранит
открытый 64-символьный токен, отдельной `Session` и состояния смены e-mail нет.

## 2. Точная Prisma-схема

### 2.1. Связи пользователя

В существующую `User` добавить только связи; текущие scalar-поля T-011 не менять:

```prisma
model User {
  // существующие поля
  magicLink          MagicLinkToken?
  sessions           Session[]
  emailChangeRequest EmailChangeRequest?
}
```

### 2.2. MagicLinkToken

Оставить один активный запрос на пользователя и заменить открытый `token` на `tokenHash`:

```prisma
model MagicLinkToken {
  id        String   @id @default(cuid())
  tokenHash String   @unique @db.VarChar(64)
  userId    String   @unique
  user      User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  expiresAt DateTime
  usedAt    DateTime?
  createdAt DateTime @default(now())

  @@map("magic_link_tokens")
}
```

`tokenHash` — lowercase hex SHA-256 от случайного 32-байтового токена. Сам токен существует
только в памяти до передачи почтовому транспорту. `expiresAt` не имеет DB-default: приложение
вычисляет его при создании из `MAGIC_LINK_EXPIRY_MINUTES`. `userId @unique` сохраняет текущий
upsert-контракт «новый запрос инвалидирует прежний». Дополнительный `@@index([tokenHash])`
запрещён как дубликат unique-индекса.

### 2.3. Session

```prisma
model Session {
  id                String    @id @default(uuid())
  userId            String
  user              User      @relation(fields: [userId], references: [id], onDelete: Cascade)
  tokenHash          String    @unique @db.VarChar(64)
  previousTokenHash String?   @db.VarChar(64)
  expiresAt         DateTime
  revokedAt         DateTime?
  userAgent         String?
  ip                String?
  createdAt         DateTime  @default(now())
  lastUsedAt        DateTime  @default(now())

  @@index([userId])
  @@index([previousTokenHash])
  @@map("sessions")
}
```

`tokenHash` и `previousTokenHash` — lowercase hex SHA-256 от случайных 32 байт refresh-токена.
`previousTokenHash` индексируется для обнаружения reuse, но не объявляется unique: текущий и
предыдущий хэши проверяются прикладным кодом ротации T-023. `expiresAt` вычисляется приложением
из существующей настройки `JWT_REFRESH_TOKEN_EXPIRY`; числового срока и DB-default T-012 не
вводит. `revokedAt IS NULL` означает действующую запись. `lastUsedAt` обновляет T-023 при успешной
ротации; T-012 задаёт только исходный `now()`.

`userAgent` хранит исходную строку только на сервере; `deviceClass` и `browserClass` являются
производными безопасными значениями API и не дублируются в БД. Поле `ip` из ADR-0009 остаётся
nullable ПД для расследования и не возвращается в пользовательский API. Полей геолокации
`location`, `country`, `region`, `city`, `latitude`, `longitude`, ASN и результатов GeoIP в
Prisma и SQL нет.

Не добавлять `[ДОПУЩЕНИЕ]` `Session.limited`: ограниченная сессия архива описана в политике как
открытое допущение и не входит в критерии T-012.

### 2.4. EmailChangeRequest

Запрос смены e-mail — отдельная одно-к-одному запись, а не группа nullable-полей `User`:

```prisma
model EmailChangeRequest {
  id        String   @id @default(uuid())
  userId    String   @unique
  user      User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  newEmail  String
  codeHash  String   @db.VarChar(64)
  expiresAt DateTime
  createdAt DateTime @default(now())

  @@map("email_change_requests")
}
```

Одна запись на пользователя моделирует единственный открытый запрос; resend делает upsert и
заменяет `codeHash`, поэтому прежний код сразу недействителен. `newEmail` намеренно не unique:
занятость проверяется только при подтверждении, как требует спецификация, а незавершённый запрос
одного пользователя не резервирует адрес для другого. Подтверждение в T-032 одной транзакцией
проверяет свободный `User.email`, обновляет его и удаляет запрос; cancel и исчерпание срока также
удаляют запись.

Формат и число попыток кода источниками не утверждены. Поэтому схема не добавляет длину кода,
`attemptsLeft` или числовой лимит. `codeHash` — lowercase hex HMAC-SHA-256 от нормализованного
кода с отдельным серверным `EMAIL_CHANGE_CODE_HASH_SECRET`; сравнение выполняется
`crypto.timingSafeEqual`. Это защищает короткий код от офлайн-перебора при утечке БД, в отличие
от обычного SHA-256. Значение секрета хранится только в окружении. `expiresAt` вычисляется из
существующего общего `MAGIC_LINK_EXPIRY_MINUTES`, без нового числа и DB-default.

Автоматические `recoveryToken`, `recoveryCode` и их хэши не добавлять. Утверждённый flow при
потере почты — ручное обращение, проверка `admin`/`owner`, смена `User.email` с аудитом и затем
обычный magic-link вход. Его данные относятся к support/audit задачам; отдельного секрета
восстановления T-012 не требует.

## 3. Хэширование и границы доверия

Создать `server/src/auth/token-hash.ts` с интерфейсами:

```ts
export function hashOpaqueToken(token: string): string
export function hashEmailChangeCode(code: string, secret: string): string
export function equalHexHashes(left: string, right: string): boolean
```

- `hashOpaqueToken` возвращает `createHash("sha256").update(token, "utf8").digest("hex")` и
  используется для magic-link сейчас, для refresh — в T-023.
- `hashEmailChangeCode` возвращает
  `createHmac("sha256", secret).update(`email-change:${code}`, "utf8").digest("hex")`.
- `equalHexHashes` сначала отвергает не-64-символьные hex-строки, затем сравнивает два
  32-байтовых Buffer через `timingSafeEqual`.

В `requestMagicLink` генерировать прежний `randomBytes(32)` токен, сохранять только
`hashOpaqueToken(token)`, а в `verifyMagicLink` вычислять хэш входного токена до
`findUnique({ where: { tokenHash } })`. В SQL, Prisma-ошибках и тестовых snapshot открытый токен
не появляется. Существующий dev-only вывод ссылки в консоль не является хранением в БД и не
расширяется этой задачей; до production его обязан заменить почтовый транспорт T-022/T-029.
T-012 не реализует refresh-ротацию, logout, email-change GraphQL или почтовый транспорт.

## 4. Файлы реализации

- Изменить `server/prisma/schema.prisma`: связи `User`, `MagicLinkToken`, `Session`,
  `EmailChangeRequest`.
- Создать
  `server/prisma/migrations/20260915090200_sessions_hashed_auth_tokens/migration.sql`.
- Создать `server/src/auth/token-hash.ts`.
- Изменить `server/src/graphql/auth/resolver.ts`: записывать и искать magic-link по хэшу.
- Создать `server/tests/auth-token-hash.test.ts`: алгоритмы и отсутствие открытого токена в
  Prisma write/query.
- Создать `server/tests/auth-schema-contract.test.ts`: точные модели, nullable/default/index и
  отрицательный контракт геолокации.
- Перегенерировать `server/src/generated/prisma/**` только `prisma generate`; generated-файлы
  вручную не редактировать.
- Создать парный отчёт `docs/reports/2026-09-15-t012-sessions-magic-link-report.md` после
  реализации.

## 5. SQL миграции и совместимость данных

Миграция должна выполнить шаги в одном файле в таком порядке:

1. Удалить все строки `magic_link_tokens`. Их нельзя просто переименовать: тогда открытые токены
   окажутся в колонке с именем `tokenHash`. Инвалидация незавершённых одноразовых ссылок допустима;
   пользователь запрашивает новую ссылку. Пользователи не удаляются благодаря направлению FK.
2. Удалить дублирующий обычный индекс `magic_link_tokens_token_idx`.
3. Переименовать `token` в `tokenHash`, изменить тип на `VARCHAR(64)`, добавить форматный
   `CHECK` и переименовать unique-индекс в `magic_link_tokens_tokenHash_key`.
4. Создать `sessions` и `email_change_requests` с FK `ON DELETE CASCADE` и индексами §2.

Существенный DDL:

```sql
DELETE FROM "magic_link_tokens";
DROP INDEX "magic_link_tokens_token_idx";
ALTER TABLE "magic_link_tokens" RENAME COLUMN "token" TO "tokenHash";
ALTER TABLE "magic_link_tokens"
  ALTER COLUMN "tokenHash" TYPE VARCHAR(64),
  ADD CONSTRAINT "magic_link_tokens_tokenHash_check"
    CHECK ("tokenHash" ~ '^[0-9a-f]{64}$');
ALTER INDEX "magic_link_tokens_token_key"
  RENAME TO "magic_link_tokens_tokenHash_key";

CREATE TABLE "sessions" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "tokenHash" VARCHAR(64) NOT NULL,
  "previousTokenHash" VARCHAR(64),
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "revokedAt" TIMESTAMP(3),
  "userAgent" TEXT,
  "ip" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastUsedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "sessions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "sessions_tokenHash_check"
    CHECK ("tokenHash" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "sessions_previousTokenHash_check"
    CHECK ("previousTokenHash" IS NULL OR "previousTokenHash" ~ '^[0-9a-f]{64}$')
);

CREATE TABLE "email_change_requests" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "newEmail" TEXT NOT NULL,
  "codeHash" VARCHAR(64) NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "email_change_requests_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "email_change_requests_codeHash_check"
    CHECK ("codeHash" ~ '^[0-9a-f]{64}$')
);

CREATE UNIQUE INDEX "sessions_tokenHash_key" ON "sessions"("tokenHash");
CREATE INDEX "sessions_userId_idx" ON "sessions"("userId");
CREATE INDEX "sessions_previousTokenHash_idx" ON "sessions"("previousTokenHash");
CREATE UNIQUE INDEX "email_change_requests_userId_key"
  ON "email_change_requests"("userId");

ALTER TABLE "sessions" ADD CONSTRAINT "sessions_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "email_change_requests" ADD CONSTRAINT "email_change_requests_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
```

Не применять `IF EXISTS`/`IF NOT EXISTS`: drift должен остановить миграцию. `pgcrypto` не нужен:
старые короткоживущие magic-link записи инвалидируются, а новые хэширует приложение.

## 6. Шаги реализации (TDD)

### 6.1. RED: криптографический и schema-контракты

- [ ] Создать `auth-token-hash.test.ts`: для фиксированного токена проверить известный SHA-256,
      длину 64 и lowercase hex; для одного кода с двумя секретами получить разные HMAC; проверить
      true/false и malformed input у constant-time helper.
- [ ] Через mocked Prisma вызвать `requestMagicLink`: `data.tokenHash`/`update.tokenHash` равен
      SHA-256, а открытого `token` и поля `token` в write payload нет.
- [ ] Вызвать `verifyMagicLink` и проверить `findUnique.where.tokenHash`; открытый token не
      используется как значение Prisma query.
- [ ] Создать `auth-schema-contract.test.ts`, прочитать `schema.prisma` и проверить точные поля,
      `@db.VarChar(64)`, unique/index/Cascade, отсутствие дублирующего magic-link index и отсутствие
      геополей из §2.3.
- [ ] Запустить
      `pnpm --filter server exec vitest run tests/auth-token-hash.test.ts tests/auth-schema-contract.test.ts`
      и сохранить ожидаемый RED: baseline содержит `MagicLinkToken.token`, а `Session` и helper
      отсутствуют.

### 6.2. GREEN: схема, миграция и magic-link

- [ ] Внести точную Prisma-схему §2 и выполнить `pnpm --filter server exec prisma format`.
- [ ] На disposable PostgreSQL создать миграцию `--create-only`, сверить и при необходимости
      привести SQL к §5; реальную development-ветку Neon не использовать. Prisma не отражает
      `CHECK` в модели, поэтому четыре именованных hash-check из §5 сохранять в ручном SQL и
      проверять контрактным тестом миграции.
- [ ] Реализовать `token-hash.ts`, заменить Prisma payload/query в magic-link resolver и не
      менять GraphQL SDL.
- [ ] Выполнить `pnpm --filter server exec prisma generate`.
- [ ] Повторить focused Vitest и получить PASS.

### 6.3. Общие проверки

- [ ] Выполнить обе миграционные репетиции §7.
- [ ] Выполнить отрицательные проверки §8.
- [ ] Выполнить `pnpm --filter server run build:ci`, затем `pnpm format`, `pnpm lint`,
      `pnpm test`; обычный `server build` не использовать, поскольку он применяет миграции.
- [ ] Записать команды, exit code, фактическое число тестов, версии PostgreSQL/Node/pnpm,
      revision и dirty fingerprint в парный отчёт без URL БД и секретов.

## 7. Репетиция миграции на копии

Репетиция запрещена на Neon development branch `br-ancient-mode-adgmr3w1`. Использовать две
изолированные disposable PostgreSQL БД: пустую `T012_EMPTY_DATABASE_URL` и populated-copy
`T012_COPY_DATABASE_URL`. Обе переменные существуют только вне репозитория.

До upgrade populated-copy зафиксировать агрегаты `users`, `articles`, `magic_link_tokens` и
добавить sentinel: пользователь, связанная статья и одна открытая magic-link запись с заведомым
тестовым plaintext. Реальные e-mail, имена, IP и токены в evidence не выводить.

```bash
DATABASE_URL="$T012_EMPTY_DATABASE_URL" DATABASE_URL_UNPOOLED="$T012_EMPTY_DATABASE_URL" \
  pnpm --filter server exec prisma migrate deploy

DATABASE_URL="$T012_COPY_DATABASE_URL" DATABASE_URL_UNPOOLED="$T012_COPY_DATABASE_URL" \
  pnpm --filter server exec prisma migrate deploy
```

После каждого deploy выполнить `prisma migrate status`. На populated-copy проверить:

- counts и sentinel IDs/FK пользователей и статей совпадают до/после;
- `magic_link_tokens` после upgrade пуст: старый plaintext инвалидирован намеренно;
- существуют `sessions` и `email_change_requests`, FK удаляют дочерние записи каскадно;
- вставка 64 lowercase hex в hash-колонки успешна; 63/65 символов, uppercase и не-hex
  отклоняются именованными `CHECK`;
- два пользователя могут иметь одинаковый `newEmail`, но один пользователь не может иметь два
  открытых email-change запроса;
- два `NULL previousTokenHash` разрешены, повторный ненулевой previous hash разрешён индексом;
- повторный `migrate deploy` не выполняет DDL и сообщает отсутствие pending migrations.

Репетиция доказывает схему и сохранность данных, но не ротацию, отзыв, housekeeping или
email-change flow последующих задач.

## 8. Отрицательные проверки безопасности и scope

```bash
grep -RInE --include='schema.prisma' \
  '(location|country|region|city|latitude|longitude|geo|asn)' server/prisma
```

Ожидаемый exit `1`, stdout пуст. Поле `ip` допустимо и намеренно не входит в выражение.

```bash
grep -RInE --include='schema.prisma' --include='*.sql' \
  '(^|[^A-Za-z])(token|refreshToken|magicLinkToken)[[:space:]]+(TEXT|String|CHAR)' \
  server/prisma
```

Ожидаемый exit `1`, stdout пуст: хэш-колонки содержат суффикс `Hash`. Exit `2` любой grep —
ошибка проверки, не PASS. Отдельный Vitest доказывает семантику, поскольку одно имя поля не
доказывает хэширование.

Проверить diff: нет refresh/logout API, UI, location/GeoIP, числового лимита устройств или
попыток кода, автоматического восстановления доступа, миграции реального Neon и изменений
GraphQL-контракта.

## 9. Критерии готовности

- **AC-1 / `t012-schema-contract`**: Prisma schema и SQL точно соответствуют §2/§5; геополя
  отсутствуют, raw `ip` отделён от пользовательского API.
- **AC-2 / `t012-token-hash`**: focused Vitest доказывает, что magic-link сохраняется и ищется
  только по SHA-256, а открытый токен отсутствует в Prisma payload/query; hash helper выдаёт
  64 lowercase hex.
- **AC-3 / `t012-migration-rehearsal`**: вся история применяется на empty DB и миграция T-012 —
  на populated-copy; пользователи/статьи сохранены, старые plaintext magic links явно
  инвалидированы, constraints и повторный deploy проверены.
- **AC-4 / `t012-project-gates`**: `build:ci`, format, lint и полный test завершаются с exit 0 и
  ненулевым числом реально выполненных тестов.

## 10. Риски и handoff

- **Переименование без преобразования оставляет plaintext.** Миграция сначала удаляет все
  короткоживущие строки и только затем переименовывает колонку.
- **Простой SHA-256 короткого кода допускает офлайн-перебор.** Email-change использует HMAC с
  отдельным секретом; magic/refresh остаются SHA-256 только потому, что имеют 256 бит случайности.
- **Лишний unique на pending email меняет продуктовый flow.** `newEmail` не unique; конфликт
  проверяет транзакция подтверждения.
- **Смешение IP и геолокации.** Хранится только nullable raw `ip` из ADR-0009; производные GeoIP
  данные отсутствуют. API T-025 не должен возвращать raw IP.
- **Неподтверждённые лимиты.** Схема не фиксирует число устройств, попыток или новый срок.
- **Неверный checkout.** Реализацию и commit начинать только в отдельной чистой ветке T-012 от
  `4064de2c0eb1342096c5340fd314e31893109de4`; текущая `docs/adr-0047-plus` содержит чужую работу.

| Стадия             | Вход                                    | Выход/evidence                                                     |
| ------------------ | --------------------------------------- | ------------------------------------------------------------------ |
| Архитектура        | T-012, baseline `4064de2`, источники §1 | этот план и независимый verdict архитектуры                        |
| Разработка         | принятый план, отдельная чистая ветка   | schema, SQL, helper, resolver, тесты, парный отчёт                 |
| Тестирование       | revision разработки и отчёт             | AC-1…AC-4 с отдельными check_id и sanitized raw logs               |
| Независимое ревью  | источники, diff, test evidence          | hash semantics, migration safety, отсутствие scope creep           |
| Документация/релиз | принятый source revision                | metadata; после merge — отдельные CI/deploy/HTTP/DB/Redis evidence |

Архитектурный run завершает только техплан. Он не подтверждает реализацию, применение миграции,
приёмку T-012 или выпуск.

# T-011: миграция ролей и состояния учётной записи

- **Дата**: 2026-09-15
- **Ветка**: `server/t-011-migration-roles-account-states`
- **Задача**: T-011 / Multica ALTE-19; архитектурная стадия ALTE-23
- **Authorization**: допуск оркестратора в ALTE-19, комментарий `01a0a371-a2cf-7832-91b8-bd5414bdadf3`; scope — Role enum, состояние архива и признак служебной записи
- **Базовый коммит**: `e8ff1a039a519bd53d36c435b7376a04ec1e3c77`
- **Исходное дерево**: clean
- **Отчёт**: `docs/reports/2026-09-15-t011-migration-roles-account-states-report.md` (заполняется стадией разработки)
- **Статус**: утверждён

## 1. Цель и источники контракта

После реализации Prisma, PostgreSQL и GraphQL используют один набор ролей в порядке
`reader | author | editor | moderator | analyst | admin | owner`; существующие пользователи
сохраняются, а `User` получает минимальное состояние архивирования и устойчивые снимки актора.
Frontend получает обновлённый тип только через GraphQL Code Generator и не хранит ещё один
ролевой словарь.

Контракт:

- `docs/backlog/tasks/T-011-migration-roles-account-states.md`;
- `docs/decisions/role-review-working-log-2026-09-08.md` #4, #7, #12, #13, #30, #46, #47;
- `docs/spec/00-registries/roles.md` и семь файлов `docs/spec/50-access/roles/*.md`;
- `docs/spec/10-flows/archive-account.md`;
- `docs/decisions/ADR-0003-roles-single-source.md` с заменой состава enum по
  `docs/decisions/ADR-0042-analyst-role-and-admin-management.md`.

На baseline Prisma и GraphQL содержат четыре одинаковых значения Role. У `User` нет состояния
архива. Ручной `web/app/types/user.ts` уже удалён ранее, а `codegen.ts` генерирует тип Role в
`web/app/graphql/generated/graphql.ts`; однако две страницы админки ещё содержат uppercase
значения `ADMIN | AUTHOR | READER`.

## 2. Принятые технические решения

### 2.1. Точные Prisma- и SQL-поля

В `server/prisma/schema.prisma` добавить:

```prisma
enum Role {
  reader
  author
  editor
  moderator
  analyst
  admin
  owner
}

enum AccountArchiveMode {
  self
  admin
  emergency
}

model User {
  // существующие поля и связи не меняются
  archivedAt        DateTime?
  archiveMode       AccountArchiveMode?
  archivedByActorId String?
  archivedByRole    Role?
  archiveReason     String?
  isServiceAccount  Boolean             @default(false)
}
```

Соответствие SQL:

| Prisma              | PostgreSQL                           | Null/default             | Назначение                                                      |
| ------------------- | ------------------------------------ | ------------------------ | --------------------------------------------------------------- |
| `archivedAt`        | `"archivedAt" TIMESTAMP(3)`          | `NULL`                   | момент текущего архивирования                                   |
| `archiveMode`       | `"archiveMode" "AccountArchiveMode"` | `NULL`                   | `self`, `admin` или `emergency`; определяет путь восстановления |
| `archivedByActorId` | `"archivedByActorId" TEXT`           | `NULL`                   | снимок UUID актора без внешнего ключа                           |
| `archivedByRole`    | `"archivedByRole" "Role"`            | `NULL`                   | роль актора на момент действия, не текущая роль                 |
| `archiveReason`     | `"archiveReason" TEXT`               | `NULL`                   | свободная внутренняя причина из утверждённого flow              |
| `isServiceAccount`  | `"isServiceAccount" BOOLEAN`         | `NOT NULL DEFAULT false` | происхождение записи, независимое от текущей роли               |

`archiveReason` не вводит категорию причины. Имена четырёх категорий и соответствующий enum
остаются вне T-011 (Q-05/T-073).

### 2.2. Почему актор — снимок, а не self-reference

Выбран `archivedByActorId String?` без Prisma relation и без SQL FK. Self-reference с
`ON DELETE SET NULL` теряет именно тот идентификатор, ради которого хранится история; `RESTRICT`
мешает разрешённому окончательному удалению; каскад недопустим. Строковый снимок сохраняет UUID
после снятия роли, архивирования или удаления актора, а `archivedByRole` сохраняет его полномочия
на момент операции. Целостность «актор существовал и имел право» обеспечивает транзакция
архивирования и неизменяемое событие аудита в последующих задачах, а не FK текущего состояния.

Для `archiveMode = self` оба снимка относятся к самому пользователю. Для `admin | emergency` —
к служебному актору. При восстановлении все пять nullable archive-полей очищаются одной
транзакцией; `isServiceAccount` не меняется.

### 2.3. Инварианты и границы

- Новая активная запись: archive-поля `NULL`, `isServiceAccount = false`, если создание
  служебной записи явно не передало `true`.
- Архивирование записывает `archivedAt`, `archiveMode`, `archivedByActorId`,
  `archivedByRole` и, для административного сценария, `archiveReason` атомарно.
- Nullable-поля нужны для совместимого expand: миграция не архивирует существующих пользователей.
- `isServiceAccount` не вычисляется на чтении из `role`: после снятия служебной роли происхождение
  записи остаётся доступным.
- T-011 не добавляет archive-поля в публичный GraphQL `User`; API архивирования относится к
  последующим flow-задачам.
- Не входят категории блокировки, сессии и их отзыв, каскад архива статей, appeal, права,
  создание первого owner и защита последнего owner.

## 3. Файлы реализации

- Изменить `server/prisma/schema.prisma`: оба enum и поля `User`.
- Создать `server/prisma/migrations/<timestamp>_role_add_moderator_analyst_owner/migration.sql`.
- Создать `server/prisma/migrations/<timestamp>_user_account_archive_state/migration.sql`.
- Изменить `server/src/graphql/user/schema.graphql`: только семь значений `Role`.
- Создать `server/tests/role-schema-contract.test.ts`: точный контракт Prisma ↔ GraphQL.
- Перегенерировать `web/app/graphql/generated/graphql.ts`, `gql.ts`, `index.ts` и
  `schema.graphql` командой корневого codegen; вручную generated-файлы не редактировать.
- Изменить `web/app/pages/admin/users/index.vue` и
  `web/app/pages/admin/users/[slug].vue`: использовать generated `Role`, lowercase значения и
  полный набор подписей ролей; отдельный enum/type не создавать.
- Создать парный отчёт
  `docs/reports/2026-09-15-t011-migration-roles-account-states-report.md` после реализации.

## 4. SQL миграций и порядок DDL

### 4.1. Миграция 1 — `role_add_moderator_analyst_owner`

Историческая `20250726211815_update_roles` пересоздавала тип, потому что удаляла несовместимое
значение `user`: `Role_new` → cast через `text` → rename → drop старого типа. В T-011 ни одно из
четырёх существующих значений не удаляется и не переименовывается, поэтому пересоздание типа и
перезапись всей `users` не нужны. Использовать additive SQL и намеренно не добавлять
`IF NOT EXISTS`, чтобы schema drift завершал deploy ошибкой, а не маскировался:

```sql
-- AlterEnum
ALTER TYPE "Role" ADD VALUE 'moderator' AFTER 'editor';
ALTER TYPE "Role" ADD VALUE 'analyst' AFTER 'moderator';
ALTER TYPE "Role" ADD VALUE 'owner' AFTER 'admin';
```

Результирующий порядок PostgreSQL enum:
`reader, author, editor, moderator, analyst, admin, owner`.

Эта миграция не вставляет и не обновляет строки новыми labels. Она должна полностью завершиться
до следующей миграции: новое enum-значение PostgreSQL нельзя безопасно использовать до commit
транзакции, в которой оно добавлено.

### 4.2. Миграция 2 — `user_account_archive_state`

После зафиксированного расширения Role создать enum режима, добавить nullable state и затем
выполнить единственный backfill:

```sql
-- CreateEnum
CREATE TYPE "AccountArchiveMode" AS ENUM ('self', 'admin', 'emergency');

-- AlterTable
ALTER TABLE "users"
ADD COLUMN "archivedAt" TIMESTAMP(3),
ADD COLUMN "archiveMode" "AccountArchiveMode",
ADD COLUMN "archivedByActorId" TEXT,
ADD COLUMN "archivedByRole" "Role",
ADD COLUMN "archiveReason" TEXT,
ADD COLUMN "isServiceAccount" BOOLEAN NOT NULL DEFAULT false;

-- Backfill existing service records. Existing reader/author stay ordinary.
UPDATE "users"
SET "isServiceAccount" = true
WHERE "role" IN ('editor'::"Role", 'admin'::"Role");
```

Порядок не менять: `Role` расширен и committed → создан `AccountArchiveMode` → добавлены
колонки → выполнен backfill. Default `users.role = reader` не удаляется и не переопределяется.
Ни одна существующая строка не получает новую роль или состояние архива.

## 5. Шаги реализации (TDD)

### 5.1. RED: контракт ролей

- [ ] Создать `server/tests/role-schema-contract.test.ts` до изменения схем.
- [ ] Собрать SDL тем же способом, что `public-schema-contract.test.ts`: `loadFilesSync`,
      `mergeTypeDefs`, `buildASTSchema`.
- [ ] Задать один ожидаемый массив
      `['reader', 'author', 'editor', 'moderator', 'analyst', 'admin', 'owner']`.
- [ ] Сравнить с ним `Object.values(Role)` из `server/src/generated/prisma` и
      `schema.getType('Role').getValues().map(({ name }) => name)`; дополнительно сравнить два
      фактических массива друг с другом. При отсутствии/другом kind GraphQL-типа тест должен падать.
- [ ] Запустить `pnpm --filter server exec vitest run tests/role-schema-contract.test.ts` и
      сохранить ожидаемый RED: отсутствуют `moderator`, `analyst`, `owner`.

### 5.2. GREEN: схемы и SQL

- [ ] Изменить Prisma schema точной формой из §2.1 и выполнить
      `pnpm --filter server exec prisma format`.
- [ ] Создать две миграции с именами из §4 через `prisma migrate dev --create-only` только на
      disposable локальной БД; заменить сгенерированный enum SQL на проверенный SQL §4, если Prisma
      объединил шаги или выбрал пересоздание типа.
- [ ] Обновить GraphQL Role, запустить `pnpm codegen` и убедиться, что generated Role содержит
      ровно семь lowercase значений.
- [ ] Типизировать frontend mock-данные generated `Role`, заменить uppercase role values и
      добавить отображаемые подписи для всех семи ролей без ручного union/enum.
- [ ] Повторить focused test и получить PASS.

### 5.3. Проверки реализации

- [ ] Выполнить обе репетиции из §6.
- [ ] Выполнить grep и codegen checks из §7.
- [ ] Выполнить `pnpm --filter server run build:ci`, затем корневые `pnpm format`, `pnpm lint`,
      `pnpm test`; обычный `server build` для проверки не использовать.
- [ ] Записать фактические команды, exit code, значимый вывод, версии PostgreSQL/Node/pnpm,
      revision и dirty fingerprint в парный отчёт. Секреты и строки подключения не сохранять.

## 6. Репетиция на копии базы

Репетиция запрещена на Neon development branch
`br-ancient-mode-adgmr3w1`. Исполнитель получает две изолированные disposable PostgreSQL БД:

1. `t011_empty` — пустая БД для применения всей истории миграций с нуля;
2. `t011_populated` — копия baseline schema с данными. Допустима очищенная копия разрешённой БД
   или синтетическая копия; URL задаются только переменными `T011_EMPTY_DATABASE_URL` и
   `T011_COPY_DATABASE_URL` вне репозитория.

### 6.1. Данные до upgrade

Перед миграцией в `t011_populated` зафиксировать общее число пользователей и группировку по
`role`, затем обеспечить четыре sentinel-строки (с уникальными `.invalid` e-mail и UUID) и по
одной связанной статье для `author` и `editor`:

| id suffix | role     | ожидаемый `isServiceAccount` после | archive state после |
| --------- | -------- | ---------------------------------: | ------------------- |
| `...0001` | `reader` |                            `false` | все поля `NULL`     |
| `...0002` | `author` |                            `false` | все поля `NULL`     |
| `...0003` | `editor` |                             `true` | все поля `NULL`     |
| `...0004` | `admin`  |                             `true` | все поля `NULL`     |

Сохранить только агрегаты, sentinel UUID и связи; реальные e-mail/имена из копии в evidence не
выводить.

### 6.2. Команды и утверждения

```bash
DATABASE_URL="$T011_EMPTY_DATABASE_URL" DATABASE_URL_UNPOOLED="$T011_EMPTY_DATABASE_URL" \
  pnpm --filter server exec prisma migrate deploy

DATABASE_URL="$T011_COPY_DATABASE_URL" DATABASE_URL_UNPOOLED="$T011_COPY_DATABASE_URL" \
  pnpm --filter server exec prisma migrate deploy
```

После каждого deploy выполнить `prisma migrate status`. На populated copy проверить SQL:

```sql
SELECT enumlabel
FROM pg_enum
JOIN pg_type ON pg_type.oid = pg_enum.enumtypid
WHERE pg_type.typname = 'Role'
ORDER BY enumsortorder;

SELECT role::text, count(*)
FROM users
GROUP BY role
ORDER BY role;

SELECT id, role::text, "archivedAt", "archiveMode"::text,
       "archivedByActorId", "archivedByRole"::text,
       "archiveReason", "isServiceAccount"
FROM users
WHERE id IN (
  '00000000-0000-0000-0000-000000000001',
  '00000000-0000-0000-0000-000000000002',
  '00000000-0000-0000-0000-000000000003',
  '00000000-0000-0000-0000-000000000004'
)
ORDER BY id;

SELECT count(*) FROM users;
SELECT count(*) FROM articles;
```

Ожидается:

- empty rehearsal применяет всю историю без ошибок;
- Role содержит ровно семь labels в согласованном порядке;
- число `users`, число `articles`, sentinel IDs и их FK не меняются;
- группировки четырёх старых ролей до/после одинаковы, новых ролей в старых строках нет;
- sentinel `reader/author` имеют `isServiceAccount = false`, `editor/admin` — `true`;
- все archive-поля существующих строк `NULL`;
- новая вставка без `role` получает `reader`, без service flag — `false`;
- в транзакции, завершённой `ROLLBACK`, успешно вставляются `moderator`, `analyst`, `owner` и
  `archivedByRole` с каждым из семи значений.

Повторное применение миграций должно показать отсутствие pending migrations, а не повторно
выполнять DDL. Эта проверка доказывает миграционный путь, но не реализацию будущей транзакции
архивирования, отзыв сессий или каскад статей.

## 7. Контрактный тест и frontend grep

Контрактный тест проверяет три равенства с учётом порядка:

```text
expected seven roles == generated Prisma Role
expected seven roles == merged GraphQL Role
generated Prisma Role == merged GraphQL Role
```

Перед тестом выполняется `pnpm --filter server exec prisma generate`; GraphQL берётся из всех
`server/src/graphql/**/*.graphql`, а не из одного файла. После изменения SDL выполнить:

```bash
git diff -- web/app/graphql/generated > /tmp/t011-codegen-before.diff
pnpm codegen
git diff -- web/app/graphql/generated > /tmp/t011-codegen-after.diff
cmp /tmp/t011-codegen-before.diff /tmp/t011-codegen-after.diff
```

Первый снимок снимается после первоначального `pnpm codegen`; повторная генерация не должна
изменить diff, поэтому `cmp` завершается с exit 0.

Точная отрицательная grep-проверка ручных словарей (generated-каталог исключён):

```bash
grep -RInE --exclude-dir=generated --include='*.ts' --include='*.vue' --include='*.graphql' \
  'type[[:space:]]+Role[[:space:]]*=|enum[[:space:]]+Role|["'\'']user["'\''][[:space:]]*\|[[:space:]]*["'\'']admin["'\'']|["'\'']admin["'\''][[:space:]]*\|[[:space:]]*["'\'']user["'\'']' \
  web/app
```

Ожидаемый exit code — `1`, stdout пуст. Отдельная проверка оставшегося uppercase mock-словаря:

```bash
grep -RInE --exclude-dir=generated --include='*.ts' --include='*.vue' \
  '(role:|case|id:)[[:space:]]*["'\''](READER|AUTHOR|EDITOR|MODERATOR|ANALYST|ADMIN|OWNER)["'\'']' \
  web/app
```

Ожидаемый exit code — `1`, stdout пуст. Exit `1` для этих двух grep-команд означает «совпадений
нет» и записывается как PASS; exit `2` означает ошибку команды и не является PASS.

## 8. Критерии готовности

- **AC-1 / `t011-migration-rehearsal`**: обе disposable-репетиции успешны; на populated copy
  сохранены row counts, IDs/FK и четыре старых значения; backfill совпал с таблицей §6.1.
- **AC-2 / `t011-role-schema-contract`**: focused Vitest доказывает точное равенство семи
  значений Prisma и merged GraphQL SDL.
- **AC-3 / `t011-frontend-role-single-source`**: `pnpm codegen` идемпотентен; обе grep-проверки
  не находят ручной `user | admin` или uppercase mock-словарь вне generated-каталога.
- **AC-4 / `t011-project-gates`**: `build:ci`, format, lint и полный test завершились с exit 0 и
  ненулевым числом реально выполненных тестов.

## 9. Риски и снятие

- **Использование нового enum label до commit.** Enum вынесен в первую миграцию; во второй нет
  присвоения новых ролей существующим строкам.
- **Потеря строк при enum cast.** Cast не выполняется: используются только `ADD VALUE`, старые
  labels и default остаются на месте; сохранность подтверждает before/after rehearsal.
- **Потеря актора после удаления.** Нет FK и `SET NULL`; остаются два снимка.
- **Ошибочная классификация обычного пользователя как служебного.** Backfill затрагивает только
  существующие `editor/admin`; `reader/author` проверяются sentinel-строками.
- **Незаметный schema drift.** DDL без `IF NOT EXISTS` падает; миграция применяется сначала на
  двух disposable БД.
- **Новый ручной frontend enum.** Generated `Role`, идемпотентный codegen и отрицательный grep.
- **Случайная миграция реальной development БД.** Все rehearsal-команды требуют специально
  именованных `T011_*` URL; Render/Neon deploy выполняет только релиз-инженер после обязательных
  стадий и не относится к архитектурной стадии.

## 10. Стадии и handoff

| Стадия               | Вход                                    | Выход/evidence                                                                                         |
| -------------------- | --------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| Архитектура, ALTE-23 | T-011, baseline `e8ff1a0`, источники §1 | этот план, committed revision, review архитектуры                                                      |
| Разработка           | принятый план                           | две миграции, schema/SDL/frontend/test, парный отчёт и команды §5                                      |
| Тестирование         | revision разработки и отчёт             | AC-1…AC-4 с отдельными check_id, raw sanitized logs и verdict                                          |
| Независимое ревью    | источники, diff, test evidence          | проверка snapshot-актора, scope, миграционного порядка и каждого AC                                    |
| Документация/релиз   | принятый source revision                | metadata; после merge — отдельные CI, Render deploy, HTTP/DB/Redis evidence по infrastructure contract |

Архитектурный run завершает только стадию плана. Он не подтверждает применение миграции,
готовность source-кода, приёмку T-011 или выпуск.

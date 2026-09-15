# T-012: отчёт о сессиях и хэшированных токенах

- **Дата**: 2026-09-15
- **Задача**: T-012 / Multica ALTE-35
- **План**: `docs/plans/2026-09-15-t012-sessions-magic-link.md`
- **Базовый коммит**: `4064de2c0eb1342096c5340fd314e31893109de4`
- **Ветка**: `server/t-012-sessions-magic-link`
- **Статус**: реализация завершена, передаётся на тестирование и независимое ревью

## Что сделано

- Добавлена Prisma-модель `Session` с SHA-256 hash-полями текущего и предыдущего refresh-токена,
  сроком, отзывом, raw `userAgent`/`ip`, датами и индексами. Производных GeoIP-полей нет.
- `MagicLinkToken.token` заменён на `tokenHash VARCHAR(64)`: приложение сохраняет и ищет только
  SHA-256 hex. Миграция сначала удаляет legacy plaintext-строки, затем переименовывает колонку.
- Добавлена одно-к-одному модель `EmailChangeRequest`: `newEmail`, HMAC-SHA-256 `codeHash`,
  `expiresAt`; unique только на `userId`, поэтому pending e-mail не резервируется между
  пользователями.
- Добавлены `hashOpaqueToken`, `hashEmailChangeCode` и проверка корректных lowercase SHA-256 hex
  через `timingSafeEqual`. Helper принимает секрет HMAC параметром; новой конфигурации или
  env-переменной T-012 не вводит.
- Срок magic-link продолжает вычисляться из `MAGIC_LINK_EXPIRY_MINUTES`; существующий refresh
  срок остаётся в `JWT_REFRESH_TOKEN_EXPIRY`. GraphQL SDL, refresh/logout и UI не менялись.
- Добавлены девять focused tests для хэшей, Prisma payload/query, схемы и SQL-контракта.

## Как проверено

Среда:

```text
PostgreSQL 16.15 (два одноразовых локальных Docker-контейнера)
Node v24.3.0
pnpm 10.18.3
Prisma 6.12.0
```

Репозиторий требует Node 24.12.0; runtime использовал v24.3.0, поэтому pnpm выводил
`Unsupported engine`. Все перечисленные успешные команды завершились с exit 0.

### AC-1 — `t012-schema-contract`

`auth-schema-contract.test.ts` проверяет модели, hash-типы, unique/index/Cascade, отсутствие
дублирующего magic-link индекса и именованные SQL `CHECK`.

```text
pnpm --filter server exec prisma format: exit 0
grep GeoIP-полей в schema.prisma: grep exit 1, stdout пуст (PASS)
grep plaintext token-полей в schema/migrations: grep exit 1, stdout пуст (PASS)
git diff --check: exit 0
```

В diff есть nullable raw `Session.ip`; `location`, `country`, `region`, `city`, `coordinates`,
`latitude`, `longitude`, `geo` и `asn` отсутствуют.

### AC-2 — `t012-token-hash`

TDD RED на baseline:

```text
Команда: pnpm --filter server exec vitest run tests/auth-token-hash.test.ts tests/auth-schema-contract.test.ts
Exit: 1
Результат: 2 files failed, 9 tests failed
Причины: отсутствовали helper/Session/EmailChangeRequest/миграция; resolver писал и искал token.
```

После первого RED исправлен только независимый expected hash теста: resolver хэширует hex-строку
32 случайных байт, а первоначальный literal относился к другому представлению. Повторный RED снова
дал 9 ожидаемых failures по отсутствующей реализации.

GREEN:

```text
Команда: pnpm --filter server exec vitest run tests/auth-token-hash.test.ts tests/auth-schema-contract.test.ts
Exit: 0
Результат: 2 files passed, 9 tests passed
```

Тест resolver фиксирует известные random bytes и доказывает, что Prisma upsert получает только
`tokenHash`, а lookup — только `where.tokenHash`; plaintext отсутствует в сериализованных
payload/query. SHA-256 и HMAC сверяются с независимыми литералами.

### AC-3 — `t012-migration-rehearsal`

Реальная Neon development-ветка не использовалась. Две отдельные локальные PostgreSQL БД:

- empty: полная история из семи миграций применена; `prisma migrate status` сообщил
  `Database schema is up to date!`;
- populated-copy: сначала применены шесть baseline-миграций из Git snapshot `4064de2c`, затем
  добавлены sentinel user, content type, article и legacy plaintext magic link; после этого
  применена только миграция T-012.

До upgrade агрегаты populated-copy были `users=1`, `articles=1`, `magic_links=1`. После upgrade
проверено:

```text
sentinel user/article и их FK сохранены
legacy magic links: 0 до добавления новой hash-only записи
64 lowercase hex: принимается
63/65 символов, uppercase и non-hex: отклоняются
NULL previousTokenHash: 2 строки
одинаковый non-null previousTokenHash: 2 строки
одинаковый pending newEmail у разных пользователей: 2 строки
второй открытый EmailChangeRequest одного пользователя: отклонён unique constraint
удаление пользователя каскадно удаляет Session и EmailChangeRequest
```

Первая попытка проверочного SQL остановилась с exit 3: `VARCHAR(64)` отклонил 65 символов кодом
`string_data_right_truncation` раньше именованного `CHECK`, а harness ожидал только
`check_violation`. Между попытками изменён только список ожидаемых SQLSTATE, disposable copy DB
пересоздана и вся последовательность повторена с baseline. Вторая попытка завершилась exit 0.
Повторные `prisma migrate status` и `migrate deploy` дали соответственно
`Database schema is up to date!` и `No pending migrations to apply.`

### AC-4 — `t012-project-gates`

```text
pnpm --filter server run build:ci: exit 0
pnpm format: exit 0, All matched files use Prettier code style
pnpm lint: exit 0
pnpm test: exit 0
server: 14 files passed; 81 tests passed, 1 todo
web: 11 files passed; 75 tests passed
```

До создания отчёта HEAD оставался baseline `4064de2c0eb1342096c5340fd314e31893109de4`;
fingerprint списка изменённых путей (`git status --porcelain=v1 | shasum -a 256`) —
`ab6b665b56f495d694a0823c0012ebccbc807e3c3c188fb446acdf41d6c0dfcb`.

## Security/scope review

- Magic-link токен имеет 256 бит случайности и хранится как SHA-256; короткий email-change код
  предназначен для HMAC-SHA-256 с передаваемым серверным секретом.
- Сравнение hash-значений отвергает malformed/uppercase вход до `timingSafeEqual`.
- SQL hash-колонки ограничены `VARCHAR(64)` и lowercase-hex `CHECK`; старый plaintext намеренно
  инвалидируется до rename.
- В schema/diff нет GeoIP, refresh/logout API, email-change API, UI, лимитов устройств/попыток,
  новых сроков или изменений GraphQL SDL.

## Остаток и передача

Реализация не применялась к Neon development и не выпускалась. Следующая стадия должна проверить
закоммиченную ревизию по AC-1…AC-4, затем передать её независимому ревьюеру. После принятого PR в
`app` release engineer отдельно подтверждает Render deploy, HTTP smoke и DB/Redis readiness по
release-контракту.

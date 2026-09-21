# План T-062: адаптер хранилища S3 с локальной реализацией, раскладка ключей, подписанные ссылки

- **Задача**: `docs/backlog/tasks/T-062-storage-adapter-signed-urls.md`
  (blob `7ec1ca1223f768020e3a5213a57e9baa36102f8f`, последний коммит файла `bb67f06`)
- **Native issue**: ALTE-114 (`01a0c301-c295-710d-9d4c-e1fe579a4580`)
- **Эпик**: E-10 «Медиа»
- **Baseline `origin/app`**: `c4bc83b57c6f74f3609b8e2cbd25a349a0ff2152`
- **Ветка**: `feat/t062-storage-adapter`
- **Источники**: журнал #28, §29.2, §29.3; `docs/spec/85-media-and-binary/storage-layout.md`,
  `docs/spec/85-media-and-binary/access-and-signed-urls.md`; ADR-0008, ADR-0011

## Что уже есть и чего нет

Модель `MediaAsset` (`storageKey`, `variants`, `processingStatus`, `deletedAt`) и связи
`Article.coverAssetId`, `User.avatarAssetId` в схеме есть; словарь ошибок уже знает
`PROVIDER_UNAVAILABLE: storage` (§29.3). Кода хранилища нет: ни интерфейса, ни ключей, ни
ссылок. Группа `storage` в системных настройках админки пуста.

## Что делаю

1. **`server/src/storage/keys.ts`** — раскладка `storage-layout.md` п. 3–4: мастер
   `{yyyy}/{mm}/{id}.{ext}`, вариант `{yyyy}/{mm}/{id}/w{width}.{format}`, выгрузка
   `exports/{userId}/{id}.{ext}`; `id` — только UUID, расширение — только из белого списка,
   имя файла пользователя в ключ не попадает. Разбор ключа обратно в `{kind, assetId}`.
2. **`server/src/storage/types.ts`** — интерфейс `ObjectStorage`: `put`, `get`, `exists`,
   `delete`, `signedGetUrl(key, { expiresInSeconds })`. Срок подписи задаёт вызывающий: журнал
   чисел не фиксирует, спецификация держит их как `[ДОПУЩЕНИЕ]`; верхняя граница — 7 суток,
   технический предел SigV4. Сбой провайдера — `StorageUnavailableError`, в API —
   `PROVIDER_UNAVAILABLE: storage`.
3. **`server/src/storage/local.ts`** — файловая реализация для разработки и CI; подпись —
   HMAC-SHA256 над методом, ключом и сроком, сравнение за постоянное время.
4. **`server/src/storage/s3.ts`** — S3-совместимый провайдер без новых зависимостей: SigV4 для
   запросов (`fetch`) и query-подпись для ссылок; path-style и virtual-host. Конкретный
   провайдер не выбирается (Q-01) — адаптер работает с любым S3-совместимым API.
5. **`server/src/storage/config.ts`** — выбор реализации из окружения по образцу почты:
   вне production без значения — `local`; в production без значения — `unconfigured`, каждая
   операция падает как недоступный провайдер; `local` в production запрещён.
6. **`server/src/storage/access.ts`** — политика `access-and-signed-urls.md` п. 1–3, 8:
   публичен только вариант готового неудалённого медиа, связанного с опубликованной статьёй или
   являющегося аватаром неархивированного аккаунта; оригиналы и всё прочее — только подписанная
   ссылка. Резолвер по Prisma читает связи обложки и аватара.
7. **`server/src/storage/gateway.ts`** — раздача `GET /media/<key>` для локальной реализации
   (модель CDN): подпись верна — отдать без кеша; без подписи — только публичный вариант, иначе
   404; подпись неверна или просрочена — 403. Query-строка не логируется (п. 7).
8. Подключение в `server.ts`, переменные в `env.example`, `ENV_SETUP.md` и группа `storage`
   системных настроек; `.storage/` в `.gitignore`.

### Проверки

9. `server/tests/storage-keys.test.ts`, `storage-local.test.ts`, `storage-s3.test.ts` (эталонный
   вектор подписи из документации AWS и запросы на двойнике `fetch`), `storage-config.test.ts`,
   `storage-access.test.ts` — в том числе оба критерия: оригинал без подписи отклоняется,
   архивирование закрывает публичную ссылку, восстановление открывает снова.

## Границы

Конвейер загрузки, варианты, карантин — T-063/T-064. Выбор провайдера — Q-01, владелец.
Связи медиа с узлами документа (`attrs.assetId`) в базе пока не хранятся — резолвер покрывает
обложку и аватар, остальное добавится вместе с конвейером. Миграций нет.

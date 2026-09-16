# T-016 — миграция медиафайлов

## Исходные данные

- Задача: `docs/backlog/tasks/T-016-migration-media-asset.md`.
- Базовая ревизия: `99511c3ceb0ff32a93cb15b1b359f48b3a3f3e0c` (`origin/app`).
- Зависимость T-015: миграция `20260916120000_article_translations_revisions`, PR #68,
  `6b9a411c`.
- Источники модели: `docs/vision/03-data-model.md`, ADR-0008, ADR-0030 и политики в
  `docs/spec/85-media-and-binary/`.

## Что реализовано

- Добавлена модель `MediaAsset` с безопасным мастер-ключом `storageKey`, JSON-набором
  `variants`, метаданными файла, фокусной точкой, единым `alt`, лицензией, атрибуцией и soft
  delete.
- Добавлен статус обработки `uploading → queued → processing → ready / failed`.
- Добавлены связи владельца, общей обложки материала, текущего и предыдущего аватара. Медиа в
  документе и сохранённых ревизиях по-прежнему ссылается только через `attrs.assetId`; отдельного
  `alt` у узла документа нет.
- Добавлена миграция `20260916170000_media_assets` без бэкфилла внешних legacy-изображений, как
  требует M8 в модели данных.
- В обязательный CI сервера добавлен PostgreSQL-тест миграции.

## Как проверено

- RED до реализации: целевой тест — 2 failed, отсутствовала миграция
  `20260916170000_media_assets`.
- `pnpm --filter server exec prisma validate --schema prisma/schema.prisma` — exit 0.
- Полное применение 11 миграций к одноразовой локальной PostgreSQL 17 — exit 0.
- `prisma migrate diff` между этой базой и `schema.prisma` — exit 0, `No difference detected`.
- `T016_TEST_DATABASE_URL=… pnpm --filter server exec vitest run tests/media-asset-migration-database.test.ts`
  — 1 файл, 2 теста passed. Тест подтверждает жизненный цикл, единственную колонку `alt` в
  `media_assets` и выборку ровно тех файлов, на которые не ссылаются документ, сохранённая
  ревизия, обложка, текущий или предыдущий аватар.
- `T016_TEST_DATABASE_URL=… pnpm --filter server test` — 21 файл passed, 3 skipped; 121 тест
  passed, 9 skipped. Пропуски относятся к ранее существующим условным наборам.
- `T016_TEST_DATABASE_URL=… pnpm test` — server: 121 passed, 9 skipped; web: 131 passed.
- `pnpm --filter server run build:ci` — exit 0.
- `pnpm lint` — exit 0.
- `pnpm format` — exit 0; Prisma-схема дополнительно отформатирована командой `prisma format` и
  валидирована отдельно.

Миграции применялись только к одноразовой локальной базе; внешние и production-базы не
изменялись.

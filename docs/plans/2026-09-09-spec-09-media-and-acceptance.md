# План: заход 9 — медиа и бинарные файлы, сверка реестров, свод открытых вопросов

- **Дата**: 2026-09-09
- **Базовый коммит**: c0b6398
- **Отчёт**: docs/reports/2026-09-09-spec-09-media-and-acceptance-report.md
- **Статус**: завершён (отчёт — docs/reports/2026-09-09-spec-09-media-and-acceptance-report.md)

## Вход

- ADR-0008 (медиа в S3 РФ, лицензия и атрибуция), ADR-0030 (варианты при загрузке), ADR-0011,
  ADR-0014, ADR-0044; `docs/vision/03-data-model.md` (`MediaAsset`), `08-operations.md` §1, §5, §11,
  `06-design-system.md` (варианты 480/960/1440/2000); журнал §11, #28, §3, §5, §26.10, §27.6, §28.8;
  `30-account/author/article-edit.md`, `reader/profile-edit.md`, `reader/export.md`,
  `70-plans-and-billing/receipts-54fz.md`, `80-observability/retention-and-pd.md`; матрица #39–44.
- Все реестры `00-registries/*`, `60-ranking/README.md`, `docs/spec/README.md`; все
  `[ВОПРОС ВЛАДЕЛЬЦУ]` в `docs/spec`.

## Выход

`docs/spec/85-media-and-binary/`: storage-layout, upload-pipeline, image-variants, avatars,
article-covers, exports, receipts-and-documents, retention-and-orphans, backups,
access-and-signed-urls — 10 политик по `_templates/policy.md` (≥ 60 строк, 6 разделов).
Сверка реестров: каждая строка «утверждён / на утверждении» имеет файл; каждый файл спецификации
упомянут реестром или картой `docs/spec/README.md` (карта дополняется явными перечнями политик).
`docs/spec/OPEN-QUESTIONS.md` — свод всех `[ВОПРОС ВЛАДЕЛЬЦУ]` с файлом и последствием плюс
отложенные владельцем темы. Реестр событий заморожен (§28.3): нужные коды медиа — в отчёт как
вопросы, строки не добавляются.

## Правила захода

Общий блок программы; лимиты и форматы — из ADR-0008/0030 с `[ДОПУЩЕНИЕ]`, новых чисел не
вводить; медиа привязано к статье (журнал #28); секреты и подписанные ссылки — §27.6; сроки —
`retention-and-pd.md`.

## Проверка

Скрипт: размеры и число разделов; двусторонняя сверка реестров и файлов; коды ошибок и событий;
словарь; свод вопросов совпадает с `OPEN-QUESTIONS.md`.

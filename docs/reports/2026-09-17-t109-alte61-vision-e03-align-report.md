# Отчёт: Ревизия 03-data-model.md под миграции E-03 (ALTE-61)

- **Дата**: 2026-09-17
- **Задача**: T-109 / ALTE-61
- **Ветка**: docs/t109-vision-e03-align
- **Tested SHA**: 0323bbf0ccc1ac8e0fe73287b262774bfbc56d75
- **Actor / run**: e682f2d5-7541-475e-a0b4-ef0b8ae885f4 (хранитель документации)
- **Run outcome**: success

## 1. Контекст

Предыдущий заход T-109 (ALTE-6/ALTE-51, PR #26, 2026-09-14) синхронизировал `docs/vision/01,03,04,05,07` с журналом Г1–Г9. После этого были слиты миграции E-03 T-016 – T-019 (2026-09-15–16), включая T-019 (`admin_operational_records`), которая добавила в схему `Job`, `AiProcess`, `MailMessage`, `BackendError`, `LegalText` и другие модели, отличные от упрощённых планировочных `ErrorRecord`/`SentEmail` в `03-data-model.md`.

Новый запуск ALTE-61 устраняет оставшееся расхождение.

## 2. Что сделано

1. **`docs/vision/03-data-model.md` обновлён до ревизии 4**:
   - Заголовок ревизии: `4 (2026-09-17), заменяет ревизию 3 (2026-09-14)`.
   - Добавлена история «Ревизия 3 → 4» с таблицей изменений.
   - Исправлен enum: `ArchiveMode { block delete }` → `AccountArchiveMode { self admin emergency }`.
   - Обновлено поле `User.archiveMode`: тип `ArchiveMode?` → `AccountArchiveMode?`, описание значений.
   - Заменены упрощённые модели `ErrorRecord`/`SentEmail` на фактические модели T-019:
     `Job`, `JobAttempt`, `AiProcess`, `AiCostAggregate`, `MailMessage`, `MailDeliveryEvent`,
     `BackendError`, `BackendErrorStatusHistory`, `LegalText`, `UserLegalConsent`.
   - Добавлены все новые enum: `JobStatus`, `AiProcessKind`, `AiProcessStatus`,
     `MailDeliveryStatus`, `BackendErrorService`, `BackendErrorWorkStatus`,
     `LegalTextKind`, `LegalTextStatus`.
   - Добавлена модель `EmailChangeRequest` (T-013, журнал §25.8).
   - В таблицу миграций добавлена строка M9b (`admin_operational_records`).

2. **Файлы 01, 04, 05, 07**: изменений не требуется — они уже на ревизии 3 с корректной синхронизацией.

## 3. Как проверено

### AC-1: grep по устаревшим правилам — 0 попаданий вне таблиц «было → стало»

**Команда (исходный список из T-109-отчёта)**:
```
grep -n "ai_review|ArticleBoost|overriddenScore|blockedAt|blockedById|blockReason|ReadSalt|ReadEvent|буст.*24|24.*буст" docs/vision/*.md
```
**Результат**: все совпадения — строки «было» в ревизионных таблицах; тело документов чисто. PASS

**Команда (E-03 устаревшие паттерны)**:
```
grep -n "ErrorRecord\|SentEmail\|\bArchiveMode\b\|error_records\|sent_emails" docs/vision/03-data-model.md
```
**Результат**: все совпадения — строки «было» в таблице «Ревизия 3 → 4»; модели в теле документа уже `BackendError`, `MailMessage`, `AccountArchiveMode`. PASS

### AC-2: Проверки репозитория

| Команда | Exit | Результат |
|---|---|---|
| `pnpm format:fix` | 0 | все файлы unchanged |
| `pnpm lint` | 0 | нет ошибок |
| `pnpm test` | 0 | server 140 passed, 16 skipped; web 132 passed |

## 4. Затронутые файлы

| Файл | Изменение |
|---|---|
| `docs/vision/03-data-model.md` | ревизия 3 → 4; E-03 миграции |
| `docs/reports/2026-09-17-t109-alte61-vision-e03-align-report.md` | создан |

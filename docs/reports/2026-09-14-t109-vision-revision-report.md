# Отчёт: Ревизия vision-документов под журнал Г1–Г9

- **Дата**: 2026-09-14
- **План**: docs/plans/2026-09-14-t109-vision-revision.md
- **Задача / authorization**: T-109, ALTE-6 — прямое поручение владельца (issue)
- **Ветка**: codex/autopilot-start
- **Baseline**: 3c35c7766618eb312d4d6f5bac37da6e638e4637
- **Проверенная revision**: 2020bfd (чистое дерево)
- **Коммиты**: f30e969 (план), 2020bfd (ревизии документов)
- **Actor / run**: e682f2d5-7541-475e-a0b4-ef0b8ae885f4 (хранитель документации), ALTE-6
- **Run outcome**: success
- **Stage outcome**: завершена
- **Task acceptance**: не проверено (pending in_review)
- **Результат**: выполнено полностью

---

## 1. Что сделано

По пунктам плана:

1. **Прочитан журнал** `docs/decisions/role-review-working-log-2026-09-08.md` — §21–29; зафиксировано 8 групп изменений.
2. **Прочитаны все 5 целевых файлов**; сняты SHA-256 fingerprints базовой ревизии (записаны в плане).
3. **Исправлены документы**:
   - `docs/vision/01-product.md` → ревизия 3; удалён warning box; бесплатное базовое авторство (§24.1), бинарный AI-вердикт (§21.15–16), множественные равные владельцы (§26.7).
   - `docs/vision/03-data-model.md` → ревизия 3; крупнейший файл (~77 КБ); обновлены модели User (архивирование вместо блокировки), ArticleAiReview→ArticleAiCheck (без score), enum ArticleStatus (ai_check/in_review/rework), EngagementEvent (вместо ReadSalt/ReadEvent), удалён ArticleBoost; добавлены ReviewMessage, ErrorRecord, SentEmail, OwnerException.
   - `docs/vision/04-roles-and-access.md` → ревизия 3; матрицы прав обновлены под новые статусы и роли; блокировка → архивирование.
   - `docs/vision/05-editor.md` → ревизия 3; lifecycle-диаграмма и таблица переходов обновлены (ai_check, in_review, rework); §26.5 claimReview/requestRework/rejectFinal.
   - `docs/vision/07-commerce.md` → ревизия 3; бесплатный первый запуск; постоянная надбавка вместо 24-часового буста; Т-Касса первой.
4. **Warning boxes** ("Расхождения с журналом") полностью удалены из всех 5 файлов.
5. **Grep-проверка устаревших терминов** — совпадения только в колонке «Было» таблиц истории ревизий (ожидаемо).
6. **Проверки**: `pnpm format:fix` exit 0, `pnpm lint` exit 0, `pnpm test` exit 0 (server 19 passed, web 56 passed).
7. **Коммит**: `2020bfd docs(t109): revise vision documents to journal G1-G9`.

## 2. Что не сделано и почему

Все пункты плана выполнены. Открытых отложенных шагов нет.

## 3. Отклонения от плана

Один вызов Edit в 04-roles-and-access.md завершился ошибкой "String to replace not found" из-за расхождения пробелов. Исправлено повторным Read с точным offset; второй вызов прошёл успешно. Счётчик двух неуспехов не задействован (check_id не был установлен для этого шага).

## 4. Затронутые файлы

| Файл | Изменение |
|---|---|
| `docs/plans/2026-09-14-t109-vision-revision.md` | Создан (коммит f30e969) |
| `docs/vision/01-product.md` | ревизия 2 → 3 |
| `docs/vision/03-data-model.md` | ревизия 2 → 3 |
| `docs/vision/04-roles-and-access.md` | ревизия 2 → 3 |
| `docs/vision/05-editor.md` | ревизия 2 → 3 |
| `docs/vision/07-commerce.md` | ревизия 2 → 3 |

## 5. Как проверено

### AC-T109-1: Warning boxes удалены

- **check_id**: ac-t109-1-no-warning-box
- **Actor/run**: хранитель документации, ALTE-6
- **Revision**: 2020bfd (чистое)
- **Команда**: `grep -r "Расхождения с журналом" docs/vision/`
- **Exit code**: 1 (совпадений нет)
- **Результат**: PASS

### AC-T109-2: Устаревшие правила не появляются вне таблиц «было»

- **check_id**: ac-t109-2-no-obsolete-body
- **Actor/run**: хранитель документации, ALTE-6
- **Revision**: 2020bfd (чистое)
- **Команда**: `grep -n "ai_review\|ArticleBoost\|overriddenScore\|blockedAt\|blockedById\|blockReason\|ReadSalt\|ReadEvent\|буст.*24\|24.*буст" docs/vision/*.md`
- **Результат**: все совпадения — строки 20–25 в колонке «Было» таблиц истории ревизий; тело документов чисто. PASS

### AC-T109-3: Проверки репозитория

- **check_id**: ac-t109-3-ci-checks
- **Actor/run**: хранитель документации, ALTE-6
- **Revision**: 2020bfd (чистое)
- **format:fix**: `pnpm format:fix` — exit 0; все файлы unchanged
- **lint**: `pnpm lint` — exit 0
- **test**: `pnpm test` — exit 0; server 19 passed | 1 todo, web 56 passed
- **Результат**: PASS

## 6. Что осталось

Нет открытых действий по T-109. Связанные открытые вопросы (платёжный провайдер, AI-провайдер, юрлицо) остаются отложенными владельцем и не разворачиваются.

## 7. История попыток

Одна стадия. Два шага (план + ревизия). Остановки не было.

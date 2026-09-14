# Отчёт: Исправление mermaid-диаграммы в 05-editor.md (ревью T-109)

- **Дата**: 2026-09-14
- **Задача**: T-109 (ALTE-6), исправление по вердикту «вернуть» независимого ревьюера
- **Ветка**: docs/adr-0047-plus
- **Базовый коммит до правки**: acc4e70
- **Коммит исправления**: e58e947
- **Actor / run**: e682f2d5-7541-475e-a0b4-ef0b8ae885f4 (хранитель документации)
- **Run outcome**: success
- **Stage outcome**: завершена (передача в in_review)

## Что исправлено

Файл `docs/vision/05-editor.md`, mermaid-диаграмма §2:

| Действие | Строка |
|---|---|
| Удалена строка | `review --> published: approve() ревьюером` |
| Заменена строка | `review --> draft: reject(reason) / withdraw()` → `review --> draft: withdraw()` |

**Обоснование**: переход `review → published` напрямую (approve) дублировал и противоречил новому потоку §26.5, где из `review` можно только взять в `in_review` или снять назад в `draft`; `reject(reason)` — устаревший переход, замещённый `rejectFinal()` через `in_review`.

## Проверки

| Команда | Exit | Результат |
|---|---|---|
| `pnpm format:fix` | 0 | все файлы unchanged |
| `pnpm lint` | 0 | — |
| `pnpm test` | 0 | server 19 passed, web 56 passed |

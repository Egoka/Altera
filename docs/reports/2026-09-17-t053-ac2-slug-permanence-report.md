# Отчёт: T-053 AC-T053-2 — bulkDeleteArticles больше не освобождает адрес

- **План**: `docs/plans/2026-09-17-t053-ac2-slug-permanence.md`
- **Задача**: T-053 / ALTE-34, критерий AC-T053-2
- **Ветка**: `fix/t053-ac2-slug-permanence`
- **Базовый коммит**: `478b63a0a90b7c2a6746025794a7cd4858c84c74`

## Что сделано

`bulkDeleteArticles` (`server/src/graphql/article/resolver.ts`) заменён с физического
`article.deleteMany` на `article.updateMany`, архивирующий материал (`status: "archived"`,
`archivedAt`, `archivedByActorId`, `archivedByRole`, `archiveReason: "bulk_delete"`) — тот же
паттерн, что уже используют `archiveArticle` и `taxonomy/service.ts` для секций и тегов. Схема не
менялась: использованы колонки, добавленные миграцией T-015 и уже применённые на проде.

Добавлен тест `server/tests/bulk-delete-articles-archive.test.ts` (2 кейса, мок Prisma):
подтверждает вызов `updateMany` с архивными полями и отсутствие обращения к `deleteMany`.

## Как проверено

Команды выполнены из корня репозитория на базовом коммите `478b63a0a90b7c2a6746025794a7cd4858c84c74`
после внесения изменений; дерево после проверок чистое, кроме изменённых/новых файлов задачи.

| Команда | Результат |
| --- | --- |
| `pnpm --filter server exec vitest run tests/bulk-delete-articles-archive.test.ts` | PASS — 2/2 |
| `pnpm format` | PASS — `All matched files use Prettier code style!` |
| `pnpm lint` | PASS — без замечаний |
| `pnpm test` | PASS — server: 123 passed, 16 skipped (28 files); web: 131 passed (17 files) |
| `pnpm --filter server run build:ci` | PASS — `prisma generate` + `tsc` без ошибок типов |

## Критерий готовности

| AC-ID | Наблюдаемый результат | Статус |
| --- | --- | --- |
| AC-T053-2 (частично) | `bulkDeleteArticles` не освобождает `Article.slug`: уникальный constraint сохраняет адрес навсегда, материал перестаёт быть публично видимым (фильтр `status: "published"` на всех публичных запросах) | ЗАКРЫТО этим заходом |
| AC-T053-2 (полностью) | `(locale, slug)`-резервация на `ArticleTranslation` с проверкой после **физического** удаления через T-076, конкурентный race-тест | НЕ ЗАКРЫТО — требует T-076, которая зависит от T-072/T-073/T-062 (ни одна не начата) |

## Итог

Живая уязвимость (deleted-content slug reuse через единственную admin bulk-мутацию) устранена без
новой миграции и без конкурирующей Prisma-модели, в рамках ограничений архитектора из
`docs/plans/2026-09-15-t053-locale-routing-slugs.md` §4.1. Полное закрытие AC-T053-2 и, соответственно,
разблокировка ALTE-34 остаются невозможны до появления T-076 — зависимость зафиксирована в
Multica-треде задачи.

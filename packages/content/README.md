# `@altera/content`

Схема документа материала, валидация, экстракторы и рендер. Один источник для редактора,
сервера и страницы материала (ADR-0001, ADR-0029). Пакет без зависимостей во время выполнения.

## Каталог блоков

Состав первого бесплатного запуска закреплён журналом §31 п. 1 (этап 1 ADR-0017,
`docs/vision/05-editor.md` §7). Каталог живёт в `src/schema.ts` как данные: чего нет в
`NODE_SPECS` и `MARK_SPECS`, то отклоняется валидацией.

| Узел                           | Атрибуты автора                          | Компонент рендера |
| ------------------------------ | ---------------------------------------- | ----------------- |
| `paragraph`                    | —                                        | `ProseParagraph`  |
| `heading`                      | `level` 2 или 3                          | `ProseHeading`    |
| `blockquote`                   | `kind` `plain` или `pull`                | `ProseQuote`      |
| `bulletList`, `orderedList`    | —                                        | `ProseList`       |
| `listItem`                     | —                                        | `ProseListItem`   |
| `figure`                       | `assetId`, `size` `normal`/`wide`/`full` | `ProseFigure`     |
| `horizontalRule`               | —                                        | `ProseDivider`    |
| марки `bold`, `italic`, `link` | `href` у ссылки                          | инлайн            |

Блоки этапа 5 — галерея, видео, аудио, врезка, embed, таблица, колонки, шаблоны — в первый
запуск не входят (журнал §31 п. 2) и отклоняются как неизвестные узлы.

У каждого блочного узла есть стабильный `attrs.id` (uuid) — якорь для заметок редактора
(ADR-0001 п. 3). У корня документа есть `attrs.schemaVersion` (ADR-0029 п. 4).

## Подпись, атрибуция и `alt` изображения

Узел `figure` хранит только ссылку на медиафайл и размер. Собственных `alt`, `caption`,
`attribution`, `src` и `url` у него нет: единое `alt` создаётся при загрузке и живёт в
медиафайле, размещение в статье его не переопределяет (журнал §29.13, ADR-0053), подпись и
атрибуция тоже берутся из медиа (журнал §31 п. 1). Документ с такими атрибутами не проходит
валидацию. Рендер получает свойства медиафайла через `resolveAsset`.

## Использование

```ts
import { readDocument, renderDocument, toHTML, toPlainText, validateDocument } from "@altera/content"

// Сервер при сохранении: недопустимый документ отклоняется кодом CONTENT_INVALID.
const result = validateDocument(incoming)
if (!result.valid) throw new Error(result.code)

// Чтение сохранённого: миграция версии схемы, затем проверка.
const document = readDocument(stored)

// Страница материала: дерево компонентов дизайн-системы.
const tree = renderDocument(document, { resolveAsset })

// RSS, письма и поиск.
const html = toHTML(document, { resolveAsset })
const bodyText = toPlainText(document)
```

## Что даёт пакет

- `validateDocument`, `assertValidDocument`, `isSafeLink` — проверка перед сохранением;
- `migrateDocument`, `CONTENT_SCHEMA_VERSION`, `DOCUMENT_MIGRATIONS` — версия схемы;
- `toPlainText`, `firstParagraph`, `countWords`, `readingTime`, `extractHeadings`,
  `buildTableOfContents`, `extractImages`, `extractCover`, `extractLinks` — экстракторы;
- `renderDocument`, `toHTML`, `toMarkdown` — рендер и сериализаторы;
- `createDocument`, `createEmptyDocument`, фабрики узлов, `withNodeIds` — сборка документа.

## Ограничения размеров

`DEFAULT_VALIDATION_LIMITS`: глубина 2 (следует из ADR-0017), 5000 узлов и 200 000 символов
текста. Два последних числа — `[ДОПУЩЕНИЕ]`: владелец порогов для документа не задавал, поэтому
они вынесены во второй параметр `validateDocument` и заменяются без правки кода.

## Проверки

```bash
pnpm --filter @altera/content test    # типизация и vitest
pnpm --filter @altera/content build   # dist для потребителей
```

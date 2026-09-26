# E-15: SEO и фиды

- **Стадия роадмапа**: Бесплатный запуск
- **Результат**: `robots.txt` с запретом обучения ИИ, `noindex` служебных страниц, sitemap и RSS по локалям, meta/hreflang/OG/JSON-LD.
- **Источники**: ADR-0002; `20-public/feeds-and-sitemap.md`; журнал §24.2
- **Зависит от эпиков**: E-09
- **Блокеры владельца**: Q-09

## Задачи
| ID | Название | Статус | Зависит от |
|---|---|---|---|
| [T-098](../tasks/T-098-robots-noindex.md) | `robots.txt` с запретом обучения ИИ; `noindex` служебных страниц | завершена (PR #59, merge fd8d703f; приёмка ALTE-24) | — |
| [T-099](../tasks/T-099-sitemap-rss.md) | Sitemap по локалям и RSS | в работе (влита PR #180, merge f974d630; ждёт приёмки ALTE-99) | T-054 |
| [T-100](../tasks/T-100-seo-meta-hreflang.md) | Meta, canonical, hreflang, Open Graph и JSON-LD на публичных страницах | зависит: T-054, T-056, T-057 | T-054, T-056, T-057 |

## Границы
Индексация поиска (F-03).

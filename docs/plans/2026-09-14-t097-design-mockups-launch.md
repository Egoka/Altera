# T-097: Макеты страниц запуска и состояний

- **Дата**: 2026-09-14
- **Ветка**: codex/autopilot-start
- **Задача**: T-097 | docs/backlog/tasks/T-097-design-mockups-launch.md
- **Authorization**: статус `готова`, файл задачи docs/backlog/tasks/T-097-design-mockups-launch.md
- **Базовый коммит**: 9604fc6aa164f0cb43aa961634494f42952d5183
- **Исходное дерево**: dirty: CLAUDE.md (sha256: 8845ad87…), docs/guides/README.md (7ff16632…), server/env.example (9bd42f7b…); untracked: docker-compose.yml, docs/guides/local-development.md, docs/plans/2026-09-14-t001-independent-testing.md, docs/plans/2026-09-14-t003-docker-compose-local.md, docs/reports/2026-09-14-t001-independent-testing-report.md, docs/reports/2026-09-14-t003-docker-compose-local-report.md
- **Отчёт**: docs/reports/2026-09-14-t097-design-mockups-launch-report.md (заполняется по завершении)
- **Статус**: выполняется

## Цель

Макеты главной, ленты рубрики, материала, автора, входа, кабинета, редактора-обвязки, очереди проверки и ключевых разделов админки со всеми состояниями из спецификаций, в трёх точках останова.

## Источники

- `docs/vision/06-design-system.md` — токены, типографика, сетка, компоненты
- `docs/spec/20-public/home.md` — главная
- `docs/spec/20-public/section-feed.md` — лента рубрики
- `docs/spec/20-public/article.md` — страница материала
- `docs/spec/20-public/author.md` — страница автора
- `docs/spec/20-public/login.md` — вход
- `docs/spec/30-account/reader/dashboard.md` — кабинет
- `docs/spec/30-account/author/article-edit.md` — редактор-обвязка
- `docs/spec/40-admin/review-queue.md` — очередь проверки
- `docs/spec/40-admin/dashboard.md` — сводка админки
- ADR-0021 — разделение компонентов

## Три точки останова

| Точка | Диапазон | Tailwind |
|---|---|---|
| mobile | < 768 px | default |
| tablet | 768–1023 px | `md` |
| desktop | ≥ 1024 px | `lg` |

## Шаги

1. Создать директорию `docs/design/mockups/`
2. Создать артефакт `docs/design/mockups/t097-launch-mockups.md` с описаниями раскладок и таблицей покрытия
3. Зафиксировать артефакт коммитом
4. Создать отчёт `docs/reports/2026-09-14-t097-design-mockups-launch-report.md`
5. Зафиксировать отчёт

## Критерий готовности

Каждая обязательная строка состояний спецификации имеет запись в макете — подтверждается таблицей покрытия в артефакте.

## Страницы и число обязательных состояний

| Страница | Источник | Обязательных состояний |
|---|---|---|
| Главная | home.md §8 | 3 (загрузка, пусто, ошибка данных) |
| Лента рубрики | section-feed.md §8 | 3 (загрузка, пусто, ошибка данных) |
| Материал | article.md §8 | 5 (загрузка, ошибка, нет доступа, не найдено/удалено, план истёк) |
| Автор | author.md §8 | 4 (загрузка, пусто, ошибка, не найдено/удалено) |
| Вход | login.md §8 | 4 (загрузка, ошибка, лимит, провайдер недоступен) |
| Кабинет | dashboard.md §8 | 4 (загрузка, пусто, ошибка, план истёк) |
| Редактор-обвязка | article-edit.md §8 | 7 (загрузка, пусто, ошибка, нет доступа, не найдено, план истёк, заблокирован + доп.: ai_check, rejected, конфликт, офлайн) |
| Очередь проверки | review-queue.md §9 | 5 (загрузка, пусто, ошибка, нет прав, конфликт) |
| Сводка админки | admin/dashboard.md §9 | 3 (загрузка, пусто, ошибка) |

Итого обязательных: 38 строк состояний.

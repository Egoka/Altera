# Workflow GitHub Actions: ветка Neon на каждый pull request

- **Дата**: 2026-09-14
- **Ветка**: docs/platform-design
- **Базовый коммит**: d8638ce
- **Отчёт**: docs/reports/2026-09-14-neon-preview-branches-workflow-report.md (заполняется по завершении)
- **Статус**: выполняется

## Цель

На каждый pull request автоматически создаётся изолированная ветка базы Neon (copy-on-write
копия ветки `production`), а при закрытии pull request она удаляется. Это основа для прогона
миграций Prisma и тестов на копии данных без риска для production.

## Контекст

- Владелец подключил интеграцию Neon GitHub App к репозиторию `Egoka/Altera` (метка времени
  в GitHub 2026-09-13T23:59Z). В репозитории появились секрет `NEON_API_KEY` и переменная
  `NEON_PROJECT_ID = purple-salad-06550104` — проверено `gh secret list` и `gh variable list`.
- Проект Neon `Altera` (aws-us-east-1): ветка по умолчанию `production`
  (`br-plain-grass-adrif7r3`), ветка `development` в архиве — вывод `npx neon branches list`.
- Существующий CI `.github/workflows/pull_request.yml` — формат, линт, тесты и дымовой старт
  сервера на pull request в `app`. Neon в нём не участвует, сервер живёт на фиктивном
  `DATABASE_URL`.
- Шаблон workflow — официальное руководство https://neon.com/docs/guides/neon-github-app,
  получено 2026-09-14 как markdown.
- Навыки `neon` и `neon-postgres` установлены коммитом d8638ce.

## Шаги

1. Создать `.github/workflows/neon_workflow.yml` по шаблону Neon: джобы `setup` (имя
   git-ветки через `tj-actions/branch-names@v8`), `create_neon_branch`
   (`neondatabase/create-branch-action@v5`, ветка `preview/pr-<номер>-<git-ветка>` от ветки
   проекта по умолчанию) и `delete_neon_branch` (`neondatabase/delete-branch-action@v3` при
   закрытии pull request).
2. Отображаемые имена джобов и комментарии — по-русски, как в `pull_request.yml`. Шаги с
   миграциями и schema diff остаются закомментированными, как в шаблоне, но пример переписан
   под Prisma этого проекта.
3. Исправить неточность шаблона: `outputs` джоба ссылаются на несуществующий шаг
   `create_neon_branch_encode`; ссылка правится на реальный id `create_neon_branch`.
4. Проверить разбор YAML и форматирование Prettier.
5. Закоммитить (`ci(neon): …`) и написать отчёт.

## Критерии готовности

- Файл существует, YAML разбирается, `on.pull_request.types` = opened, reopened, synchronize,
  closed.
- Секрет и переменная, на которые ссылается workflow, существуют в репозитории.
- Коммит прошёл pre-commit (format, lint, test).
- Фактический прогон на pull request в этот заход не входит: он произойдёт при следующем pull
  request в `app`, результат фиксируется в следующем отчёте.

## Что сознательно не входит

- Прогон миграций Prisma на ветке Neon и schema diff комментарием к pull request — отдельное
  решение: нужно выбрать команду и подключение, а существующий CI на реальную базу не смотрит.
- Изменение `pull_request.yml` и защиты ветки `app`.
- Фильтр `branches: [app]` в триггере: шаблон Neon его не ставит; ветки Neon на pull request в
  другие ветки дёшевы и удаляются при закрытии. `[ДОПУЩЕНИЕ]`
- Замена `tj-actions/branch-names` на `github.head_ref` — возможное упрощение, не делается,
  чтобы не расходиться с шаблоном Neon.

## Риски

- Имена git-веток содержат `/` (`web/home-grid`), имя ветки Neon станет
  `preview/pr-19-web/home-grid`. Шаблон Neon сам ставит `/` в имя; ограничений на символ в
  руководстве нет. Проверяется первым прогоном.
- `concurrency` без `cancel-in-progress`: события одного pull request выполняются по очереди,
  гонки создания и удаления нет.
- `NEON_API_KEY` передаётся только джобам с действиями Neon; сторонний
  `tj-actions/branch-names` работает в отдельном джобе и секрета не получает.

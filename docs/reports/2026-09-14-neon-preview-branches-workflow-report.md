# Отчёт: Workflow GitHub Actions: ветка Neon на каждый pull request

- **Дата**: 2026-09-14
- **План**: docs/plans/2026-09-14-neon-preview-branches-workflow.md
- **Ветка**: docs/platform-design
- **Коммиты**: 910be1c (workflow и план); предпосылка — d8638ce (навыки `neon`, `neon-postgres`);
  отчёт коммитится отдельно
- **Результат**: выполнено полностью

## Что сделано

1. Создан `.github/workflows/neon_workflow.yml` по шаблону руководства
   https://neon.com/docs/guides/neon-github-app: джоб `setup` берёт имя git-ветки через
   `tj-actions/branch-names@v8`; `create_neon_branch` на события opened, reopened, synchronize
   создаёт ветку `preview/pr-<номер>-<git-ветка>` действием `neondatabase/create-branch-action@v5`
   от ветки проекта по умолчанию (`production`); `delete_neon_branch` на closed удаляет её
   действием `neondatabase/delete-branch-action@v3`.
2. Отображаемые имена джобов и комментарии переведены на русский, как в `pull_request.yml`.
   Примеры миграций Prisma и schema diff оставлены закомментированными; пример миграций
   привязан к переменным проекта: `DATABASE_URL` из `db_url_with_pooler`,
   `DATABASE_URL_UNPOOLED` из `db_url` — так устроен `datasource` в
   `server/prisma/schema.prisma` (`url` и `directUrl`).
3. Исправлена неточность шаблона: `outputs` джоба ссылались на шаг `create_neon_branch_encode`,
   которого в шаблоне нет; теперь ссылка на реальный id `create_neon_branch`.
4. YAML разобран библиотекой `yaml@2.8.0` из pnpm-хранилища, Prettier без замечаний.
5. Коммит `910be1c` прошёл pre-commit (format, lint, test).

## Что не сделано и почему

- Прогон на реальном pull request не выполнен: ветка `docs/platform-design` не отправлена в
  origin, pull request не открыт. Первый прогон произойдёт при следующем pull request; тогда
  в Neon Console → Branches должна появиться ветка `preview/pr-<номер>-<git-ветка>`, а после
  закрытия — исчезнуть.
- Миграции Prisma на ветке Neon и schema diff — вне плана, решение отдельное.

## Отклонения от плана

- Нет.

## Затронутые файлы

- `.github/workflows/neon_workflow.yml` — новый.
- `docs/plans/2026-09-14-neon-preview-branches-workflow.md` — новый.
- `docs/reports/2026-09-14-neon-preview-branches-workflow-report.md` — этот отчёт.

## Как проверено

Секрет и переменная интеграции существуют в репозитории:

```
$ gh secret list
NEON_API_KEY	2026-09-13T23:59:26Z
$ gh variable list
NEON_PROJECT_ID	purple-salad-06550104	2026-09-13T23:59:26Z
```

Ветки проекта Neon (родитель новой ветки — `production`):

```
$ npx neon@latest branches list --project-id purple-salad-06550104
Name                  Id                        Current State  Created At
[default] production  br-plain-grass-adrif7r3   ready          2025-07-20T12:25:19Z
development           br-ancient-mode-adgmr3w1  archived       2025-07-20T12:25:33Z
```

Структура workflow (разбор `yaml@2.8.0` из `node_modules/.pnpm`):

```
jobs: setup, create_neon_branch, delete_neon_branch
pr types: opened, reopened, synchronize, closed
create.outputs: {"db_url":"${{ steps.create_neon_branch.outputs.db_url }}","db_url_with_pooler":"${{ steps.create_neon_branch.outputs.db_url_with_pooler }}"}
create.steps: create_neon_branch→neondatabase/create-branch-action@v5
delete.if: github.event_name == 'pull_request' && github.event.action == 'closed'
```

Форматирование:

```
$ cd web && npx --no-install prettier --check ../.github/workflows/neon_workflow.yml ../.github/workflows/pull_request.yml
Checking formatting...
All matched files use Prettier code style!
```

Pre-commit при коммите 910be1c: `pnpm format` — «All matched files use Prettier code style!»
для обоих пакетов, `pnpm lint` без ошибок, `pnpm test` — «Scope: 2 of 3 workspace projects»,
коммит принят. На предыдущем коммите d8638ce тот же хук показал: server — 2 файла, 19 тестов;
web — 6 файлов, 56 тестов; все зелёные.

Не проверено: фактическое создание и удаление ветки Neon на pull request — см. раздел выше.

## Что осталось

- Отправить ветку в origin и открыть pull request в `app`; убедиться в Neon Console, что ветка
  `preview/pr-<номер>-docs/platform-design` создана, а после закрытия pull request удалена.
  Особое внимание — символу `/` в имени git-ветки.
- Решить, включать ли в workflow миграции Prisma и schema diff (заготовки закомментированы).
- Возможное упрощение: `github.head_ref` вместо стороннего `tj-actions/branch-names` и джоба
  `setup`.

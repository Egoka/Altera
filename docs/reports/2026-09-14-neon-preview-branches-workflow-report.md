# Отчёт: Workflow GitHub Actions: ветка Neon на каждый pull request

- **Дата**: 2026-09-14
- **План**: docs/plans/2026-09-14-neon-preview-branches-workflow.md
- **Ветка**: docs/platform-design
- **Коммиты**: 910be1c (workflow и план), 56e21a6 (отчёт); предпосылка — d8638ce (навыки
  `neon`, `neon-postgres`). Pull request: https://github.com/Egoka/Altera/pull/19
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

- Удаление ветки Neon при закрытии pull request ещё не наблюдалось: pull request #19 открыт.
  На событии opened джоб «Удалить ветку Neon» пропущен (skipping), как и задумано.
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

Прогон на pull request #19 (https://github.com/Egoka/Altera/pull/19), событие opened:

```
$ gh pr checks 19 --watch --interval 10
test	pass	2s	https://github.com/Egoka/Altera/actions/runs/34792590306/job/103819618438
Создать ветку Neon	pass	12s	https://github.com/Egoka/Altera/actions/runs/34792590335/job/103819496101
Удалить ветку Neon	skipping	0	https://github.com/Egoka/Altera/actions/runs/34792590335/job/103819496842
Имя git-ветки	pass	2s	https://github.com/Egoka/Altera/actions/runs/34792590335/job/103819485873
Сборка сервера и дымовая проверка старта	pass	52s	https://github.com/Egoka/Altera/actions/runs/34792590306/job/103819485805
Формат, линт и тесты	pass	44s	https://github.com/Egoka/Altera/actions/runs/34792590306/job/103819485709
```

Ветка Neon после прогона — символ `/` из имени git-ветки принят:

```
$ npx neon@latest branches list --project-id purple-salad-06550104
Name                                Id                          Current State  Created At
preview/pr-19-docs/platform-design  br-silent-glitter-ad8ge8iw  ready          2026-09-14T00:24:29Z
[default] production                br-plain-grass-adrif7r3     ready          2025-07-20T12:25:19Z
development                         br-ancient-mode-adgmr3w1    ready          2025-07-20T12:25:33Z
```

Попутное наблюдение: ветка `development` до прогона значилась `archived`, после — `ready`.
Причина не выяснялась.

Не проверено: удаление ветки при закрытии pull request.

## Что осталось

- После слияния или закрытия pull request #19 убедиться, что ветка
  `preview/pr-19-docs/platform-design` удалена (`npx neon branches list`).
- Решить, включать ли в workflow миграции Prisma и schema diff (заготовки закомментированы).
- Возможное упрощение: `github.head_ref` вместо стороннего `tj-actions/branch-names` и джоба
  `setup`.

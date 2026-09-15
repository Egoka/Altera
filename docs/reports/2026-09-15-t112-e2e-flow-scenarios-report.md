# Отчёт: T-112 e2e-сценарии flow запуска

- **Дата**: 2026-09-15
- **План**: docs/plans/2026-09-15-t112-e2e-flow-scenarios.md
- **Задача / authorization**: T-112 / ALTE-25; поручение оркестратора в комментарии `01a0a418-3ca6-79d1-b726-3d2432059c7c`.
- **Ветка**: docs/t-112-e2e-flow-scenarios
- **Baseline**: 9f93b3015e34a645af74e943c617e9325d21f764; исходное дерево clean
- **Проверенная revision**: 9f93b3015e34a645af74e943c617e9325d21f764 + dirty diff e2e-файлов `f99ca5d4f4f51086fefae59c4ee6b61bd62faa05babec043110bf1d319b8531c`
- **Коммиты**: нет (рабочие изменения не закоммичены)
- **Actor / run**: Altera — тестировщик / `01a0a37f-9645-7470-91ac-062ae12607d7`
- **Run outcome**: blocked
- **Stage outcome**: остановлена
- **Task acceptance**: не проверено
- **Результат**: выполнено частично

## 1. Что сделано

- Сверены утверждённые таблицы шагов flow #1, #3, #4, #5, #11, #12, #13, #15 и #16, реестр `flows.md` и ADR-0031.
- В девяти отдельных файлах `web/tests/e2e/` шаги разделены по строкам спецификаций; сохранены именованные ветви `5а`/`5б`, `3а`/`3б`/`3в`/`С`, `1с`/`3о` и `Р1`–`Р3`.
- В каждом файле сохранён один `test.skip(true, reason)` с условием включения после реализации зависимостей.

## 2. Что не сделано и почему

AC-2 не подтверждён полным Playwright-прогоном. В первой попытке в новом worktree отсутствовал `playwright`; после `pnpm install --frozen-lockfile` вторая попытка остановилась до discovery: `webServer` завершился с `Error: LOG_HASH_SECRET is required`. Значение секрета не запрашивалось и не подменялось, а изменение запуска сервера вне scope T-112. По контракту двух последовательных неуспехов одного check дальнейшие повторы не выполнялись.

## 3. Отклонения от плана

Нет в продуктовой части. Для воспроизводимой проверки зависимостей был выполнен `pnpm install --frozen-lockfile` в изолированном worktree; lockfile не изменён.

## 4. Затронутые файлы

- `web/tests/e2e/01-register-login.spec.ts`
- `web/tests/e2e/03-write-publish.spec.ts`
- `web/tests/e2e/04-reedit-after-autopublish.spec.ts`
- `web/tests/e2e/05-manual-moderation.spec.ts`
- `web/tests/e2e/11-admin-archive-account.spec.ts`
- `web/tests/e2e/12-self-archive-export.spec.ts`
- `web/tests/e2e/13-email-change-recovery.spec.ts`
- `web/tests/e2e/15-article-archive-restore.spec.ts`
- `web/tests/e2e/16-permanent-delete.spec.ts`
- `docs/plans/2026-09-15-t112-e2e-flow-scenarios.md`
- этот отчёт

## 5. Как проверено

### AC-1 — отдельные файлы и точные шаги

- **check_id**: `t112-playwright-discovery`
- **Actor / run / стадия**: Altera — тестировщик / `01a0a37f-9645-7470-91ac-062ae12607d7` / тестирование
- **Revision / dirty fingerprint**: `9f93b3015e34a645af74e943c617e9325d21f764` / `f99ca5d4f4f51086fefae59c4ee6b61bd62faa05babec043110bf1d319b8531c`
- **cwd**: `/Users/egorbondarenko/WebstormProjects/Altera/.worktrees/t-112-e2e-flow-scenarios`
- **Команда**: `pnpm --filter nuxt-app exec playwright test --list` с девятью явными путями сценариев
- **Exit code / выполнено**: `0`; обнаружено 9 тестов в 9 файлах
- **Результат**: passed
- **trace_ref**: локальные tool results этого run; существенный вывод — `Total: 9 tests in 9 files`.
- **Ограничение**: discovery парсит и находит сценарии, но не запускает браузер и не доказывает работу сервера или фикстур.

### AC-1 — формат и синтаксис изменённых файлов

- **check_id**: `t112-e2e-format`
- **Actor / run / стадия**: Altera — тестировщик / `01a0a37f-9645-7470-91ac-062ae12607d7` / тестирование
- **Revision / dirty fingerprint**: `9f93b3015e34a645af74e943c617e9325d21f764` / `f99ca5d4f4f51086fefae59c4ee6b61bd62faa05babec043110bf1d319b8531c`
- **cwd**: `/Users/egorbondarenko/WebstormProjects/Altera/.worktrees/t-112-e2e-flow-scenarios`
- **Команда**: `pnpm exec prettier --check` для девяти сценариев и плана
- **Exit code / выполнено**: `0`; все перечисленные файлы соответствуют Prettier
- **Результат**: passed
- **trace_ref**: локальные tool results этого run.
- **Ограничение**: форматирование не исполняет сценарии.

### AC-2 — full Playwright / CI-совместимость skipped сценариев

- **check_id**: `t112-e2e-skipped-ci`
- **Actor / run / стадия**: Altera — тестировщик / `01a0a37f-9645-7470-91ac-062ae12607d7` / тестирование
- **Revision / dirty fingerprint**: `9f93b3015e34a645af74e943c617e9325d21f764` / `f99ca5d4f4f51086fefae59c4ee6b61bd62faa05babec043110bf1d319b8531c`
- **cwd**: `/Users/egorbondarenko/WebstormProjects/Altera/.worktrees/t-112-e2e-flow-scenarios`
- **Команда**: `pnpm --filter nuxt-app run test:e2e`
- **Попытка 1**: exit `1`, выполнено 0; отсутствовал `web/node_modules/.bin/playwright` в новом worktree.
- **Попытка 2**: exit `1`, выполнено 0; `webServer` не стартовал: `LOG_HASH_SECRET is required`.
- **Результат**: blocked; последовательных неуспехов — 2.
- **trace_ref**: локальные tool results этого run.
- **Ограничение**: не выполнено ни одного браузерного теста и не подтверждён CI. Предупреждение окружения: локальный Node `v24.3.0`, pinned проектом `24.12.0`.

## 6. Что осталось

Предоставить штатное CI/локальное окружение с `LOG_HASH_SECRET` и Node `24.12.0`, затем новым разрешённым run выполнить полный `t112-e2e-skipped-ci`; только его успешный exit 0 подтвердит AC-2.

## 7. Handoff и история попыток

Цель: подготовить skipped e2e для девяти flow. Исходники и authorization приведены в плане. Ветка `docs/t-112-e2e-flow-scenarios`, HEAD `9f93b3015e34a645af74e943c617e9325d21f764`; изменены девять e2e-файлов, план и отчёт. Реализация сценариев и static discovery сделаны; полный e2e остаётся. Не приняты альтернативы: не подставлять секрет-заглушку и не менять `webServer`/серверную конфигурацию вне scope. `t112-e2e-skipped-ci → 2`; причина остановки — обязательный `LOG_HASH_SECRET` отсутствует в локальном окружении. Условие возобновления — доступная штатная среда с этой переменной и pinned Node. Активных дубликатов в этой ветке не запускалось. Следующий разрешённый шаг — передать evidence оркестратору и назначить независимое ревью; повтор full e2e возможен только после оформленного recovery.

# Отчёт: слой исполнения автономного цикла

- **Дата завершения**: 2026-09-09
- **План**: docs/plans/2026-09-09-agent-loop-harness.md
- **Ветка**: docs/platform-design
- **Базовый коммит**: 2641747
- **Коммит работы**: не создан — изменения оставлены в рабочем дереве на просмотр владельцу
- **Статус**: выполнен

## 1. Что сделано

| Шаг плана | Результат |
|---|---|
| 1. `.gitignore` | Игнор `.claude/` заменён на выборочный: версионируются `settings.json`, `agents/`, `commands/`, `hooks/`; `settings.local.json` остаётся вне репозитория |
| 2. Настройки проекта | Создан `.claude/settings.json`: allowlist проверок и чтения git, `ask` на миграции и коммиты, `deny` на push и деструктивные git-команды, свой `autoMode.environment` под Altera |
| 3. Роли сквада | Десять субагентов `.claude/agents/multica-*.md` по `operating-model.md` §1 |
| 4. Команды стадий | `.claude/commands/`: `multica-start`, `multica-stage`, `multica-status`, `multica-handback` |
| 5. Хук ритуала | `.claude/hooks/ritual-check.sh` на событие Stop |
| 6. Глобальный `autoMode` | Блок чужого проекта снят с `~/.claude/settings.json` |
| 7. `CLAUDE.md` | 232 → 161 строка; продуктовые рамки заменены иерархией источников |

### Разделение прав ролей

`multica-tester` и `multica-reviewer` намеренно лишены инструмента `Edit`, а ревьюер — и `Write`.
Это переводит правило operating-model §1 «независимый ревьюер не участвует в реализации той же
задачи» из декларации в ограничение инструментов: при одном агенте в одной сессии оно не
выполнимо по построению. `multica-orchestrator` не имеет права записи вовсе — его выход это
вердикт о готовности, а не изменение задачи.

### Снятие autoMode чужого проекта

Глобальный `~/.claude/settings.json` содержал `autoMode.environment`, описывающий проект
BILITY INVEST (`gitlab.bility.ru/bilinv/bilinv`, Laravel, защищённая ветка `main`, пути секретов
`backend/.env`). Блок применялся ко всем проектам, включая Altera, где защищённая ветка `app`,
remote — GitHub, а секреты в `server/.env`.

Блок снят. Сохранены две копии:

- `~/.claude/backups/settings.json.before-altera-harness-2026-09-09` — файл целиком до правки;
- `~/.claude/backups/automode-invest-project.json` — только снятый блок, для переноса владельцем
  в настройки проекта Invest.

Остальные ключи глобального файла (`permissions`, `hooks` trace-mcp, `enabledPlugins`,
`extraKnownMarketplaces`, `skipWorkflowUsageWarning`, `theme`) не тронуты.

## 2. Как проверено

```
$ node -e "JSON.parse(require('fs').readFileSync('.claude/settings.json','utf8'));console.log('ok')"
ok

$ git ls-files --others --exclude-standard .claude/
.claude/agents/multica-architect.md
… (10 файлов ролей)
.claude/commands/multica-handback.md
.claude/commands/multica-stage.md
.claude/commands/multica-start.md
.claude/commands/multica-status.md
.claude/hooks/ritual-check.sh
.claude/settings.json

$ git ls-files --others --ignored --exclude-standard .claude/
(пусто — версионируемая часть больше не игнорируется)

$ bash -n .claude/hooks/ritual-check.sh
синтаксис ок

$ echo '{"stop_hook_active":false}' | .claude/hooks/ritual-check.sh   # продуктовый код не менялся
exit=0

$ touch web/__ritual_probe.tmp
$ echo '{"stop_hook_active":false}' | .claude/hooks/ritual-check.sh
Ритуал проекта не завершён: продуктовый код изменён, план есть, парного отчёта нет.
Отсутствуют файлы:
  docs/reports/2026-09-09-agent-loop-harness-report.md
exit=2

$ echo '{"stop_hook_active":true}' | .claude/hooks/ritual-check.sh    # защита от зацикливания
exit=0

$ node -e "JSON.parse(require('fs').readFileSync(process.env.HOME+'/.claude/settings.json','utf8'))"
глобальный settings.json: валидный JSON
```

Хук проверен в обеих ветках: пропускает заход без правок продуктового кода и блокирует завершение
при правках без парного отчёта. Флаг `stop_hook_active` останавливает повторное срабатывание.

Проверка frontmatter всех десяти ролей (`name`, `description`, `tools`) — `ok` по каждому файлу.

## 3. Отклонения и то, что не прошло проверку

**`pnpm lint` и `pnpm format` падают, и это состояние преднайденное, а не следствие работы.**
Рабочее дерево `web/` и `server/` по `git status --porcelain -- web server` пусто — изменений
в продуктовом коде в этом заходе не было.

- `pnpm lint`: eslint обходит `web/.output/` — сборочный вывод, где сотни ошибок
  `no-unused-vars` в минифицированных чанках. Это ровно предмет задачи T-005 («`.output` вне линта»).
- `pnpm format`: четыре неотформатированных файла — `app/components/admin/header.vue`,
  `app/components/article/text.vue`, `app/layouts/admin.vue`, `app/pages/authors/index.vue`.

Следствие, ранее не зафиксированное: **pre-commit хук репозитория (`format && lint && test`) не
может пройти ни на одном коммите**, поэтому любой коммит здесь требует `--no-verify`. Это ещё один
неработающий контур проверки помимо пустого `pnpm test`. Отдельной задачей не оформлено — решение
владельца.

**`CLAUDE.md` сокращён до 161 строки, а не до рекомендованных ~50.** Дальнейшее сокращение
потребовало бы удалить раздел «Чего в проекте нет», а он сейчас точнее, чем
`docs/vision/00-reality-check.md` (тот стоит на срезе 2026-09-05 и ждёт ревизии T-109). Удалять
более актуальный текст в пользу отстающего — потеря. `[ДОПУЩЕНИЕ]`: после T-109 и T-111 раздел
можно свернуть в ссылку.

**Условие остановки стадии задано как `[ДОПУЩЕНИЕ]`.** В `operating-model.md` нет бюджета итераций:
описан останов по конфликту и по блокеру владельца, но не по исчерпанию попыток. В файлах ролей
записано «две подряд неуспешные попытки одной и той же проверки» с явной пометкой
`[ДОПУЩЕНИЕ, требует подтверждения владельца]`. Число выбрано агентом, в журнале его нет.
Требуется решение владельца: подтвердить, изменить или убрать.

**Коммит не создан.** Изменения оставлены в рабочем дереве: правка глобальных настроек и
`CLAUDE.md` затрагивает поведение всех будущих сессий, поэтому просмотр владельцем предшествует
фиксации. Push и слияние — решение владельца по operating-model §7.

## 4. Что это не меняет

Автономным цикл не стал. Шаг наблюдения по-прежнему слеп: `pnpm test` разворачивается в
`pnpm -r test`, ни `server`, ни `web` скрипт `test` не объявляют, CI маскирует старт сервера через
`timeout 2s pnpm start || true`. Пока T-001 и T-112 не закрыты, автопилот «Очередь разработки»
включать нельзя: чек-лист `docs/multica/autopilot-checklists.md` формально пройдёт, а цикл будет
подтверждать любой результат.

Единственная задача в статусе `готова` — T-108 (ADR-0047+), документная, продуктовый код не
меняет. Последний пункт чек-листа очереди требует начинать именно с такой.

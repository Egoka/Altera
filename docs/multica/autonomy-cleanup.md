# Безопасная очистка после подтверждённого завершения

`scripts/autonomy/cleanup.py` проверяет возможность удаления конкретного собственного worktree и его ветки.
По умолчанию выполняется dry-run. Отсутствующее, устаревшее или неоднозначное доказательство означает `skipped`.
Модуль использует только стандартную библиотеку Python и Git; `rm -rf`, `git clean` и принудительное удаление
worktree не используются.

## Входы и граница доверия

Receipt версии `schema_version: 1` содержит `task_id`, `tested_sha`, `worktree`, `branch`,
`pr.{number,head_sha,base_ref,base_sha,merge_sha,url}` и `finalization.{path,sha256}`.
Полный receipt контроллера может содержать дополнительные поля: они также входят в проверяемый хэш.
Хэш — SHA-256 от UTF-8 JSON с сортировкой ключей, без пробелов и без ASCII-экранирования Unicode.

Одного поля `Done` в тексте агента или receipt недостаточно. Доверенный адаптер контроллера проверяет
актуальные GitHub PR/CI, независимое ревью, deployment по политике и сохранённую финализацию задачи в Git-ветке `app`.
Затем его `read(receipt)` возвращает нормализованные данные:

```json
{
  "observed_at": 1789440000,
  "complete": true,
  "task": {
    "id": "task-id",
    "status": "done",
    "confirmed_done": true,
    "finalized_in_app": true,
    "receipt_sha256": "sha256-of-the-entire-receipt",
    "artifacts": [{ "id": "gitblob:full-git-blob-sha", "sha256": "report-sha256" }]
  },
  "pr": {
    "number": 123,
    "state": "MERGED",
    "head_sha": "full-git-sha",
    "base_ref": "app",
    "base_sha": "verified-pr-diff-base-sha",
    "merge_sha": "actual-merged-commit-sha",
    "url": "https://github.com/owner/repo/pull/123"
  },
  "runs": []
}
```

`observed_at` — Unix seconds фактического чтения внешнего состояния; возраст не больше 60 секунд.
`complete` означает полный список запусков, включая очередь и ожидающие approval, после обработки всех страниц API.
Нельзя подменять время сохранённого снимка временем чтения файла. Для активного постороннего запуска адаптер
передаёт `id`, `status`, `task_id`, `branch`, `worktree`; неполная связь с ресурсами блокирует очистку.
Связь с текущей задачей, веткой или вложенным путём блокирует очистку независимо от других полей.
Неизвестный статус также блокирует очистку.

Адаптер обязан сверять repository/remote и владельца ресурса, а не только номер PR, проверять сохранение
полного receipt вне удаляемого worktree и финального отчёта в `app`. Присваивать `confirmed_done` на основании свободного текста
агента запрещено. Поля выше являются результатом проверки адаптера, а не механизмом удостоверения произвольного JSON.

## Запуск

Снимок используется для проверяемого предварительного результата:

```bash
python3 scripts/autonomy/cleanup.py \
  --repo /absolute/path/to/repository \
  --owned-root /absolute/path/to/owned-worktrees \
  --receipt /absolute/path/to/receipt.json \
  --activity-json /absolute/path/to/fresh-activity.json \
  --log-dir /absolute/path/outside/worktrees/cleanup
```

CLI со снимком и `--apply` возвращает `skipped` с exit code 2: повторное чтение JSON не подтверждает живое состояние.
Фактическую очистку вызывает контроллер с живым адаптером:

```python
result = cleanup(
    repo,
    verified_receipt,
    live_evidence_provider,
    owned_root=owned_worktrees,
    log_dir=durable_cleanup_directory,
    apply=True,
)
```

Для `apply=True` требуются `provider.live = True`, `provider.read(receipt)` и context manager
`provider.guard(receipt)`. Guard держит запрет новых dispatch на задачу, ветку и путь на всё время очистки.
Эта блокировка должна соблюдаться всеми компонентами, способными поставить работу в очередь; если такую
гарантию невозможно дать, адаптер не предоставляет guard и удаление остаётся недоступным.
Повторное чтение само по себе не устраняет гонку с новым запуском.

## Проверки и действия

Сначала проверяются принадлежность пути настроенному `owned_root`, отсутствие symlink во всех компонентах
пути, запись worktree в Git и точное совпадение ветки/HEAD. Основной checkout, текущий checkout, checkout
вызывающего процесса, защищённые ветки `app`, `main`, `master`, `develop`, `dev` и чужие worktree сохраняются.
Заблокированные, prunable и submodule worktree требуют отдельного подтверждения и не удаляются.

Git status проверяет tracked, untracked и ignored файлы. `assume-unchanged` и `skip-worktree` блокируют очистку,
поскольку могут скрыть незаписанные изменения. Незакоммиченный отчёт или игнорируемые артефакты должны быть
разобраны отдельно. Модуль не удаляет их в обход защиты.

Для squash недостаточно ancestry. Сверяется полный binary diff от подтверждённой базы PR до проверенного head
с diff от первого родителя merge-коммита до самого merge-коммита. Сравнение включает полные blob SHA, режимы
файлов, пути и удаления. Сам merge-коммит должен присутствовать в `origin/app`; live адаптер подтверждает
его серверную принадлежность PR. Неоднозначная база, пустой diff, неподдерживаемая форма merge или расхождение
дают `skipped`. Это консервативная проверка: корректный squash с изменившейся базой тоже может потребовать
отдельного разбора вместо автоматического удаления.

Перед удалением берутся общий Git-lock `<git-common-dir>/autonomy-cleanup.lock` и dispatch guard, повторно
читаются живые доказательства, проверяются пути, файлы и ветки. После durable записи намерения выполняется
`git worktree remove` без force. Затем заново проверяются live evidence и обе ветки. Remote-ветка удаляется
с явным `--force-with-lease=<ref>:<expected-sha>`; локальная — `git update-ref -d <ref> <expected-sha>`.
Обе операции сравнивают ожидаемый SHA, поэтому новая версия ветки сохраняется. При изменении состояния после
первого действия результат будет `partial`, а оставшиеся действия остановятся.

Общая блокировка предотвращает конкуренцию экземпляров cleanup даже при разных каталогах журнала. Защита
рассчитана на соблюдающий guard контроллер и обычные Git-операции; произвольная конкурентная запись в файловую
систему сторонним процессом не является транзакцией с внешним API. Передача guard без реальной блокировки
делает интеграцию небезопасной.

В текущей интеграции не подтверждён запрет всех native/direct запусков Multica: старые агенты могут обходить
runtime wrapper. Поэтому живой apply-адаптер не подключён. До появления общей точки допуска запуска доступен
dry-run; снимок или дополнительный опрос API не считаются заменой dispatch guard.

Журнал `cleanup.jsonl` находится вне всех worktree. В нём сохраняются время, SHA receipt/evidence/финализации,
task/PR/head/merge/path/branch, намерение, выполненные действия и причина результата. Записи и каталог проходят
`fsync`; невозможность записать намерение блокирует удаление. Секреты и raw output внешних команд не сохраняются.
Полный receipt сохраняет контроллер вне удаляемого worktree, а отчёт остаётся в `app`.
`finalization.path` — относительный путь внутри `docs/reports/` без `..`. Модуль читает точные байты через
`git show origin/app:<path>`, проверяет SHA-256, наличие `task_id` и `tested_sha`, а затем сопоставляет Git blob SHA
с `task.artifacts[].id` в формате `gitblob:<sha>`. Проверка повторяется перед удалением и перед удалением веток.
Обновлять или принудительно сбрасывать локальную `app` не требуется; актуальность `origin/app` обеспечивает live адаптер.

## Runtime и daemon GC

Runtime-каталоги Multica не являются обычными собственными Git-worktree. Модуль возвращает для них
`runtime_gc.status = unsupported`: адаптер native GC здесь не настроен, ручного удаления runtime не происходит.

В upstream Multica предусмотрен daemon GC с `MULTICA_GC_ENABLED`, `MULTICA_GC_INTERVAL`, `MULTICA_GC_TTL`,
`MULTICA_GC_COMPLETED_TASK_TTL`, `MULTICA_GC_ORPHAN_TTL`, `MULTICA_GC_ARTIFACT_TTL`.
Версию установленного daemon и фактическую поддержку нужно сверять отдельно с
[исходником config.go](https://github.com/multica-ai/multica/blob/main/server/internal/daemon/config.go) и
[исходником gc.go](https://github.com/multica-ai/multica/blob/main/server/internal/daemon/gc.go).
Native GC опирается на terminal status, что само по себе не равно подтверждённому receipt контроллера.
До принудительного применения этой политики завершения native retention оставляется без изменений:
сокращать TTL для немедленной очистки небезопасно. Для инвентаризации применяют поддерживаемую установленной
версией команду `multica daemon disk-usage --all-profiles --output json`.

## Проверка

```bash
python3 -m unittest scripts/autonomy/test_cleanup.py
```

Тесты создают временные Git-репозитории и локальный bare remote. Они проверяют успешный squash, ошибочный diff,
изменения refs и файлов между чтениями, активные/queued runs, stale evidence, app artifact, текущий/main checkout,
symlink, untracked/ignored/скрытые индексом изменения, общий lock и отказ snapshot CLI от apply.
Внешний API заменён адаптером теста; это не проверка живой интеграции GitHub/Multica.

# Проверка runtime для автономии — 2026-09-13

**Вывод:** текущая конфигурация не обеспечивает запрета записи продуктового кода для тестировщика и ревьюера. Сегодня можно закончить контракты и проверить harness на синтетической задаче. Для честной автономии с технической границей нужен небольшой, но реальный runtime-слой: два протокольно совместимых wrapper-профиля, запускающих целиком Codex/Claude и их локальные MCP внутри ограниченного окружения. Это рекомендация к реализации, не результат выполненной интеграции. Агентов, контейнеры и внешние изменения в рамках этой проверки не запускали.

## Наблюдения и источники

1. Официальная [security model](https://multica.ai/docs/security-model) прямо исключает гарантию filesystem sandbox: процесс наследует права пользователя daemon. Стандартный Codex запускается с `danger-full-access`, Claude — с `bypassPermissions`; approval автоматизирован. Собственные HOME и credentials доступны процессу. Рекомендуемая граница — отдельный пользователь ОС, контейнер или VM. Run-scoped токен ограничивает идентичность в API, но не права на файлы.
2. [Daemon and runtimes](https://multica.ai/docs/daemon-runtimes): private runtime ограничивает возможность назначения агентов на компьютер. Custom profile поддерживает существующий протокол и executable wrapper. Аргументы профиля предшествуют аргументам Multica; конфликтующие значения Multica выигрывают, `--permission-mode` и другие протокольные флаги фильтруются. Для интеграции стабильны лишь `MULTICA_TOKEN`, `MULTICA_TASK_ID`, `MULTICA_AGENT_ID`, `MULTICA_WORKSPACE_ID`, `MULTICA_SERVER_URL`; TMP/config-root и daemon-port — нестабильные детали. Секреты передаются окружением, не текстом. Эти возможности дают точку подключения wrapper, но не готовую песочницу.
3. [Project resources](https://multica.ai/docs/project-resources): `local_directory` связан с daemon ID; `in_place` последовательно запускает задания в исходной папке. Daemon требует чтение/запись и сам создаёт служебные файлы. Это сериализация, а не разграничение прав ролей. Перенос всего daemon в новое окружение требует проверки/изменения привязки ресурса и поэтому шире минимального варианта.
4. [Docker bind mounts](https://docs.docker.com/engine/storage/bind-mounts/): bind mount по умолчанию writable; `readonly` запрещает запись через mount. Docker Desktop реализует mounts через Linux VM. Вложенные mounts требуют отдельной проверки; `RW: false` в inspect подтверждает настройку, но не заменяет отрицательную пробу.

Локальные источники: `docs/multica/snapshots/2026-09-13-before/{agents,runtimes,runtime-profiles,resources}.json`, все десять `mcp-*.json`, текущие `AGENTS.md`, `docs/multica/operating-model.md`, `docs/development/{artifact-contracts,project-rules,testing}.md`. Snapshot очищен от секретов; скрытые значения не читались.

Snapshot подтверждает:

- 10 существующих ролей, у всех `custom_args: []`, `max_concurrent_tasks: 1`, `permission_mode: private`; индивидуального MCP config нет, ключи runtime config пусты.
- Тестировщик `5f18f628-67ca-491c-80ae-85ffed2c6687`: Codex, `gpt-5.6-terra`, medium, service tier default; MCP context7 и playwright.
- Независимый ревьюер `db94a617-807c-4eec-981f-51fd4b3217d4`: Claude, `claude-opus-4-6`, medium; MCP context7.
- Custom runtime profiles: `[]`. Три встроенных runtime онлайн, все private, один desktop daemon `019f94d8-3dd7-7cf8-bdfc-0f8e52e01687`, CLI v0.4.43.
- Ресурс `26db43db-cb46-4e1e-8aeb-2d5335cd3a86`: исходная папка `/Users/egorbondarenko/WebstormProjects/Altera`, тот же daemon, `in_place`.

Read-only CLI help проверен у bundled executable `/Applications/Multica.app/Contents/Resources/app.asar.unpacked/resources/bin/multica`: `runtime profile create` принимает command-name/protocol-family/display-name; `set-path` задаёт абсолютный executable; `agent update` поддерживает runtime-id, custom-args и runtime-config. Его `--permission-mode` явно называется **invocation permission mode** и принимает private/public_to, не filesystem policy. Новая runtime-привязка позволяет сохранить agent ID, роль, модель и остальные настройки. Реальная регистрация профиля не проверялась.

## Минимальный вариант реализации

Это инженерный вывод из доступных точек расширения, а не обещанная Multica готовая функция.

1. Сохранить существующий daemon и `in_place` ресурс. Добавить по одному wrapper-профилю семейства Codex и Claude. Перепривязать только тестировщика и ревьюера; сохранять их ID, роли, модели, effort, MCP-набор и лимит конкурентности. До smoke test текущий runtime не заменять автоматически.
2. Wrapper запускает **сам AI coding tool**, shell и все локальные MCP-процессы внутри контейнера; сохраняет ожидаемые app-server/stream-json stdin/stdout, сигналы и exit status. Host-wrapper не исполняет переданные агентом shell-фрагменты и не предоставляет универсальный host-command bridge.
3. Исходная папка продукта, `.git`, инструкции и snapshot входного evidence — RO. Отдельные точные RW mounts: новый evidence этого run, новые тесты (только тестировщик), cache/build/temp. Не выдавать всему `server/`, `web/` или `docs/` RW ради вложенного отчёта. Внешний trusted collector переносит артефакты из staging в разрешённые пути, если нужна запись evidence в репозиторий. Проверяющий не меняет уже принятое evidence другого run.
4. Не монтировать Docker socket, персональный HOME или исходный репозиторий вторым writable путём. Убрать capabilities для remount/escape; исключить host API/MCP endpoints с возможностью менять продукт или запускать host shell. Сам token/API не считать filesystem границей: доступ к daemon RPC, checkout и другим операциям от имени host нужно отдельно ограничить. Инструменты браузера тоже не должны давать произвольную запись через unrestricted host MCP.
5. Оставить только необходимые каналы модели и Multica. Авторизация существующей подписки в Linux-контейнере, доступность тех же моделей и path mapping managed config — конкретные проверки перед запуском; не переносить секреты в репозиторий и не считать подписку автоматически доступной контейнеру. Если нужен отдельный login/доступ, это именованный blocker, а не основание подменить модель или купить API.

Такое решение ограничивает процессы двух ролей относительно product tree. Оно не изолирует оставшийся host daemon, разработчика, release credentials или всю машину. Установка одного контейнера для тестовой команды при агенте вне него ничего не меняет в полномочиях самого агента. Общий writable контейнер для всех ролей также не различает writer и reviewer.

## Trace MCP — отдельная готовность

Во всех десяти Multica assignment snapshots trace отсутствует. Это доказывает отсутствие назначенного workspace MCP, но не исключает локальную наследуемую конфигурацию tool. Наличие trace в текущей сессии Codex не доказывает его наличие внутри Multica run.

`AGENTS.md` требует trace первым при исследовании кода, включая `get_project_map(summary_only=true)`. Поэтому до автономной кодовой задачи реальный runtime должен показать успешный вызов project map и outline для **того самого checkout/revision**, который проверяется. При недоступности trace стадия blocked; молчаливый fallback на grep/cat нарушает действующее правило. Нужен trace внутри границы или сервер с проверенной RO-поверхностью, отдельным writable индексом/cache и без host-write обхода. Не выдавать все мутационные trace tools только ради чтения кода. Это не решается добавлением одной фразы в prompt.

## Безопасная отрицательная проверка

Сначала synthetic fixture, без реального product tree, credentials и агентов: RO product с безвредными canary-файлами, отдельные разрешённые RW каталоги, зафиксированные хэши. Через **тот же wrapper, образ и policy**, которыми будут пользоваться роли, выполнить явные попытки:

- overwrite/create/delete/rename в product, `.git` и каталоге управления runtime — должны получить OS-level отказ;
- запись через symlink и альтернативный путь к canary — отказ; RO режим и отсутствие второго writable mount подтверждены;
- запись нового evidence — успех; тестировщик может создать новый тест; reviewer не может менять product/test inputs/evidence предыдущего run;
- shell и каждый доступный MCP не дают альтернативный host-write маршрут; Docker socket и host-exec bridge недоступны;
- deterministic runner завершает проверку ненулевым кодом при любой неожиданно успешной записи и сохраняет errno, команды, hashes, inspect, образ/версию/policy fingerprint. Агентский отказ «я не стану» не является отрицательным тестом.

Потом отдельный реальный canary-run для каждого семейства на этом безопасном fixture: проверить протокол, логин/модель, project map/outline, запись evidence и shell denial. В trace связываются agent/run ID, source revision, commands/results и конфигурация. Лишь успешный интеграционный run позволяет заявить готовность профиля. Перед продуктовой задачей входной SHA + dirty fingerprint проверяются заново; `in_place` lock не мешает пользователю или внешнему процессу менять дерево, поэтому изменение fingerprint аннулирует evidence.

Harness unit tests доказывают парсинг контрактов, порядок стадий, retry/stop и отказ принять отсутствующее evidence. Mocked permission-denied доказывает только обработку ответа. Успех plain Docker probe доказывает только его mounts. Ни то ни другое отдельно не доказывает защиту реальных Multica Codex/Claude/MCP процессов.

## Рекомендация и блокеры сегодня

Закончить C0/desired diff/контракты и deterministic harness; маркировать runtime enforcement `not_run`, пока не выполнены обе реальные интеграционные пробы. Реализовать два wrapper-профиля как следующий небольшой блок, сохраняя roster/models/in_place. Не объявлять M4 завершённым на основе инструкций, private или более строгого custom config: стандартный daemon не даёт для этого гарантии.

Неразрешённые факты: наличие подходящего образа с совместимыми CLI и существующей авторизацией; корректность app-server/stream-json/path mapping; trace в целевом runtime; отсутствие host-mediated write через MCP/RPC; фактические OS denials; после этого — реальная цепочка developer → tester → reviewer на одной ревизии. Docker 29.4.3 running и bundled CLI v0.4.43 переданы координатором; Docker сам здесь не опрашивался и контейнеры не запускались.

## Контракт двух wrapper — входы для реализации

| Вход/ресурс | Codex wrapper | Claude wrapper | Правило |
| --- | --- | --- | --- |
| Протокол | `codex app-server` | Claude `stream-json` | Передавать stdin/stdout без баннеров, stderr отдельно; проверять сигналы и завершение |
| Выбор модели | `gpt-5.6-terra`, medium, default | `claude-opus-4-6`, medium | Остаётся в конфигурации существующего агента; wrapper не подменяет |
| Рабочая папка | Абсолютный исходный cwd | Абсолютный исходный cwd | Bind RO в тот же абсолютный путь уменьшает переписывание протокольных paths; не угадывать cwd по имени задачи |
| Managed state | Run-scoped `CODEX_HOME`; `config.toml`, skills, необходимые session-файлы | Managed MCP/settings/skills paths из фактического запуска | Не монтировать родительский персональный HOME целиком; точно перечислить необходимые пути из очищенного execution manifest |
| Credentials модели | Только штатно подготовленная авторизация Codex в отдельном runtime home | Только штатно подготовленная авторизация Claude в отдельном runtime home | macOS keychain/login не считать переносимым в Linux; не читать значения при discovery |
| Multica | Пять integration-contract переменных | Те же | Передавать окружением через процесс; не логировать token; не доверять произвольным extra mounts из env |
| MCP | context7 + playwright + trace после отдельной настройки | context7 + trace после отдельной настройки | Stdio-серверы запускаются внутри; ссылки на host absolute executable требуют Linux-замены в managed runtime config |
| Temp/cache | Собственные runtime/cache/build/tmp | Собственные runtime/cache/tmp | Свежие каталоги задачи, RW, не общий продукт; применять явные пути для TMPDIR/TMP/TEMP |
| Выход | Только текущий evidence staging и новые тесты | Только текущий evidence staging | Source, test inputs, предыдущий evidence, policy и wrapper остаются RO |

**Точные managed auth/MCP пути пока неизвестны.** Snapshot намеренно скрывает значения, а официальная документация не обещает стабильных имён для task roots. Их нельзя заполнить предположением `~/.claude` или пробросом всего `~/.codex`. До написания wrappers собрать безопасный manifest actual launch: argv с секретами удалёнными, названия env без секретных значений, абсолютные пути generated config/skills/auth references и их роли. Это discovery, не чтение содержимого credentials. Для Codex daemon может передать новые cwd через app-server RPC; wrapper обязан разрешать только объявленный product root. Поддержка `--help`/`--version` при регистрации профиля также должна работать без запуска модели.

У Codex managed config содержит потенциально host-specific MCP commands/paths. У Claude MCP config может быть файлом, переданным в argv. Их нельзя просто проигнорировать: тогда роли потеряют инструменты; нельзя просто открыть весь host: тогда граница исчезнет. Нужен небольшой mapper известных task paths и Linux-совместимых MCP executables. Протокольный поток и фактический source path проверяются на canary.

**Git:** при `in_place` текущий основной checkout может иметь обычный `.git` каталог. Для acceptance из worktree `.git` — файл-указатель на отдельные gitdir/common-dir. Перед запуском получить `git rev-parse --show-toplevel --absolute-git-dir --git-common-dir` и создать manifest; отсутствующие отдельные git paths либо RO-монтировать точечно, либо сделать самостоятельный clone. Не давать RW на общий `.git` или родительский каталог ради `git diff`: это открывает branch/index/hooks/object writes. Тестировщик и reviewer не выполняют `git commit`; сборка и trace cache пишутся вне RO checkout. Канонический product path, symlink realpath и разрешённые mounts сверяются wrapper, а не выбираются агентом.

**Что осуществимо без владельца сегодня:** написать и локально проверить wrappers на fixture и fake protocol executables, подготовить manifest schema и профильный diff, подготовить Linux image, выполнить read-only discovery версий и paths, если это входит в scope следующего блока. Из этого не следует, что реальная модель запустится. **Когда нужен ввод владельца:** только если штатный login существующей подписки в новом runtime требует интерактивного пользователя/недоступного credential механизма. Это конкретный результат auth preflight; до его получения просьба «разрешите всю настройку» преждевременна. Новые платные credentials, услуги и незаявленная смена модели не являются fallback.

## Альтернативы и пределы приёмки

- **Самостоятельный disposable clone для приёмки:** маленький отдельный checkout без gitdir-ссылок на оригинал, с зафиксированными SHA и воспроизведённым dirty diff при необходимости. Монтировать его RO в те же ограниченные runtimes; evidence/cache — отдельно. Это позволяет проверить интеграцию и конкретную ревизию, не касаясь исходной папки. Сам clone/worktree без process/container/OS boundary не запрещает агенту абсолютным путём записать оригинал. Такая приёмка не доказывает, что существующие Multica assignments уже защищены, и не переключает постоянный `in_place` ресурс.
- **Постоянный daemon в контейнере / под отдельным OS user:** правильное более широкое ограничение доступа к персональной машине. Но один общий daemon с RW доступом всех ролей к продукту не даёт разделения reviewer/writer. Понадобятся отдельные права/процессы и привязка local_directory к нужному daemon, логин и routing. Это больший отдельный переход, не обязательная предпосылка минимальной проверки двух ролей и не повод молча менять ресурс сегодня.

Предпочтение: сначала два wrapper и clone/fixture acceptance; затем проверить оба существующих agent ID на тех же wrappers с сохранённым `in_place` resource. Постоянную миграцию всего daemon не смешивать с доказательством запрета product writes двух verification-ролей.

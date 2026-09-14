# Настройка инфраструктурного доступа Multica — 2026-09-15

Исходный `origin/app`: `563e909819348127f71a54bd2c0fbaae35d6f7d9`.
Рабочая ветка: `codex/multica-infra-access`. Изменения относятся к документации и конфигурации
агентов; backend/shared build inputs не меняются. Для этого diff обязательный release deploy
`not_applicable`; наблюдение прежнего deploy не выдаётся за выкладку этой ветки.

## Применено

- Release engineer и Tester: Render MCP `render`, OAuth client ID `codex`, allowlist 10 чтений.
- Orchestrator и Reviewer: `plugin:render:render`, OAuth client ID `claude`, запрет всех 11
  недиагностических Render tools из проверенного inventory; доступны 11 чтений.
- Четыре idle-профиля получили общий self-contained prefix. Прежние инструкции, workspace
  assignment `context7`, custom_env, модели, runtime и ограничения параллельности сохранены.
  Старые custom_args Claude сохранены и дополнены запретами инструментов.
- Остальные шесть профилей не менялись; их запросы к инфраструктуре направляются релиз-инженеру.
  Multica task/run, очередь, расписания, старые паспорта и daemon не запускались и не перезапускались.

[profiles.json](profiles.json) содержит readback и хэши, без токенов и полных профилей.
`before_*` означает состояние перед последним сравнением/применением: при идемпотентном повторе
оно уже может совпадать с `after_*`. Сохранение прежнего unmanaged текста проверялось отдельно.
Проверка custom_env вывела только имена ключей (`PATH`), не значения.
Пути native binary сверены с daemon; отсутствие `codex` в PATH не препятствует его абсолютному запуску.

## Реальные проверки

| Проверка          | Наблюдение                                                                                                                                                  | Evidence                                           |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------- |
| GitHub CLI        | PR #36 merged, head и merge SHA различаются и связаны; aggregate test и четыре prerequisite jobs SUCCESS                                                    | [github.json](github.json)                         |
| Render deploy     | `dep-dak7bomk1f9s73c6dsbg`, точный `563e909…`, Live; checkout/build/start подтверждены ограниченным окном логов                                             | [infrastructure.json](infrastructure.json)         |
| Render metrics/KV | Память Server и CPU/память/connections KV доступны; пустые CPU/HTTP series Server обозначены no_data                                                        | [infrastructure.json](infrastructure.json)         |
| HTTP              | POST GraphQL `__typename`: 200, Query, без errors, 0.509s; сам ответ не содержит commit SHA                                                                 | [infrastructure.json](infrastructure.json)         |
| Neon CLI          | Endpoint `ep-dry-boat-ad0thetj` относится к development `br-ancient-mode-adgmr3w1`; idle, direct host ожидаемый                                             | [neon.json](neon.json)                             |
| Native Claude     | Реальный managed config с alias и ограничениями: inventory 11 чтений; list_workspaces/get_deploy успешны                                                    | [claude.json](claude.json)                         |
| Native Codex      | В отдельном CODEX_HOME с публичным config первоначальные чтения проходили; в 23:11 UTC повтор вернул unauthorized при inventory 10 tools и authStatus=oAuth | [codex-unauthorized.json](codex-unauthorized.json) |

Время в JSON — UTC; дата каталога — Europe/Moscow. Это ограниченный срез, не бессрочное PASS.
Метаданные [обязательного workflow run](github-run.json) подтверждают `headSha`, `attempt=1`,
workflow `Checks` и success; его SHA совпадает с head PR #36, не с merge commit.
В Claude snapshot сохранены очищенные поля фактических tool responses, а не только ответ модели.
Claude проверен с временной settings-копией `disableAllHooks=true`, выключенными builtin tools,
двумя разрешёнными metadata-вызовами и пределом 6 turns. Рабочий Stop plugin не отключался.
Codex проверен через native app-server JSON-RPC без model turn; credentials не копировались.
Это проверка native бинарников и эквивалентного managed config, **не server-issued Multica run**.

## Остаток и ограничения

- **Codex blocked_access:** требуется штатное восстановление OAuth и повтор bounded read.
  Попытка Allow остановлена автоматической проверкой: Render выдаёт OpenAI права аккаунта
  во всех доступных workspace. Отдельное разрешение владельца запрошено; callback истёк без выдачи доступа.
  Claude работает через свою существующую авторизацию; перенос его токена не выполняется.
- SQL из Render Server и Redis PING/cache-сценарий: `not_run`. Metadata Neon, KV available,
  connection count, отсутствие ENOTFOUND в 49 строках старта и `__typename` их не доказывают.
- Сверка live deploy после HTTP через Codex упёрлась в unauthorized; корреляция health с SHA
  неполная. При следующей проверке повторить deploy-before → HTTP → deploy-after.
- Settings Claude материализованы в основной checkout после review файла и сверки его
  исходного хэша. [local-settings.json](local-settings.json) подтверждает точный новый хэш,
  неизменность detached HEAD `467bde7…` и отслеживаемого пользовательского diff.
  Остальные файлы и рабочий plugin не изменялись.
- Клиентские фильтры не сужают права аккаунта Render. Denylist Claude ограничен текущим inventory;
  после обновления MCP новые недиагностические tools надо закрыть до использования.

Новые deploy/restart, env update, миграции, тарифы, Redis/Neon данные и default branch не менялись.
Старые Done/ALTE-11/T-native задачи не принимались повторно и не размораживались.

## Проверка договора выпуска

В [infrastructure-checks](../../infrastructure-checks.md) разобраны 11 контрольных ситуаций:
старый CI/head, старый Live, build без Live, задержка deploy, cancellation/replacement,
superseded SHA, deadline/repeated error, 401/403, ошибочный HTTP body, непроверенные DB/Redis,
пустые метрики. Это документированный контроль правил, не искусственно вызванные инциденты.
Локально прошли `pnpm format`, `pnpm lint`, `pnpm test` (20 server + 59 web; 1 прежний TODO),
Prettier для изменённых docs/config, `git diff --check`, JSON/readback/tool-filter и CI head/attempt
проверки. После установки с `--ignore-scripts` тесты сначала остановились из-за отсутствующих
Nuxt types; выполнен штатный `nuxt prepare`. Затем sandbox запретил локальный listen EPERM;
повтор вне sandbox прошёл. Product source для этих условий не менялся.

Независимое review draft не выявило блокирующих ошибок; замечания о сырых metadata evidence
устранены. Merge разрешён только после зелёного CI и review точного head. CI этой ветки и
итоговое review фиксируются в её PR, отдельно от PR #36.

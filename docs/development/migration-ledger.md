# Migration ledger: правила Agent Loop

- **Дата среза**: 2026-09-13.
- **Baseline**: `2e542a0774a2fae7c38e7f19e7255ebf6a673ed3`, исходное дерево clean.
- **Назначение**: lossless-карта старое → новое для M0–M3; это не доказательство runtime
  enforcement M4.
- **Исходное объяснение**: [S0](sources/2026-09-13-agent-loop-original.txt), 45 188 байт,
  SHA-256 `603957e9618f58680359d8fe1b87818164d91e1127bc2d886c085d35c9b07f60`.
- **Старый CLAUDE**: [полная неизменённая копия](sources/2026-09-13-claude-original.md),
  12 668 байт, SHA-256 `b949b87ba4d8f183b3fab783abd4207cdd0fb09f40f70571b7122880682cf71c`.

Статус `перенесено` означает, что правило осталось активным в новом каноническом месте.
`Сохранено` означает, что действующий источник остаётся каноническим. `Назначено` означает,
что требование сохранено и имеет будущий этап, но не заявляется реализованным.

## R01–R45

| ID  | Старое место | Новое каноническое место                                                   | Статус                                               |
| --- | ------------ | -------------------------------------------------------------------------- | ---------------------------------------------------- |
| R01 | S0 §1        | `agent-loop-architecture.md` A1/A3; `operating-model.md` §3                | сохранено, контракт M2 принят                        |
| R02 | S0 §1        | `requirements-and-preservation.md` R02; `agent-loop-architecture.md` A2/A3 | сохранено как объяснение, без выдуманного API        |
| R03 | S0 §1        | `agent-loop-architecture.md` A3/A7; `artifact-contracts.md` §3–§4          | контракт сохранён; enforcement назначен M4           |
| R04 | S0 §1        | `agent-loop-architecture.md` A3/A9; `artifact-contracts.md` §5             | назначено M8, единицы не выдуманы                    |
| R05 | S0 §2        | `agent-loop-architecture.md` A2; `project-rules.md`                        | перенесено                                           |
| R06 | S0 §2        | `agent-loop-architecture.md` A2/A7; `artifact-contracts.md` §2             | контракт сохранён; runtime-проверка назначена M4     |
| R07 | S0 §2        | `agent-loop-architecture.md` A2; trace-routing в `AGENTS.md`               | сохранено; возможности runner не предполагаются      |
| R08 | S0 §2        | `agent-loop-architecture.md` A3/A5; `AGENTS.md`                            | перенесено                                           |
| R09 | S0 §3        | `agent-loop-architecture.md` A4; `artifact-contracts.md` §3                | контракт M3 принят                                   |
| R10 | S0 §3/§9     | `agent-loop-architecture.md` A4/A7; `artifact-contracts.md` §3             | persistent failures сохранены; enforcement M4        |
| R11 | S0 §4        | `AGENTS.md` trace-routing; `testing.md`; `project-rules.md`                | перенесено M1                                        |
| R12 | S0 §4        | `agent-loop-architecture.md` A4/A6                                         | назначено M5                                         |
| R13 | S0 §4        | `agent-loop-architecture.md` A4; task/plan contracts                       | сохранено; пилот назначен M7                         |
| R14 | S0 §4        | `agent-loop-architecture.md` A4/A6                                         | сохранено как примеры; реальные границы назначены M7 |
| R15 | S0 §4        | `agent-loop-architecture.md` A6; `testing.md`                              | сохранено; browser/e2e назначены M5                  |
| R16 | S0 §4/§5     | `artifact-contracts.md` §2/§4; report contract                             | перенесено M3                                        |
| R17 | S0 §5        | `operating-model.md` §3; task/plan/report и commands                       | перенесено M2/M3                                     |
| R18 | S0 §5        | `artifact-contracts.md` §4                                                 | сохранено; независимая проба назначена M7            |
| R19 | S0 §5        | task/plan contracts; `agent-loop-architecture.md` A4/A6                    | сохранено; negative check M5                         |
| R20 | S0 §5        | `operating-model.md` §5; `artifact-contracts.md` §3                        | сохранено; runner budgets M4                         |
| R21 | S0 §6        | `agent-loop-architecture.md` A5; handoff contracts                         | перенесено M3                                        |
| R22 | S0 §6        | `AGENTS.md` trace-routing; `agent-loop-architecture.md` A5                 | перенесено M1                                        |
| R23 | S0 §6        | `artifact-contracts.md` §3; task/plan/report handoff                       | перенесено M3                                        |
| R24 | S0 §6        | `artifact-contracts.md` §2–§4; report contract                             | перенесено M3                                        |
| R25 | S0 §7        | `agent-loop-architecture.md` A2; `AGENTS.md`                               | сохранено; механизм не смешан с инструкцией          |
| R26 | S0 §7        | короткие `AGENTS.md`/`CLAUDE.md`; `project-rules.md`                       | перенесено M1; trace-блок дословный                  |
| R27 | S0 §7        | `project-rules.md`; role runtime-gap notes                                 | сохранено; enforcement назначен M4                   |
| R28 | S0 §8        | `operating-model.md` §3; commands                                          | перенесено M2                                        |
| R29 | S0 §8/§12    | task/plan authorization и scope; `operating-model.md` §2                   | перенесено M2                                        |
| R30 | S0 §8        | `artifact-contracts.md` §4; reviewer role                                  | сохранено; независимая проба M7                      |
| R31 | S0 §8        | `operating-model.md` §5; task parallelism                                  | сохранено; mutex probe M4                            |
| R32 | S0 §9        | task preserved contract; `agent-loop-architecture.md` A4/A6                | сохранено; negative check M5                         |
| R33 | S0 §9        | handoff reason taxonomy in contracts/command                               | перенесено M3                                        |
| R34 | S0 §9        | task scope/preserved contract; `project-rules.md`                          | перенесено M2                                        |
| R35 | S0 §9        | `operating-model.md` §5; persistent `check_id` count                       | перенесено; enforcement M4                           |
| R36 | S0 §9        | `agent-loop-architecture.md` A7                                            | сохранено; negative check M4                         |
| R37 | S0 §9/§12    | `agent-loop-architecture.md` A7; `project-rules.md`                        | сохранено; permissions audit M4                      |
| R38 | S0 §10       | `agent-loop-architecture.md` A9; `artifact-contracts.md` §5                | назначено M8                                         |
| R39 | S0 §10       | evidence/trace_ref contracts; report history                               | перенесено M3; series eval M8                        |
| R40 | S0 §10       | `artifact-contracts.md` §5                                                 | назначено M8, неизвестные расходы не равны нулю      |
| R41 | S0 §10       | `agent-loop-architecture.md` A9                                            | назначено M8                                         |
| R42 | S0 §11       | `AGENTS.md`, `project-rules.md`, `testing.md`, contracts                   | перенесено M1                                        |
| R43 | S0 §11       | `agent-loop-architecture.md` A6/A7                                         | сохранено; executable negative check M5              |
| R44 | S0 §12       | report contract и `artifact-contracts.md` §4                               | перенесено M3                                        |
| R45 | S0 §12       | task authorization/scope; `operating-model.md` §7                          | сохранено; пилот M7                                  |

## Уникальные правила репозитория

Хэши относятся к содержимому до правок этой миграции. Строки перечисляют каждый обязательный
источник M0; подробные тексты ролей остаются на месте, а не заменяются общим пересказом.

| Старый источник и SHA-256            | Уникальное правило                                               | Новое место / статус                                                                   |
| ------------------------------------ | ---------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| `CLAUDE.md` `b949…71c`               | иерархия журнала/spec/ADR/vision                                 | `project-rules.md`; перенесено                                                         |
| `CLAUDE.md` `b949…71c`               | operating model, ready, автопилоты                               | `operating-model.md`, `backlog/README.md`; ссылки из адаптера                          |
| `CLAUDE.md` `b949…71c`               | структура server/web, env names, серверные и веб-соглашения      | `project-rules.md`; перенесено, facts требуют свежей сверки                            |
| `CLAUDE.md` `b949…71c`               | команды, Prettier, build side effect, pre-commit                 | `project-rules.md`, `testing.md`; перенесено и датировано                              |
| `CLAUDE.md` `b949…71c`               | планы/отчёты, Git, язык, spec rules, секреты                     | `project-rules.md`, plan/report contracts; перенесено                                  |
| `CLAUDE.md:46` `b949…71c`            | `.claude/settings.local.json` — личный неверсионируемый override | `project-rules.md` § «Источники требований»; активно сохранено, файл не версионируется |
| `CLAUDE.md:142` `b949…71c`           | repo `docs/plans/` и `docs/reports/` перекрывают defaults skills | `project-rules.md` § «План, отчёт и evidence»; сохранено с явным приоритетом           |
| `CLAUDE.md` `b949…71c`               | старые пробелы реализации, включая «нет тестов»                  | неизменённый source; историческое, актуальный test fact в `testing.md`                 |
| `operating-model.md` `d241…a39`      | десять ролей и их границы                                        | §1 сохранён без переписывания                                                          |
| `operating-model.md` `d241…a39`      | источники, стадии/evidence, ready                                | §§2–4 сохранены и дополнены authorization/revision/AC-ID                               |
| `operating-model.md` `d241…a39`      | один writer, duplicate stop, два неуспеха, recovery/conflict     | §5 сохранён; persistent `check_id` и handoff добавлены                                 |
| `operating-model.md` `d241…a39`      | три paused autopilot, их read/write/never                        | §6 сохранён; конфликт области контекста остаётся открытым C1                           |
| `operating-model.md` `d241…a39`      | §7 решения владельца и автономия push/merge/deploy с условиями   | §7 сохранён; release role исправлен по источнику                                       |
| `operating-model.md` `d241…a39`      | датированная актуализация контекста                              | §8 сохранён; M4 caveat добавлен                                                        |
| `backlog/README.md` `2128…5de`       | T/E/Q/F, статусы, ready owner, источники, regen, 112 задач       | сохранено; test fact датирован без смены статусов                                      |
| `multica-architect.md` `1d4e…3ec`    | техплан, named migrations, не реализует и не придумывает числа   | роль сохранена целиком                                                                 |
| `multica-designer.md` `c9ea…9e1`     | все UI-состояния, ru/en length, одна палитра, не меняет access   | роль сохранена целиком                                                                 |
| `multica-developer.md` `55e5…200`    | единственный product writer, plan/report, named migration        | сохранено; только test fact заменён ссылкой на срез                                    |
| `multica-docs-keeper.md` `a9bf…a1d`  | статус/matrix/current state, ADR status-only, не ставит ready    | роль сохранена целиком                                                                 |
| `multica-editor.md` `6d10…eb1`       | обе локали, no AI thresholds/legal copy/prices                   | роль сохранена целиком                                                                 |
| `multica-orchestrator.md` `f22e…0a5` | пять ready checks, one writer, no scope/task creation            | роль сохранена целиком; direct mandate живёт в operating model                         |
| `multica-release.md` `8129…f83`      | CI/migrations/backups/health, review before deploy, secrets      | сохранено; stale CI/test и §7 wording исправлены                                       |
| `multica-reviewer.md` `df4a…d94`     | source/scope/evidence review, verdict, no implementation         | сохранено; Bash write gap назван до M4                                                 |
| `multica-seo.md` `8af6…231`          | technical SEO, no ranking/external analytics                     | роль сохранена целиком                                                                 |
| `multica-tester.md` `38c1…1cf`       | per-criterion evidence, no fixing/softening checks               | сохранено; test fact и Write/Bash gap уточнены                                         |
| `multica-start.md` `e3f2…426`        | readiness/one-writer gate, no implementation                     | требует artifact contracts §1–§4 целиком; отсутствующее явно `not_yet_applicable`      |
| `multica-stage.md` `c99d…1bb`        | previous evidence, role mapping, independent review              | требует artifact contracts §1–§4 целиком; failures и handoff не теряются               |
| `multica-status.md` `e9ef…803`       | ready/work/chain/ritual/blocker status, read-only                | требует artifact contracts §1–§4 целиком; показывает prior state/resume                |
| `multica-handback.md` `63cc…1bb`     | owner question, stop and recovery state                          | требует artifact contracts §1–§4 целиком; полный handoff и persistent failures         |
| user `trace-block.md` `6576…878`     | trace-mcp routing и `get_project_map(summary_only=true)`         | дословно встроено в `AGENTS.md`; сохранено                                             |
| Multica audit                        | IDs, 10 agents, 32 skills, squad, 3 schedules, `in_place`        | `docs/multica/2026-09-13-configuration-audit.md`; factual snapshot, не правит runtime  |

## Зафиксированные противоречия и решения M0–M3

| Противоречие                                                                                                | Решение этого этапа                                                                        |
| ----------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| CLAUDE и три локальные роли утверждали «тестов нет»                                                         | старый текст сохранён; `testing.md` фиксирует 24 passed на baseline; адаптеры обновлены    |
| CLAUDE/release утверждали, что CI маскирует старт                                                           | датировано как история; текущий workflow запускает немаскированный `pnpm run smoke`        |
| Заголовок backlog говорил «ни одна не ready», таблица и current state — 7 ready, включая T-110              | статусы не менялись; заголовок остаётся датированным источником, current test fact уточнён |
| T-110 в repo `готова`, а ALTE-4 в аудите Multica — In Review                                                | оба факта сохранены; синхронизация и acceptance относятся к C1/C6, не угадываются здесь    |
| Контекст-автопилот: operating model разрешает backlog overview, Multica audit наблюдает project description | конфликт сохранён; одну область должен определить C1 до включения                          |
| Reviewer/tester prompt запрещает правку, но Bash/Write могут писать                                         | gap указан в ролях и правилах; технический запрет относится к M4                           |
| `permission_mode=private` в Multica                                                                         | означает право вызова, не файловый sandbox; filesystem enforcement не подтверждён          |

## SHA-256 локальных источников до миграции

```text
b949b87ba4d8f183b3fab783abd4207cdd0fb09f40f70571b7122880682cf71c  CLAUDE.md
d2417609a5ae1dac133b06cf6342d720ec5daee05619948d8c8db60d57b64a39  docs/multica/operating-model.md
2128a9b441ce926dde6e3d39bde27260afef52c22449df3ff4f891186b5956de  docs/backlog/README.md
1d4efab45e275a1e8bdd8d6dcfe9eafa1199c9d96de96bdbb0b152632b12c3ec  .claude/agents/multica-architect.md
c9ead3e02bac22eaefb3558123932cf3781c2d8c1a71b7b6b39d95dae7c09e1d  .claude/agents/multica-designer.md
55e571374477059269c69346ad4a5cccd8f32d477c79845e831909e86e432200  .claude/agents/multica-developer.md
a9bf9eac255c41491cbdb2f110243bc36fcd363322398fbfafcce0ee3bcf2a1d  .claude/agents/multica-docs-keeper.md
6d10de9066d875bf4cbf74ac1115b37815ba906595b60d1d2dd1978fde62ceb1  .claude/agents/multica-editor.md
f22e5768289c90344aadb29487cc202595267b421f65e1acb40f4f373e0702a5  .claude/agents/multica-orchestrator.md
81294a62a41165163212b1ce6f310bbc883139b00d88445cb8656420fef4ad83  .claude/agents/multica-release.md
df4a56ddf2665384802f70ec26b56dc57cfab5f211901b0d64a970ae61c59d94  .claude/agents/multica-reviewer.md
8af6ea530cd334cf202ffe58bc4dc9665d0a400b9f234503d4eecfd4f606d623  .claude/agents/multica-seo.md
38c1a8cc0f81961ae969c35568326d9295acfa37eb992336aad2d4ae6e4e51cf  .claude/agents/multica-tester.md
63cc92c69af54423cb1ede9acf2892485bc24edf7604c134198cb6341935d1be  .claude/commands/multica-handback.md
c99deac6c3f111a8fb6776f0c17b25129589cbda63af8a6a0a7dca2bcb30f1bb  .claude/commands/multica-stage.md
e3f2ddc72d338432261788c81151b68aebe5d6ebcbf905729c7d21eca0e61426  .claude/commands/multica-start.md
e9ef9971543b0848b399cb0563cac1e5a4d06497b33fe567529a05b65de54803  .claude/commands/multica-status.md
38f6d6ef43da23c211f2f90bf9994e315261979d8fdd5f64914645ac5b0fd099  docs/development/requirements-and-preservation.md
2a10c9bd7e7785ebc6316ec35735e1c36f9cefe69854d7c129c59f9a53c6b647  docs/development/artifact-contracts.md
6576e9dd3beeee9872beba9daf1bc1282e00677ff770d497cb066ad4a6d23878  user trace block
```

## Проверка сохранности

- S0, старый CLAUDE и все 45 R-ID имеют строку назначения.
- Все восемь разделов operating model, T/E/Q/F, десять уникальных ролей и четыре команды
  сопоставлены отдельно.
- Действующие детали доступны из коротких адаптеров через `project-rules.md`, `testing.md`,
  operating model и artifact contracts; исторический source не является единственным местом.
- Состав/модели/расписания Multica и resource `in_place` этим этапом не меняются.
- M4 enforcement, включение автопилотов и исправление внешней конфигурации не заявляются.

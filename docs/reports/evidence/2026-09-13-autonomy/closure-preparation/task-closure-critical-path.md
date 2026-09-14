# Минимальный критический путь закрытия Agent Loop

Дата: 2026-09-14. Независимая read-only подготовка во время работы единственного runtime writer. Это не повторное code review, не новое разрешение на запуск остановленной проверки и не приёмка текущего продукта. Ни один product/backlog/gate/native статус этим документом не изменяется.

## Вывод: пилот процесса и закрытие M5 — разные результаты

Для демонстрации Agent Loop не требуется реализовать весь продукт или все сценарии T-112. Task3 прямо запрещает реализовывать весь продукт под видом T-112 и требует помечать отсутствующие функции/зависимости непроверенными (`docs/plans/2026-09-13-autonomy-execution.md:24`). Архитектура фиксирует scope и критерии каждой задачи, разрешает поэтапное внедрение и оставляет неподдержанный шаг ручным (`docs/development/agent-loop-architecture.md:19`, `:22`, `:79`).

Но полный действующий план нельзя закрыть одним узким пилотом. У Task3/M5 остаётся обязательная проверка стандартных CI команд, а текущий документированный web typecheck блокируется настоящим отсутствием web auth/session интерфейса. Поэтому есть два разных порога:

| Порог | Минимальный продуктовый результат | Чего он не разрешает объявить |
|---|---|---|
| Ограниченный пилот процесса / сбор native evidence | Один заранее зафиксированный, реально проверяемый результат на существующем поведении или независимом небольшом участке; например документная сверка, homepage title или T009 BFF browser contract с synthetic upstream. Все критерии выбранной задачи должны пройти настоящую независимую приёмку. | Не закрывает M5, глобальные CI критерии, отсутствующую auth, T112 целиком и readiness автопилотов. Если действующий gate выбранной задачи требует агрегатный typecheck, его отказ блокирует принятие этой задачи; заменить его узким тестом нельзя. |
| Полное закрытие исходного плана миграции и разрешение масштабирования | Принятые Task3 инфраструктурные критерии на точной итоговой ревизии, включая честно зелёный web typecheck; для него нужна ограниченная реализация утверждённого BFF/session/auth контракта. Плюс runtime/native/gate/pilot/activation критерии остальных задач. | Не требует реализации несвязанных функций, всех админских экранов, архивации/удаления, подписок или всей T112 матрицы. Не даёт менять критерии ради зелёного результата. |

Узкий процессный эксперимент допустим как отдельное evidence; принимать обязательный M5/global gate с пропусками недопустимо. Основания: определение принятой задачи (`agent-loop-architecture.md:68`), запрет менять критерии (`:84`), невозможность засчитать skip/todo (`:130`) и порядок применения/пилота/чек-листов (`autonomy-execution.md:28`). Здесь не утверждается, что конкретный текущий gate уже допускает пилот до закрытия M5: его записанные критерии контроллер проверяет перед выбором задачи.

## Реальные блокеры M5, установленные документами

`task-3-recovery-cause-analysis.md:25` разделяет девять typecheck diagnostics и browser/scaffold проблемы. Addendum `:88` исправляет первоначальный вывод об отсутствии auth-политики: политика уже approved G2, нового решения владельца не требуется; отсутствует её реализация.

| Остаток | Минимальная причина-устраняющая работа | Приёмка и граница |
|---|---|---|
| Четыре non-auth type diagnostics | `Author.vue`/`Type.vue`: правильный router location type; `error-t.vue`: useRouter; article page: честная нормализация route param. | Узкий runtime-preserving source diff. Уже разрешён контроллером (`cause-analysis.md:109`). Не оправдывает подавление пяти auth diagnostics. |
| Пустой title | Page-local `useHead({title: "Altera"})` на homepage. | Тот же сохранённый browser title criterion. Девять skipped flows не превращаются в passed; текущая scope фикса не включает их продукт. |
| Отсутствующий named auth middleware на пяти `/me` страницах | Настоящий SSR-safe session/current-user источник через BFF, затем named auth guard с утверждёнными visitor/limited-session redirects. | Нельзя добавить пустой middleware, удалить declarations, использовать browser tokens или type augmentation. Подробная цепочка ниже. |
| Неверный контекст scaffold Flow16 | Вернуться к article fixture, повторно открыть нужный modal и заполнить exact name/reason после blocker-page visits. | Статическая подготовка T112; T076/destructive-fixture сценарий остаётся непроверенным. Это не требование реализовать T076 ради миграции. |
| Остановленные проверки | Сохранить `task3-web-typecheck:2` и `task3-independent-review:2`; подготовить доказательство устранения их причин. | Возобновлять тот же check только через разрешённый recovery после устранения причины, а не новым task/run/check label. Частичный non-auth fix с известными пятью auth failures не даёт основания для нового обязательного GREEN attempt. |

Ни один существующий технический precursor не заменяет browser session boundary: server Bearer/currentUser, старые token-returning GraphQL шаблоны и no-op global/admin middleware перечислены как неполная реализация (`cause-analysis.md:94`). Все эти факты — из датированного анализа; перед source dispatch нужен новый точный source/dirty снимок, не предположение о текущем checkout.

## Минимальная честная auth-зависимость

Это implementation closure для уже согласованной политики, а не разрешение достроить весь auth/admin продукт. Dependency edges ниже взяты из cause-analysis addendum `:100–105` и трёх конкретных подготовленных briefs.

```text
T008 generated SDL/fragment types + drift gate
  └─→ полная T011 role/schema acceptance
        └─→ T012 persisted sessions + hashed magic links

T009 private BFF transport ───────────────────┐
T012 persisted storage ──────────────────────┼─→ T022 request/verify login
T019 mail interface → T021 magic-link delivery┘        │
T012 persisted storage ──────────────────────────────┼─→ T023 BFF cookie/session lifecycle
                                                     └─→ SSR-safe me state + named auth middleware
                                                          └─→ причина пяти auth diagnostics устранена
```

- **T008 нужен для полной T011 приёмки**, потому что роль должна генерироваться из SDL. Он даёт codegen, настоящие fragments, committed output, drift/error proof и замену active manual schema types; не новый GraphQL client и не перенос всех query operations (`task-8-codegen-brief.md:7`, `:20`, `:49`). Не заменять старый manual role union новым manual union и не считать schema-only роль полной T011.
- **T009 — самостоятельная узкая транспортная задача.** POST `/api/graphql`, private upstream runtime config, relative composable, Yoga CSRF header и browser/private-bundle proof. Он специально исключает cookies/session/login/roles; прохождение T009 не означает auth ready (`task-9-bff-implementation-brief.md:16`, `:19`, `:78`). Его локальный browser scenario может дать полезное раннее process-pilot evidence без настоящих provider/DB/auth вызовов.
- **T011/T012 — ограниченный schema/hash milestone.** Не расширять его в archive UI, revocation, owner seeding, email-change mutations или session rotation. При полной приёмке этих задач нельзя выбросить уже зафиксированные role/schema/hash критерии; нужно настоящие empty-history и populated-schema disposable PostgreSQL rehearsal с сохранением данных/связей и hash-compatible link verification (`scratch/task-11-12-session-schema-brief.md:96`, `:108`, `:119`). Нельзя править checksummed migration history или использовать реальную БД ради ускорения.
- **T019→T021 — минимальный mail-interface/delivery prerequisite T022**, а не повод добавлять новые реальные платные провайдеры, доставляемость/рассылки или весь mail backlog. Полный контракт T019 здесь не читался; его транзитивные зависимости и точные критерии не объявляются выполненными. Перед dispatch контроллер читает только этот task/его необходимые источники, а не рекурсивно реализует соседние mail функции.
- **T022→T023** должны дать настоящий утверждённый login/account result, httpOnly session issuance/rotation/revocation/clear, свежий authenticated `me` при SSR и client navigation, visitor/limited-session поведение. Browser-managed access/refresh tokens не являются промежуточной приёмкой. Реальные secrets/providers не нужны для synthetic acceptance, но mock на границе доставки не должен подменять саму session/guard логику (`cause-analysis.md:90`, `:103–107`; `agent-loop-architecture.md:130`).
- **SSR-safe current-user state и named middleware** — последнее узкое звено: сохранить пять declarations, применять approved redirects, отдельно определить судьбу устаревшего global placeholder. Не делать весь admin role UI и все permission mutations условием исправления `/me` guard. Полное T025/browser-account acceptance не выводится из этого middleware; отдельные task статусы принимаются только по своим критериям.

T010 целиком **не является установленным в прочитанных материалах prerequisite** для этой минимальной цепочки: он владеет переносом всех legacy operations, тогда как необходимые auth operations должны быть согласованы с T022/T023. Если конкретный T022 criterion требует зависимость T010, контроллер должен показать этот criterion до расширения scope; этот документ не снимает существующих backlog dependencies. T008 brief специально запрещает захватывать старые token/auth template strings (`:51–55`).

## Практический порядок после текущего runtime writer

1. **Закончить текущий ограниченный runtime milestone и независимую проверку.** Следующие native/managed-MCP/context/auth/hook canaries и gate collector/record/finish acceptance идут по их собственным подтверждённым контрактам. Local binary/argv/fixture успехи не закрывают Task5/native integration (`autonomy-execution.md:36`, `:59`, `:86`). Это не продуктовый backlog dependency и не причина строить новые продуктовые экраны.
2. **Контроллер фиксирует два результата отдельно:** A — scoped native/process pilot evidence, B — closure M5/полного плана. Для A заранее фиксирует критерии/серию/порог принятия и выбранный существующий или небольшой независимый сценарий. Не выбирать только удачные попытки и не заявлять устойчивость по одному run (`agent-loop-architecture.md:188`). Если записанный gate A требует B, A остаётся непринятым до B; никаких gate bypass.
3. **Одна продуктовая цепочка получает свежий baseline и узкий integration audit.** Точные overlapping UI files из recovery analysis переоцениваются перед правками; старые SHA исходного checkout не используются как текущая истина. Product source writer не стартует параллельно с другой активной code chain (`autonomy-execution.md:12`, `agent-loop-architecture.md:143`). Документная подготовка и независимая проверка могут продолжаться отдельно.
4. **Сначала ограниченные независимые результаты:** T009, затем T008 — разумный serial order, если приоритетом является ранний содержательный browser-пилот; T008 первым также допустим, если приоритет — shortest path к T011. Между ними нет доказанного ребра зависимости. Их exact AC нельзя заменять «всё ещё падает typecheck, значит ничего не проверяем» или, наоборот, локальным pass нельзя закрывать M5. Четыре type repairs, title и Flow16 выполняются отдельным узким already-authorized recovery diff без нового product дизайна.
5. **Затем T011/T012 и минимальная T019/T021→T022/T023→web-state/guard closure**, строго по существующим критериям. Подготовка независима, реализация последовательна. До T023 архитектура auth уже задана; отсутствующие implementation/data-state evidence не превращаются в owner-policy вопросы. Открытые числовые/операционные assumptions из schema brief не выбираются молча и не добавляются в schema ради этого пилота.
6. **После доказанного устранения всех причин** контроллер проверяет отсутствие active duplicate, делает разрешённый recovery тех же stopped Task3 checks, сохраняет raw command/exit/source SHA/dirty fingerprint и получает независимую приёмку. Нельзя «проверить ещё раз на удачу» после четырёх repairs, зная об отсутствующей auth. Возможность recovery следует Task6, но не является автоматическим разрешением на новый run (`autonomy-execution.md:73–79`).
7. **Синхронизация → финальный process pilot → activation checklist.** После принятия репозиторных изменений контроллер сохраняет полный Multica snapshot, применяет только разрешённый адресный diff и перечитывает значения; затем проверяет реальную загрузку контрактов runner. Принять настоящий scoped цикл contract→implementation→test→review→fix-if-needed→metadata/release/finalization на актуальном входе; отдельно выполнить негативные empty/not-ready/live/old-revision/Q/two-failures сценарии и RO write denial. Различать run/stage/task. Только после этого проверять каждый activation checklist; ничего не включать по данному planning memo (`autonomy-execution.md:28`, `:45–86`).

## Явно вне минимального closure

- Все отсутствующие T112 end-to-end flows как совокупность; permanent delete T076 и его destructive fixtures; archive/admin/category/last-owner UI; новые roles management workflows; subscriptions/payments/plan features; email-change/recovery UX; audit/retention jobs и любые иные adjacent backlog items.
- Полная миграция legacy operations T010 ради красивого каталога, полное устранение всех UI mocks или redesign GraphQL transport/client, если это не требуется конкретным принятым criterion выбранной задачи.
- Новый scheduler/orchestrator, новые модели/лимиты/расписания или изменение состава squad; архитектура прямо сохраняет Multica и существующие роли (`agent-loop-architecture.md:22`; execution Global Constraints).
- Реальный provider rollout, production migration, внешний live auth/DB или платная интеграция как замена изолированным проверкам. Их полномочия и условия не возникают из product prerequisite автоматически.

Граница не означает «снять task dependency»: если полная T011/T012/T022/T023 или конкретный pilot gate требует критерий, он сохраняется. При незавершённом критерии задача остаётся частично выполненной/непринятой; необязательный соседний backlog не становится частью migration scope только из-за похожего имени.

## Правило против неконтролируемого расширения

Перед добавлением следующего task контроллер записывает одно ребро: «какой неизменённый AC-ID выбранного pilot/M5/migration criterion не может пройти без этого результата», источник ребра и минимальный выход. Если такого ребра нет — отдельный backlog. Если ребро есть, но task содержит более широкий контракт — либо выполнить его точные критерии, либо оформить разрешённый bounded milestone и сохранить полную task acceptance открытой; не объявлять частичную реализацию полной.

Это позволяет уже сейчас готовить/принимать ограниченные runtime и process результаты, при этом честно признавая: без настоящей auth реализации aggregate web typecheck/M5 пока не закрыт, а без runtime/native/pilot/checklist evidence автономия не включается. Никакого основания реализовывать весь продукт в прочитанных источниках нет.

## Источники и выполненные действия

Прочитаны только execution plan, Agent Loop architecture, полный recovery cause analysis с двумя уточнениями и три названных подготовленных briefs: T008, T009, T011/T012. Критический путь — вывод по их записанным контрактам, а не новое исследование live source или утверждение о сегодняшнем implementation status каждого T-NNN. Не читались реальные auth/config/credentials, не запускались tests/DB/native/model, не менялись source/index/HEAD или другие файлы. Единственная запись — этот planning artifact.

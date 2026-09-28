# T-048: адаптер AI-проверки допустимости (`fake`), запись результата и связь с очередью — план

- **Дата**: 2026-09-28
- **Задача**: T-048 / ALTE-135, эпик E-08 «Проверка и публикация»
- **Native issue**: `01a0e4af-a3ee-72f7-af5a-2e0c4a6b98bf`
- **Источник**: `docs/backlog/tasks/T-048-ai-check-adapter.md`
- **Ревизия допуска задачи**: `76e46e6ab48a98568f87d5c44c55c4b0d9a45eec`
- **Baseline**: `origin/app` `eade0b29470d855b610eb8b11318316f6bba2c11` (свежий fetch; включает merge T-020 #324)
- **Ветка**: `server/t048-ai-check-adapter`
- **Рабочее дерево**: `/Users/egorbondarenko/WebstormProjects/Altera/.worktrees/autopilot`

## 1. Наблюдаемое состояние до работы

Сверено с кодом на baseline.

- **Очередь T-047 готова**: `server/src/jobs/job-worker.ts` (claim → handler → `complete` /
  `reschedule` / `fail`, `DEFAULT_JOB_MAX_ATTEMPTS = 3`), `prisma-job-store.ts` (`enqueue`,
  `retry`, `cancel`), `job-handlers.ts` (`registerJobHandler`). Вид задания `ai.check` уже
  перечислен в `KNOWN_JOB_KINDS` (`server/src/admin/jobs.ts`), но **обработчика нет**.
- **Модели записи существуют, продюсера нет**: `AiProcess` (`kind`, `status` created/started/
  running/completed/failed, `verdict`, `reasons Json?`, `providerErrorClass`, `model`,
  `promptVersion`, `durationMs`, `jobId`) и `AiCostAggregate` (`bucketStart`, `bucketEnd`,
  `kind`, `totalCostMinor`, `processCount`). Единственные обращения к `aiProcess` в коде — два
  `count` в `server/src/admin/dashboard.ts`. Ни одной записи нигде не создаётся.
- **Коды событий уже утверждены и зарегистрированы**: `ai.job.created/.started/.running/.done/
  .failed` в `LOG_EVENT_CODES`, `ai.decision` в `AUDIT_CODE_ZONES` (зоны `moderation`,
  `financeAndPd`). Оба реестра сверяются с `docs/spec/00-registries/events-and-logs.md`
  биективными тестами, поэтому новых кодов вводить не нужно и нельзя.
- `PROVIDER_UNAVAILABLE` с `provider: "ai"` уже допустим словарём ошибок
  (`server/src/errors/dictionary.ts`); образец — `mail/service.ts` и `storage/types.ts`.
- `ReviewMessageKind.ai_decision` в схеме есть; `ReviewMessage.byRole` — `Role` **без null**.
- Пакет `@altera/content` (T-041) даёт `readDocument`, `toPlainText`, `extractImages`.
  По решению T-020 он подключён к `server` как **devDependency** и `server/src/**` его не
  импортирует: `dist` не в git, а `build:ci` пакет не собирает.
- Критерии проверки утверждены владельцем: `docs/spec/40-admin/ai-check-criteria.md`
  (журнал §43). Шесть кодов категорий взяты оттуда (§4): `rights`, `illegal`, `spam_ads`,
  `third_party_pd`, `age`, `topic_rules`.

## 2. Границы

- **Входит** (§32 п. 3): интерфейс адаптера, `fake`-реализация, запись результата (AI-процесс,
  агрегат стоимости, комментарий автору, аудит `ai.decision`), связь с очередью (постановка
  задания и обработчик), выбор реализации по окружению.
- **Не входит**: `real` (YandexGPT, журнал §34 п. 4) — после утверждения владельцем; вместо него
  адаптер `unavailable`, который отвечает `PROVIDER_UNAVAILABLE: ai`.
- **Не входит**: переходы статусов версии (`ai_check` → `published` / `review`) — T-049. Сервис
  проверки **не меняет** `ArticleTranslation.status`.
- **Не входит**: страница `/admin/ai` и её запросы (T-078), письма автору (T-049 и проход почты),
  пометка 18+ у статьи (T-136), юридические дополнения (T-137), `alt` (T-067).
- **Не входит**: текст причин для автора как утверждённая формулировка. Названия шести категорий
  взяты из утверждённых документов; поясняющая фраза `fake` — заготовка теста, помечена в коде.

## 3. Замысел

### 3.1 Интерфейс адаптера (`server/src/ai/types.ts`)

```
AiCheckAdapter { name, model, promptVersion, check(submission) → AiCheckResult }
AiCheckSubmission — подача без имени и e-mail автора
AiCheckResult { verdict: publish|reject, reasons[], evidence[], manipulationAttempt, adult,
                model, promptVersion, costMinor }
```

`verdict` бинарный (журнал #41–42). `reasons[]` — код категории и текст для автора;
`evidence[]` — фрагмент подачи для `moderator`/`owner`; `manipulationAttempt` и `adult` —
признаки из §5 критериев. `costMinor` возвращается адаптером и **не попадает в запись процесса**.
Недоступность провайдера — `PROVIDER_UNAVAILABLE: ai` через `aiProviderUnavailableError`.

### 3.2 Экстрактор подачи (`server/src/ai/submission.ts`)

`loadAiCheckSource(client, { translationId, revisionId })` + чистый
`buildAiCheckSubmission(source)`. Состав подачи — `ai-check-criteria.md` §2: заголовок, дек,
текст в порядке блоков, рубрика, теги в сохранённом порядке, язык версии, изображения статьи
с обложкой (подпись, атрибуция, лицензия), пометка 18+ автора.

Имя и e-mail автора не передаются **и не читаются**: `select` загрузчика вынесен в экспортируемую
константу и не содержит ни `author`, ни `name`, ни `email`, ни `handle`. Текст блоков даёт
`toPlainText` из `@altera/content` — второй реализации разбора документа не будет.

Это требует перевести `@altera/content` в `dependencies` сервера и собирать пакет перед
`tsc` в `build` и `build:ci` (`pnpm --filter @altera/content run build && …`). Тесты
по-прежнему берут исходники пакета через alias в `server/vitest.config.ts`.

### 3.3 `fake` (`server/src/ai/adapters/fake.ts`)

Детерминированный двойник без случайности:

1. фикстура, заданная тестом для `translationId` (`setFixture`), имеет приоритет;
2. иначе маркер в тексте подачи — строка `ai-check-fixture: <verdict> <категории…>`,
   а также `unavailable`, `adult`, `manipulation`;
3. иначе — `publish` (§3 п. 1 критериев: при неуверенности статья публикуется).

Собранные подачи складываются в `submissions` для проверок. `costMinor` — 0.

### 3.4 Выбор реализации (`server/src/ai/config.ts`)

`AI_CHECK_ADAPTER` по образцу `mail/config.ts`: не задан → `fake` вне production и
`unavailable` в production; `fake` в production запрещён ошибкой запуска; `real` пока
отвечает ошибкой запуска «провайдер ожидает утверждения владельцем» (журнал §32 п. 2).

### 3.5 Запись результата (`server/src/ai/service.ts`)

`runCheck({ jobId, translationId, revisionId, originRequestId })`:

1. находит AI-процесс по `jobId`; `completed` → выходит без второго вердикта
   (журнал #14: повторного запуска ради другого вердикта нет);
2. `started` (лог `ai.job.started`) → загрузка подачи → `running` (лог `ai.job.running`);
3. вызов адаптера;
4. успех — одна транзакция: процесс `completed` (вердикт, причины, evidence, признаки, модель,
   `promptVersion`, `durationMs`); `AiCostAggregate` — суточная корзина UTC `[ДОПУЩЕНИЕ]`
   (`totalCostMinor += costMinor`, `processCount += 1`); при `reject` — `ReviewMessage`
   `ai_decision` с текстом причин по категориям; аудит `ai.decision`
   (`translationId`, `revisionId`, `verdict`, коды причин, `promptVersion`);
   лог `ai.job.done` (`model`, `promptVersion`, `costMinor`, `durationMs`, `verdict`);
5. отказ провайдера — процесс `failed` с классом ошибки, лог `ai.job.failed`,
   и ошибка наружу: задание повторяет очередь T-047 (до трёх попыток).

Стоимость нигде не пишется у отдельной записи (§27.4): колонки в `ai_processes` нет и не будет.

### 3.6 Связь с очередью (`server/src/ai/queue.ts`, `index.ts`)

- `AI_CHECK_JOB_KIND = "ai.check"` (уже известный вид).
- `enqueueAiCheck(deps, { translationId, revisionId, originRequestId })` — одна транзакция:
  задание в очереди + AI-процесс в статусе `created` + лог `ai.job.created`. Это точка входа
  для T-049 (`submitTranslation`).
- `registerAiCheckJob({ client, adapter, logger })` — обработчик вида `ai.check`;
  подключается в `server.ts` рядом с `registerHousekeepingJob`.

### 3.7 Миграция `20260928150000_ai_check_result`

Дополняет существующие таблицы, ничего не удаляет:

| Таблица | Изменение | Зачем |
| --- | --- | --- |
| `ai_processes` | `revisionId TEXT` | аудит #71 требует `revisionId`; одна проверка на ревизию |
| `ai_processes` | `manipulationAttempt BOOLEAN NOT NULL DEFAULT false` | §5 критериев, признак для ревьюера |
| `ai_processes` | `adult BOOLEAN NOT NULL DEFAULT false` | пометку 18+ ставит проверка (журнал §43 п. 8) |
| `ai_processes` | `evidence JSONB` | фрагменты подачи для `moderator`/`owner` (§5) |
| `ai_processes` | `UNIQUE (objectType, objectId, revisionId)` | NULL в PostgreSQL не конфликтует, поэтому ограничение действует только на записи проверки статьи: вердикт по ревизии один |
| `review_messages` | `byRole` становится `Role?` | у записи автоматической проверки роли сотрудника нет (журнал §16.3, §25.9) |

Колонки стоимости в `ai_processes` не появляется — это и есть механизм критерия 3.

### 3.8 Тесты

| Файл | Что проверяет | Критерий |
| --- | --- | --- |
| `server/tests/ai-check-adapter.test.ts` | `fake`: фикстура «отказ» → вердикт `reject`, причины по категориям, комментарий `ai_decision` с названиями категорий; `publish` → комментария нет; недоступность → `PROVIDER_UNAVAILABLE: ai`, процесс `failed`, задание повторяется; повторный прогон завершённого процесса второго вердикта не даёт; аудит `ai.decision`; выбор адаптера по окружению | 1 |
| `server/tests/ai-check-submission.test.ts` | экстрактор: `select` загрузчика не содержит полей имени и e-mail (рекурсивная проверка); состав подачи — ровно разрешённый перечень полей; имя и e-mail автора не встречаются в подаче ни ключом, ни значением; текст блоков в порядке документа | 2 |
| `server/tests/ai-cost-contract.test.ts` | контракт раздела: в `ai_processes` нет ни одного поля стоимости; стоимость есть только в `ai_cost_aggregates`; GraphQL-схема не отдаёт стоимость отдельной AI-записи; сервис пишет стоимость только в агрегат | 3 |

## 4. Критерии готовности и способ подтверждения

1. С `fake` статья с фикстурой «отказ» получает комментарий с причинами по категориям —
   `ai-check-adapter.test.ts`.
2. Текст для проверки не содержит имени и e-mail автора — `ai-check-submission.test.ts`.
3. Стоимость записывается так, что доступна только агрегатом — `ai-cost-contract.test.ts`.

## 5. Проверки

`pnpm format`, `pnpm lint`, `pnpm test`, `pnpm --filter server run build:ci`,
`pnpm --filter server exec prisma validate`, `prisma migrate diff --exit-code` (отсутствие drift),
применение миграции на одноразовой копии локальной базы из `docker-compose.yml`,
`pnpm install --frozen-lockfile`, `pnpm codegen --check`.

Development Neon и production не читаются и не изменяются.

## 6. Риски

- **Сборка пакета `content` перед сервером**: если шаг сборки не выполнится, `tsc` сервера
  упадёт на разрешении типов. Закрывается тем, что шаг стоит первым в `build` и `build:ci`,
  и проверяется фактическим `pnpm --filter server run build:ci` в этой задаче.
- **Drift схемы** от ручной миграции — закрывается `prisma migrate diff --exit-code` и
  применением на копии.
- **Карточка сводки `editorialProcesses`** считает AI-процессы по `objectType: "Article"`,
  а объект проверки по спецификации — версия статьи (`ArticleTranslation`). Значение карточки
  останется нулевым. Правка карточки требует связи через `isEditorial` и относится к T-078;
  расхождение фиксируется в отчёте, а не правится молча.
- **Текст причин** для автора в `fake` — заготовка, не утверждённая формулировка; в production
  `fake` запрещён, поэтому автору он не покажется.

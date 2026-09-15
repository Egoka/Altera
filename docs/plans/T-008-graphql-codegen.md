# T-008: GraphQL Code Generator из SDL сервера

- **Дата**: 2026-09-15
- **Ветка**: `docs/t008-graphql-codegen`
- **Задача**: T-008 / ALTE-16
- **Authorization**: допуск очереди из `docs/backlog/tasks/T-008-graphql-codegen.md`, native issue
  `01a0a189-0e9a-7422-bada-d6469e52b08f`, поручение архитектурной стадии
  `01a0a262-c00d-73b2-83e2-5425bb520aec`
- **Базовый коммит**: `fac84c9c802839efcc8685a86431b9c06b058e0c`
- **Исходное дерево**: clean
- **Отчёт**: `docs/reports/T-008-graphql-codegen-report.md` (заполняется разработчиком по завершении)
- **Статус**: утверждён

> **Для исполнителя:** выполнять план последовательно в отдельном worktree T-008. Перед реализацией
> использовать `superpowers:test-driven-development`; для исполнения готового плана —
> `superpowers:executing-plans` либо `superpowers:subagent-driven-development` по доступному режиму.

## Цель

Сделать `server/src/graphql/**/*.graphql` единственным источником GraphQL-типов веб-приложения:
добавить детерминированную генерацию закоммиченных TypeScript-типов и `TypedDocumentNode`, убрать
ручные дубликаты схемы и включить `pnpm codegen --check` в обязательный PR CI.

## Источники контракта

- `docs/backlog/tasks/T-008-graphql-codegen.md` — scope, AC и граница с T-010;
- `docs/decisions/ADR-0012-api-contract-codegen.md` — SDL сервера как единственный источник,
  `TypedDocumentNode`, будущие документы в `web/app/graphql/**/*.graphql`;
- `docs/decisions/ADR-0020-keep-graphql-yoga.md` — GraphQL Yoga и schema-first остаются;
- `docs/vision/02-target-architecture.md` и `docs/vision/08-operations.md` — границы `web`/`server`,
  contract checks в CI;
- `docs/reports/evidence/2026-09-13-autonomy/closure-preparation/task-8-codegen-brief.md` — ранее
  собранный аудит ручных типов и их потребителей;
- актуальная документация GraphQL Code Generator:
  [client preset](https://the-guild.dev/graphql/codegen/plugins/presets/client-preset),
  [config и `--check`](https://the-guild.dev/graphql/codegen/docs/config-reference/codegen-config),
  [установка в monorepo](https://the-guild.dev/graphql/codegen/docs/getting-started/installation).

## Архитектурное решение

### Владение конфигурацией и пакетами

Новый workspace-пакет `packages/graphql` не создаётся. Codegen пересекает границу двух существующих
workspace (`server` поставляет SDL, `web` потребляет результат), поэтому его CLI, preset и конфиг
живут в корне монорепозитория:

```text
codegen.ts                               корневая конфигурация
package.json                             команды codegen и tool dependencies
server/src/graphql/**/*.graphql          единственный schema input
web/app/graphql/fragments/*.graphql      fragment documents T-008
web/app/graphql/generated/               закоммиченный generated output
web/app/graphql/**/*.graphql             будущие операции T-010
```

`graphql` объявляется прямой root dev dependency для CLI с той же major-версией 16, что уже использует
сервер. `@graphql-typed-document-node/core` и `graphql` объявляются прямыми зависимостями `nuxt-app`,
поскольку сгенерированные типизированные документы входят в TypeScript-граф веб-приложения. На
транзитивные зависимости Yoga полагаться нельзя.

### Выбор preset

Используется `preset: "client"` из `@graphql-codegen/client-preset` с
`presetConfig.fragmentMasking: false`.

Почему:

- preset по умолчанию генерирует типы результата/variables и `TypedDocumentNode`, как требует ADR-0012;
- каталог output даёт стабильный единый import boundary `~/graphql/generated/graphql`;
- тот же конфиг подхватит `.graphql`-операции T-010 без смены архитектуры;
- отключение fragment masking сохраняет простые структурные props текущих Vue-компонентов и не
  вводит helper API, пока реального клиента и fragment colocation нет.

Отвергнутые варианты:

1. Явная цепочка `typescript` + `typescript-operations` + `typed-document-node` даёт один файл, но
   заставляет вручную сопровождать совместимость plugins, хотя поддерживаемый `client` preset уже
   выражает нужный контракт.
2. `near-operation-file` рассеивает generated-файлы рядом с будущими операциями и усложняет ignore,
   imports и drift-review; одного потребителя и нескольких пакетов сейчас нет.
3. Отдельный workspace-пакет оправдан только при двух и более независимых потребителях контракта;
   сейчас он добавил бы сборку и публикационную границу без пользователя.

### Generated output

`web/app/graphql/generated/` коммитится в Git. Ручное редактирование каталога запрещено. Он целиком
исключается из Prettier и ESLint: `--check` сравнивает байты in-memory output с файлами, поэтому
форматирование после codegen давало бы ложный drift. Единственный способ обновления — `pnpm codegen`.

Пока T-010 не перенёс операции, T-008 добавляет только именованные fragments для реально используемых
форм компонентов. Это GraphQL documents, но не перенос legacy query/mutation и не добавление клиента.
`ignoreNoDocuments: true` остаётся страховкой для начального/переходного состояния, а наличие fragments
отдельно проверяется отрицательной пробой невалидного документа.

Скаляр `JSON` отображается как `unknown` на входе и выходе. Ручной `any` или утверждение
`Record<string, string>` не допускаются: конкретная структура должна сужаться на границе потребителя.
GraphQL enum генерируются строковыми union через `enumsAsTypes: true`; ручные unions ролей и статусов
удаляются.

## Точная структура изменений

### Создать

- `codegen.ts` — schema/documents globs, `client` preset и детерминированные опции;
- `web/app/graphql/fragments/author.graphql` — `AuthorSummary`;
- `web/app/graphql/fragments/article.graphql` — `ArticleCard` и `PopularArticle`;
- `web/app/graphql/fragments/taxonomy.graphql` — `ContentTypeSummary` и `SectionTagSummary`;
- `web/app/graphql/generated/graphql.ts`, `gql.ts`, `index.ts` и прочие файлы, которые детерминированно
  выдаёт выбранная версия client preset; состав не редактировать вручную;
- `docs/reports/T-008-graphql-codegen-report.md` — фактический implementation/evidence report.

### Изменить

- `package.json` — root dependencies и скрипт `codegen`;
- `web/package.json` — прямые dependencies generated-кода;
- `pnpm-lock.yaml` — только результат `pnpm add`;
- `.prettierignore` — `web/app/graphql/generated/`;
- `web/eslint.config.mjs` — `**/app/graphql/generated/**` в первом `ignores` block;
- `.github/workflows/pull_request.yml` — `pnpm codegen --check` в существующем job `checks` после install;
- потребители из аудита brief: заменить imports ручных типов generated fragment/schema types и явно
  обработать nullable поля;
- `web/app/pages/authors/[slug].vue` — заменить устаревшую роль `"user"` на generated `reader` и тип
  фикстуры на `AuthorSummaryFragment`;
- при необходимости локальный UI-only тип для `iconUrl` назвать `ContentTypeNavItem` и определить как
  `ContentTypeSummaryFragment & { iconUrl?: string }`, не копируя GraphQL-поля.

### Удалить после миграции imports

- `web/app/query/types.ts`;
- `web/app/types/article.ts`;
- `web/app/types/contentType.ts`;
- `web/app/types/sectionTag.ts`;
- `web/app/types/user.ts`.

### Не менять

- `web/app/query/**/*.ts` и `web/app/query/index.ts`: перенос и исправление операций принадлежит T-010;
- server SDL и resolvers, кроме временной disposable drift-пробы;
- BFF, GraphQL transport/client, auth/session flow — T-009/T-010/T-022;
- Prisma schema, миграции, БД и переменные окружения.

## Эталон конфигурации

Разработчик создаёт `codegen.ts` в таком виде; отступления фиксируются в отчёте, а не в этом плане:

```ts
import type { CodegenConfig } from "@graphql-codegen/cli"

const config: CodegenConfig = {
  schema: "server/src/graphql/**/*.graphql",
  documents: "web/app/graphql/**/*.graphql",
  ignoreNoDocuments: true,
  generates: {
    "web/app/graphql/generated/": {
      preset: "client",
      presetConfig: {
        fragmentMasking: false
      },
      config: {
        enumsAsTypes: true,
        useTypeImports: true,
        defaultScalarType: "unknown",
        scalars: {
          JSON: {
            input: "unknown",
            output: "unknown"
          }
        }
      }
    }
  }
}

export default config
```

Корневые scripts:

```json
{
  "scripts": {
    "codegen": "graphql-codegen --config codegen.ts"
  }
}
```

На baseline 2026-09-15 актуальные registry versions: `@graphql-codegen/cli@7.4.1`,
`@graphql-codegen/client-preset@6.2.0`, `@graphql-typed-document-node/core@3.2.0`. `graphql` сохраняет
совместимую с сервером линию `^16.11.0`, TypeScript — существующую линию `^5.8.3`; обновление проекта
до GraphQL 17 или TypeScript 7 не входит в T-008.

Минимальные fragments:

```graphql
fragment AuthorSummary on User {
  id
  name
  email
  bio
  photoUrl
  role
  slug
  socialLinks
  createdAt
  updatedAt
}

fragment ArticleCard on Article {
  id
  title
  slug
  dek
  excerpt
  featuredImage
  publishedAt
  author {
    name
    slug
    photoUrl
  }
  contentType {
    name
    slug
  }
}

fragment PopularArticle on Article {
  id
  title
  slug
  author {
    name
    slug
  }
  contentType {
    name
    slug
  }
}

fragment ContentTypeSummary on ContentType {
  id
  name
  slug
  description
  order
  status
  createdAt
  updatedAt
}

fragment SectionTagSummary on SectionTag {
  id
  name
  slug
  description
  createdAt
  updatedAt
}
```

## План реализации

### Task 1: Зафиксировать RED и установить toolchain

**Files:** `package.json`, `web/package.json`, `pnpm-lock.yaml`.

- [ ] Запустить до изменений `pnpm codegen --check`; сохранить exit code и ошибку отсутствующего script
      как RED `t008-codegen-command`.
- [ ] Добавить root dev dependencies точных версий CLI/preset и совместимые `graphql`/TypeScript через
      pnpm; отдельно добавить прямые web dependencies `graphql@^16.11.0` и
      `@graphql-typed-document-node/core@3.2.0`.
- [ ] Добавить root script `codegen`; проверить, что аргумент проходит именно командой
      `pnpm codegen --check`, без отдельного alias.
- [ ] Проверить diff lockfile: только ожидаемые packages, без обновления несвязанных зависимостей.

### Task 2: Добавить config, fragments и первый generated output

**Files:** `codegen.ts`, `web/app/graphql/fragments/*.graphql`, `web/app/graphql/generated/**`,
`.prettierignore`, `web/eslint.config.mjs`.

- [ ] Создать config и fragments по эталонам выше.
- [ ] До генерации запустить `pnpm codegen --check`; ожидается non-zero из-за отсутствующего output.
- [ ] Запустить `pnpm codegen`, затем `pnpm codegen --check`; ожидается exit 0.
- [ ] Запустить `pnpm codegen` повторно и проверить `git diff --exit-code -- web/app/graphql/generated`;
      ожидается exit 0 — генерация детерминирована.
- [ ] Добавить точные ignore paths и убедиться, что generated-файлы не форматируются/не линтятся, а
      hand-written fragments и config по-прежнему входят в проверки.

### Task 3: Перевести потребителей и удалить ручные schema types

**Files:** пять удаляемых type-файлов и только их фактические потребители из trace/brief.

- [ ] Заменить `ArticleResponse`, `ArticleListItem`, `PopularArticleData`, `User`, `ContentType` и
      `SectionTag` на соответствующие generated fragment types.
- [ ] Для nullable `dek`, `excerpt`, `featuredImage`, `publishedAt`, `bio`, `photoUrl` добавить в UI
      явные fallback/guards; не использовать `as`, `!`, `any` для возврата прежней ложной nullability.
- [ ] Для `iconUrl`, отсутствующего в SDL, оставить только узкий `ContentTypeNavItem` extension.
- [ ] Изменить fixture role `"user"` на generated значение `"reader"`.
- [ ] Удалить пять ручных type-файлов после устранения всех imports.
- [ ] Выполнить проверки отсутствия старых imports и unions:

```bash
test ! -e web/app/query/types.ts
test ! -e web/app/types/article.ts
test ! -e web/app/types/contentType.ts
test ! -e web/app/types/sectionTag.ts
test ! -e web/app/types/user.ts
if grep -R -n -E '~/query/types|~/types/(article|contentType|sectionTag|user)' web/app \
  --include='*.ts' --include='*.vue'; then exit 1; fi
if grep -R -n -E 'type (Role|ArticleStatus|ContentTypeStatus)[[:space:]]*=' web/app \
  --include='*.ts' --include='*.vue' --exclude-dir=generated; then exit 1; fi
```

### Task 4: Включить drift gate в CI

**File:** `.github/workflows/pull_request.yml`.

- [ ] После `Install dependencies` в существующем job `checks` добавить:

```yaml
- name: GraphQL codegen drift
  run: pnpm codegen --check
```

- [ ] Не создавать новый terminal job: обязательный aggregate `test` уже зависит от `checks`.
- [ ] Не запускать generation в CI и не прикреплять её к `prepare`/`postinstall`: CI только сравнивает
      закоммиченный output с локальными SDL/documents.

### Task 5: Проверить положительный и отрицательные контракты

- [ ] На итоговом source выполнить `pnpm codegen --check`, `pnpm format`, `pnpm lint`, `pnpm test`,
      `pnpm --filter nuxt-app run typecheck` и `pnpm --filter nuxt-app run build`; записать реальные exit
      codes и вывод в report. Известные несвязанные failures не называть PASS и не сбрасывать их check IDs.
- [ ] В disposable clean worktree от implementation commit добавить nullable поле
      `_codegenDriftProbe: Boolean` в существующий `type Query`, не перегенерировать output и выполнить
      `pnpm codegen --check`; ожидается exit 1. Удалить disposable worktree, не восстанавливая accepted
      source in-place.
- [ ] Во второй disposable copy добавить
      `web/app/graphql/codegen-invalid-probe.graphql` с выборкой отсутствующего поля; выполнить
      `pnpm codegen --check`; ожидается non-zero validation error. Не коммитить probe.
- [ ] Для буквального AC-1 получить два PR CI run: один failed на отдельном временном commit с валидным
      SDL drift без regeneration, затем вернуть probe отдельным revert commit и получить green run на
      финальном source. В отчёте сохранить обе ссылки и SHA; failed run не является итоговой ревизией.
- [ ] Проверить generated `Role`, `ArticleStatus`, `ContentTypeStatus` и fragment nullability против SDL.

### Task 6: Оформить evidence и передать на тестирование

**File:** `docs/reports/T-008-graphql-codegen-report.md`.

- [ ] Записать baseline, implementation SHA, dirty fingerprint, точные commands/cwd/exit codes,
      generated paths и ограничения каждой проверки.
- [ ] Для AC-1 сослаться на green и intentional-red CI runs; для AC-2 — на deletion/import/union checks.
- [ ] Явно зафиксировать, что legacy operations остались строками до T-010, transport/BFF не проверялись,
      БД/Redis не требовались и никакие миграции не выполнялись.
- [ ] Передать implementation SHA, report и CI evidence тестировщику, затем независимому reviewer.

## Критерии готовности

### AC-1 — codegen drift gate

- `pnpm codegen --check` на финальном clean source завершается exit 0;
- изменение SDL без regeneration даёт exit 1;
- невалидный `.graphql` document даёт non-zero validation error;
- PR CI содержит отдельный шаг codegen и два наблюдаемых run: intentional red и final green.

### AC-2 — единый источник типов

- пять перечисленных ручных type-файлов отсутствуют;
- их старые import paths отсутствуют в `web/app`;
- schema enum/response shapes приходят из `web/app/graphql/generated/`;
- UI-only extension не копирует GraphQL-поля, а расширяет generated fragment type;
- web typecheck/build не получают новых ошибок от nullable generated contract.

## Риски и снятие

- **Client preset меняет набор generated-файлов между версиями.** Версии CLI/preset фиксируются в
  manifests и lockfile, output обновляется только через pnpm/codegen.
- **Prettier делает каждый `--check` красным.** Generated directory исключается целиком, потому что
  официальный `--check` сравнивает bytes in memory.
- **`ignoreNoDocuments` может скрыть неверный glob.** T-008 добавляет реальные fragments и negative
  invalid-document probe.
- **Ручные типы скрывали nullable SDL.** Потребители получают guards/defaults; assertions запрещены.
- **T-008 незаметно захватит T-010.** Legacy `web/app/query/**/*.ts` остаются без изменений; fragments
  описывают только типы активных view shapes и не являются runtime operations.
- **Generated output может быть принят за новый источник истины.** Он коммитится только как проверяемая
  производная; любое изменение начинается с SDL/documents и `pnpm codegen`.

## Стадии и handoff

| Стадия             | Вход                                   | Выход / evidence                                                                                            |
| ------------------ | -------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| Архитектура        | T-008, ADR-0012/0020, vision, baseline | этот утверждённый план                                                                                      |
| Разработка         | этот план и отдельный T-008 worktree   | implementation commits + парный report                                                                      |
| Тестирование       | implementation SHA + report            | AC-1/AC-2 commands, red/green CI links, verdict                                                             |
| Независимое ревью  | exact diff, sources, test evidence     | `принято` либо точный возврат                                                                               |
| Документация/релиз | только после принятия                  | metadata/finalization по общему контракту; deploy не требуется, если diff не влияет на backend build inputs |

Архитектурный run заканчивается созданием плана; это не означает выполнения реализации или приёмки T-008.

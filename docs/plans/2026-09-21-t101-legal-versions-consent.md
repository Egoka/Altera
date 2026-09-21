# План T-101: механизм версий юридических текстов и согласий; страницы `/legal/*`

- **Задача**: `docs/backlog/tasks/T-101-legal-versions-consent.md`
  (file SHA `dbfe76f5d3b5c9a908095464d758f998ace580b0`)
- **Native issue**: ALTE-109 (`01a0c1aa-8e19-75b9-8bc5-a1cc42b043db`)
- **Эпик**: E-16 «Юридические тексты и согласия»
- **Baseline `origin/app`**: `5fbd8f6af4cf4ccc7ae9b37610e0c9d3dae9d61e`
- **Ветка**: `feat/t101-legal-versions`
- **Источники**: журнал §24.2, §24.3; `docs/spec/20-public/legal-terms.md`, `legal-privacy.md`,
  `legal-content-rules.md`, `legal-license.md`; `docs/spec/40-admin/legal-texts.md` (граница с
  T-083); `docs/spec/90-business-model/legal-152-54.md`; ADR-0028

## Что уже есть и чего нет

T-019 дал таблицы `legal_texts` (вид, локаль, номер, статус `draft` / `published` / `previous`,
`isMaterial`, `summaryOfChanges`, `publishedAt`) и `user_legal_consents`. T-022 записывает
согласие при регистрации и спрашивает его повторно при входе, но повторное согласие вызывает
**любая** новая версия, а не только существенная. Публичных страниц `/legal/*`, запроса текста,
механизма публикации редакций и `me.consents` нет.

## Что делаю

### Сервер

1. `server/src/legal/texts.ts` — публикация редакции (следующий номер, прежняя действующая →
   `previous`), чтение публичного текста с откатом на другую локаль, архивом и якорями,
   проверка разметки перед публикацией.
2. `server/src/auth/legal.ts` — состояние согласия по оферте и политике; повторное согласие —
   только после существенной редакции, вышедшей после принятой (ADR-0028 п. 2,
   `legal-texts.md` §5).
3. `server/src/graphql/legal` — `legalText(kind, locale, version)` с публичным кешем по тегу вида
   и `AccountUser.consents`.
4. Карта сайта — опубликованные `/legal/*` без `?version=`.
5. `legal:publish` — публикация релизом кода до раздела `/admin/legal` (T-083 §7).

### Веб

`LegalPage`, `TableOfContents`, `NoticeCard`; страницы четырёх видов; строки состояний §8;
печатные стили; зоны аккаунта отдельным клиентским запросом, чтобы серверный HTML оставался
публичным; в лицензии — раздел о запрете обучения ИИ (журнал §24.2), пока его нет в тексте.

## Не делаю

Содержание текстов (T-102, Q-07); `/legal/paid-services`, `/legal/refunds` (F-01);
`/admin/legal` (T-083); справочник `mediaLicenses`.

## Проверка

- AC-1 «регистрация сохраняет версию согласия» — `server/tests/legal-versions-database.test.ts`
  на PostgreSQL (CI) и фейковые тесты `auth-magic-link.test.ts`.
- AC-2 «строки состояний четырёх спецификаций» — `web/tests/e2e/101-legal-pages.spec.ts` в CI,
  компонентные тесты `web/tests/legal-pages.nuxt.test.ts`.
- `pnpm format`, `pnpm lint`, `pnpm codegen --check`, `pnpm test`, сборки и typecheck.

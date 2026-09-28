# T-081: `/admin/errors` — план реализации

- **Дата**: 2026-09-28
- **Задача**: T-081 / ALTE-146 (`01a0e6dc-17f8-7389-a28b-85985c691ec8`)
- **Источник**: `docs/backlog/tasks/T-081-admin-errors-health.md`, blob
  `efea1a797ec93f6a57fa61156ab237442c7a76e7`
- **Baseline**: `origin/app` `aeba40c1d994f985e897a82de0e1b0092aa9d5bb`
- **Ветка / worktree**: `feat/t081-admin-errors-health`, `.worktrees/t081`
- **Спецификации**: `docs/spec/40-admin/errors-and-health.md`,
  `docs/spec/80-observability/error-collector.md`

## Цель и архитектура

Раздел использует неизменяемую `backend_error_events` как источник вхождений и уже созданные
`backend_errors` / `backend_error_status_history` как рабочую проекцию группы. Запись нового
вхождения атомарно обновляет проекцию и возвращает решённую группу в `new`. GraphQL-модуль админки
отдаёт журнал, карточку, статистику, историю health и CSV; мутации статуса используют optimistic
version по `updatedAt` и пишут `admin.change`.

История здоровья сохраняет только смены снимка `/health` в отдельной append-only таблице без
секретов. Nuxt-страницы используют SSR-safe `useAsyncData`, URL-фильтры и существующие правила
доступа `admin`/`owner`; клиентские ошибки показаны отдельно и не получают рабочий статус.

## Глобальные ограничения

- Техническая история ошибок не изменяется и не удаляется.
- В журнале, GraphQL и CSV нет e-mail, IP, токенов, тела запроса и идентификатора пользователя.
- CSV не содержит сообщения и стека; экспорт пишет `stats.export` и использует действующий лимит
  `admin.export.user`.
- Настройки и управление провайдерами не входят в задачу; отображаются только состояние и имя
  адаптера из `/health`.
- Роли `analyst`, `moderator`, `editor` получают `FORBIDDEN`; маршрут закрывается middleware.

## UI-направление

- **Палитра**: paper `#fafafa`, ink `#18181b`, line `#d4d4d8`, healthy `#047857`, degraded
  `#b45309`, down `#b91c1c`; цвет означает только состояние.
- **Шрифт**: Bergamasco для названия раздела, текущий sans для управления, monospace для
  `requestId`, кода и маршрута.
- **Композиция**: `health pulse → tabs → filters → operational table`; на телефоне таблица
  превращается в список, стек остаётся только в карточке desktop.
- **Signature**: узкая «лента пульса» зависимостей с последней проверкой. Она заменяет типовой ряд
  больших KPI-карточек и сразу отвечает на главный вопрос дежурного: что именно недоступно.

## Review focus

1. Новое вхождение решённой сигнатуры возвращает рабочий статус в `new` и не изменяет событие.
2. Параллельная смена статуса со старым `updatedAt` возвращает `CONFLICT` и свежую карточку.
3. Поиск `requestId` находит только связанную группу; CSV не содержит `stack`/`message`.
4. Клиентская вкладка не допускает смену рабочего статуса.
5. Недоступный health API сохраняет последнюю историю, а экран помечает её устаревшей.

## Порядок TDD

### 1. Рабочая проекция и история health

- [ ] Добавить падающие тесты `server/tests/admin-errors.test.ts` для upsert группы, автоматического
      возврата `resolved → new`, допустимых переходов, конфликта и аудита `admin.change`.
- [ ] Добавить падающий database test миграции для append-only health snapshots.
- [ ] Расширить Prisma-схему и миграцию; обновить `createPrismaErrorHistory.append` транзакционным
      upsert рабочей группы.
- [ ] Реализовать `server/src/admin/errors.ts` и узкий writer истории health.
- [ ] Запустить целевые server tests до зелёного результата.

### 2. GraphQL-контракт и безопасный CSV

- [ ] Добавить падающий schema-contract test для `errorLog`, `errorEntry`, `errorStats`,
      `healthHistory`, `setErrorWorkStatus`, `resolveErrors`, `exportErrors`.
- [ ] Реализовать `server/src/graphql/errors-admin/schema.graphql` и `resolver.ts`.
- [ ] Покрыть роли, фильтры, пагинацию, поиск по `requestId`, статистику и CSV без стеков.
- [ ] Запустить server tests и `pnpm codegen`.

### 3. Сохранение истории `/health`

- [ ] Добавить падающий тест `server/tests/health-history.test.ts`: сохраняется первая проверка и
      каждое изменение, повтор одинакового состояния не дублируется.
- [ ] Подключить writer в `createHealthAlerts`/`server.ts`; сбой истории не ломает readiness.
- [ ] Запустить health tests и server build.

### 4. Nuxt UI

- [ ] Добавить падающие тесты фильтров/состояний страницы и middleware.
- [ ] Добавить GraphQL operations, `useAdminErrors`, middleware `admin-errors`, страницы списка и
      карточки, словари ru/en.
- [ ] Реализовать вкладки «Журнал / Графики / Состояние», loading/empty/error/conflict/rate-limit,
      degraded banner, смену статуса и скачивание CSV.
- [ ] Проверить мобильный список без стеков, desktop-карточку, focus states и SSR hydration.

### 5. Приёмка

- [ ] Добавить Playwright `web/tests/e2e/81-admin-errors-health.spec.ts`, воспроизводящий все строки
      §9 спецификации и запрет ролей.
- [ ] Выполнить `pnpm format`, `pnpm lint`, `pnpm codegen --check`, `pnpm test`, server `build:ci`,
      web `typecheck`, `build` и целевой Playwright.
- [ ] Провести security review границ доступа/данных; зафиксировать полный tested SHA, CI и PR.

## Критерии готовности

| Критерий                                               | Доказательство                                       |
| ------------------------------------------------------ | ---------------------------------------------------- |
| Строки состояний `errors-and-health.md` воспроизводимы | Nuxt tests + `81-admin-errors-health.spec.ts`        |
| Смена статуса пишет `admin.change`                     | `server/tests/admin-errors.test.ts`                  |
| CSV не раскрывает стек                                 | server contract test + Playwright download assertion |
| Health/provider history доступна без секретов          | health history и GraphQL tests                       |

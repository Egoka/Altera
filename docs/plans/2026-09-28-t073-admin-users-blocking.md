# План T-073: раздел «Пользователи» — карточка с аудитом чтения, блокировка = архив, восстановление

- **Задача**: T-073 (native ALTE-140), источник `docs/backlog/tasks/T-073-admin-users-blocking.md`
  ревизии `7d10987d0c6beb445a98873f37b1f52edb96d8aa`; файл источника на baseline
  `d48eb5598db0bdfd523e187cf0a015b39ccb2ab0` совпадает байт в байт.
- **Baseline**: `origin/app` `d48eb5598db0bdfd523e187cf0a015b39ccb2ab0`, ветка
  `admin/t073-users-blocking`, рабочее дерево `.worktrees/t073`.
- **Источники решений**: журнал §26.6, §26.9, §27.1, §28.7, §38, #4, #6, #22, #30, #48, #50;
  `docs/spec/40-admin/users.md`, `docs/spec/10-flows/archive-account.md`,
  `docs/spec/10-flows/email-change-and-recovery.md` (Р2); матрица #6, #52, #80, #81, #104, #105, #113.

## 1. Что уже есть на baseline

- Самостоятельный архив аккаунта (`server/src/account/archive.ts`, T-045) — транзакция с отзывом
  сессий и каскадом статей с актором-автором.
- Служебные записи (`server/src/admin/staff.ts`, T-069) — список маской, карточка с полным адресом
  и записью `admin.read.personal`, архив и восстановление служебной записи.
- Маска адреса `server/src/admin/personal-data.ts`; реестр audit-кодов `server/src/audit/registry.ts`
  уже содержит `user.archive`, `user.restore`, `user.sessions.revoke`, `user.email.change`,
  `admin.read.personal`.
- `restoreArticle` (`server/src/graphql/article/resolver.ts`) уже отказывает автору, если статью
  архивировал сотрудник, — критерий №2 опирается на актора каскада.
- Черновые запросы `users(...)` и `adminUser(id)` в `server/src/graphql/user/` отдают полный
  `AccountUser`, пишут `admin.read.personal` на каждую строку списка и не знают ни маски, ни
  фильтров раздела. Веб их не вызывает; страницы `/admin/users` — моки.

## 2. Решения этого захода

1. **Категории причины** берутся из журнала §38 п. 1 — четыре утверждённых названия, новых не
   вводим: «Нарушение правил публикации», «Спам и накрутка», «Нарушение закона или чужих прав»,
   «Угроза безопасности».
2. **Схема**: enum `AccountArchiveReasonCategory` и колонки `archiveReasonCategory`,
   `archivePublicMessage` у `users`. Внутренняя причина остаётся в существующем `archiveReason`.
3. **Контракт раздела** — новый модуль `server/src/graphql/admin-users/`: `adminUsers(filters,
   pagination)` (маска, без аудита) и `adminUser(id)` (полный адрес, запись аудита). Черновые
   `users`/`adminUser` из модуля `user` снимаются: список с записью аудита на каждую строку
   противоречит §8 утверждённой `users.md`.
4. **Письма** о блокировке и восстановлении не вводятся: состав писем отложен проходом почты
   (§25.13), и задача их в критериях не требует.
5. **Оспаривание** (T-061) и «удалить навсегда» (T-076) в раздел не добавляются; вкладка
   оспаривания остаётся вне scope.

## 3. Шаги

1. Миграция `server/prisma/migrations/20260929120000_account_archive_reason_category` + схема Prisma.
2. Сервис `server/src/admin/users.ts`: список с фильтрами, сортировками, поиском от трёх знаков и
   записью `admin.read.personal` на поиск по адресу; карточка; `archiveAccount` (`admin`/`emergency`)
   одной транзакцией; `restoreAccount`; `revokeUserSessions`; `adminChangeEmail`.
3. GraphQL: `server/src/graphql/admin-users/{schema.graphql,resolver.ts}`; снятие черновых запросов.
4. Веб: операции `web/app/graphql/operations/admin/users.graphql`, кодоген, composable
   `useAdminUsers`, middleware `admin-users`, страницы списка и карточки `/admin/users/{id}`,
   ключи `ru.json`/`en.json`.
5. Тесты: `server/tests/admin-users.test.ts` (критерии №1–2), `server/tests/admin-users-database.test.ts`
   (каскад и отзыв сессий на настоящем PostgreSQL), `web/tests/admin-users-page.nuxt.test.ts`,
   Playwright `web/tests/e2e/73-admin-users.spec.ts` (строки состояний §9 — критерий №3).
6. Проверки `pnpm format`, `pnpm lint`, `pnpm test`, сборки сервера и веба, `typecheck`, целевой
   прогон Playwright; отчёт `docs/reports/2026-09-28-t073-admin-users-blocking-report.md` и receipt.

## 4. Риски

- Снятие черновых `users`/`adminUser` меняет `server/tests/admin-pd-audit.test.ts`: тест
  переписывается на утверждённый контракт (список — маска без аудита, карточка — аудит), а не
  ослабляется.
- Playwright требует поднятой локальной базы (`docker compose up -d postgres`) и миграций;
  миграции применяются только к локальной изолированной базе, не к development Neon.

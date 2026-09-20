# T-074 — Администраторы: служебные записи, роли, владелец в два шага, исключения, архив

- **Задача**: `docs/backlog/tasks/T-074-admin-admins-owner-two-step.md`
- **Native issue**: ALTE-94
- **Эпик**: E-11 «Админка I»
- **Baseline**: `4ea27a63d0fac9ccc9eb38cde522d9b17b58799b` (`origin/app`)
- **Ветка**: `feat/t074-admin-admins`

## Что сделано

Раздел `/admin/admins` и серверный модуль служебных записей по
`docs/spec/40-admin/admins.md`, `docs/spec/10-flows/appoint-admin.md` и
`docs/spec/50-access/escalation-and-demotion.md`.

### Сервер

`server/src/admin/staff.ts` — запросы `adminStaff`, `adminStaffMember`, `owners` и мутации
`createStaff`, `changeStaffRole`, `revokeStaffRole`, `assignOwner`, `revokeOwner`,
`deactivateOwner`, `archiveStaffAccount`, `restoreStaffAccount`
(`server/src/graphql/staff/`). Правила, которые закреплены кодом:

- Служебная запись создаётся отдельно: e-mail действующего читателя или автора даёт
  `VALIDATION_ERROR`, занятый служебный адрес — `CONFLICT` (журнал #46–47).
- Создание доступно `admin` и `owner` (право `accounts`); смена и снятие роли, владельцы,
  архив и восстановление — только `owner` (журнал #7, #13, §26.7).
- Роль `owner` не выдаётся при создании: запись получает её только вторым шагом
  `assignOwner` для уже существующей служебной записи (журнал §26.7).
- Отзыв и деактивация владельца идут в транзакции с проверкой «остаётся ≥ 1 владельца» —
  иначе `CONFLICT` и откат (журнал #10).
- Роль себе не меняют и не снимают (`escalation-and-demotion.md` п. 5).
- Смена роли выполняется условным `updateMany` по прежней роли: параллельное изменение
  другим владельцем даёт `CONFLICT`, а не тихую перезапись (`admins.md` §9).
- Деактивация и архив закрывают доступ и отзывают сессии; снятая роль оставляет запись
  служебной без прав (`role = reader`, `isServiceAccount` сохраняется) — временное
  допущение до решения по Q-08.
- Аудит: `user.create.staff` (адрес — хэшем), `user.role.change` (`targetId`, `before`,
  `after`), `role.assign.owner` / `role.revoke.owner` / `owner.deactivate`
  (`remainingOwners`), `user.archive` / `user.restore`, `admin.read.personal` при открытии
  карточки.
- Письмо входа новой записи ставится после создания через общий `issueMagicLink`
  (`server/src/auth/magic-link.ts`, выделен из резолвера `requestMagicLink`): недоступная
  почта даёт `PROVIDER_UNAVAILABLE`, но созданную запись не отменяет.

### Веб

`web/app/pages/admin/admins/index.vue`, `web/app/composables/useAdminStaff.ts`,
`web/app/utils/adminStaffFilters.ts`, операции `web/app/graphql/operations/admin/staff.graphql`
и словари `admin.staff.*` в обеих локалях. В списке адрес маскирован, в карточке — полный,
с историей ролей, исключениями и числом сессий. Фильтры «роль», «статус», «есть исключения»,
«срок исключения» и поиск сохраняются в адресе страницы. Назначение владельца выполняется
двухшаговым подтверждением с вводом точного e-mail записи.

## Как проверено

Все команды выполнены на ревизии ветки в `/.worktrees/t074-admins`, Node 24.12.0, pnpm 10.18.3.

| Проверка           | Команда                                                 | Результат                                              |
| ------------------ | ------------------------------------------------------- | ------------------------------------------------------ |
| Форматирование     | `pnpm format`                                           | exit 0                                                 |
| Линтер             | `pnpm lint`                                             | exit 0                                                 |
| Тесты              | `pnpm test`                                             | server 294 passed / 24 skipped; web 195 passed; exit 0 |
| Сборка сервера     | `pnpm --filter server run build:ci`                     | exit 0                                                 |
| Типы и сборка веба | `pnpm --filter nuxt-app run typecheck`, `run build`     | exit 0                                                 |
| Playwright раздела | `npx playwright test tests/e2e/22-admin-admins.spec.ts` | 8 passed                                               |

Критерии задачи:

| Критерий                                                   | Проверка                                                                                                                                                  | Результат                                                                                                                                                                                                 |
| ---------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| AC-1: попытка оставить ноль владельцев → `CONFLICT`        | `server/tests/admin-staff.test.ts`, блок «инвариант «не ноль владельцев»»                                                                                 | passed — отзыв и деактивация дают `CONFLICT` с `expected: at-least-one`, аудит не пишется; при двух владельцах оба действия проходят                                                                      |
| AC-2: назначение владельца завершается только вторым шагом | `server/tests/admin-staff.test.ts` «назначение владельца в два шага»; `web/tests/admin-admins-page.nuxt.test.ts`; `web/tests/e2e/22-admin-admins.spec.ts` | passed — `createStaff` с ролью `owner` даёт `FORBIDDEN` и не создаёт запись; владельцев прибавляется только после `assignOwner`; в интерфейсе мутация не уходит ни на первом шаге, ни при неточном e-mail |
| AC-3: строки состояний `admins.md` §9 воспроизводимы       | `web/tests/e2e/22-admin-admins.spec.ts`                                                                                                                   | passed — загрузка, пусто, ошибка с `requestId`, ограничение прав `admin`, конфликт; строка «лимит» проверена как неприменимая (ограничений в разделе нет)                                                 |

Локально не запускались сценарии Playwright, которым нужны Postgres и Mailpit из
`docker-compose.yml` (`21-magic-link-mail`, `admin-categories`, `admin-dashboard`,
`app-components-theme`, `noindex-meta`): Docker на машине не запущен, все пять падают на
подключении `PrismaClient` к `127.0.0.1:5432` независимо от изменений этой задачи. Их
результат даёт прогон CI на PR. Preflight (`scripts/autonomy/preflight.py --server`) прошёл
все проверки, кроме `env:LOG_HASH_SECRET`: переменная нужна для запуска сервера, а работа
велась на модульных тестах и сборке, сервер с секретом не поднимался.

## Отклонения и границы

- Мутации архива названы `archiveStaffAccount` / `restoreStaffAccount` вместо общих
  `archiveAccount` / `restoreAccount` из `admins.md` §5: общий архив аккаунтов читателей
  и авторов с оспариванием и экспортом принадлежит T-045/T-073, и занимать это имя из
  задачи о служебных записях было бы преждевременно.
- Карточка открывается панелью на той же странице, а не вложенными маршрутами
  `/admin/admins/new` и `/admin/admins/{id}`: вложенные маршруты помечены в спецификации
  как `[ДОПУЩЕНИЕ]`, а утверждённый маршрут `/admin/admins` с параметрами фильтров
  реализован.
- «Удалить навсегда» не входит в задачу — это T-076.
- Выдача и отзыв исключений выполняются уже существующими мутациями
  `grantException` / `revokeException` (T-028); карточка показывает действующие исключения,
  отдельной формы выдачи в этой задаче нет.
- Судьба служебной записи после снятия роли остаётся открытой (OPEN-QUESTIONS #8, Q-08):
  запись остаётся служебной без прав — временное допущение спецификации, не новое правило.

## Замеченное рядом (не исправлялось)

- `web/app/pages/admin/grants/index.vue` и `web/app/pages/admin/subscriptions/index.vue`
  используют компонент `<Modal>`, которого нет ни в `fishtvue`, ни в `app/components`:
  разметка диалогов рендерится всегда, а не по `v-model`. В этой задаче применён
  `AppDialog`; исправление страниц выдач — отдельная задача.
- `useAdminGrants` вычисляет `failed` как `error.value !== null`, тогда как Nuxt 4
  оставляет `error` равным `undefined` до ошибки. На странице выдач это значение уходит
  лишь в свойство таблицы, поэтому видимого эффекта нет; в `useAdminStaff` использовано
  `Boolean(error.value)`.

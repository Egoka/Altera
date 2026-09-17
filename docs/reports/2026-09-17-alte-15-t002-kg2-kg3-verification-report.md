# Отчёт: ALTE-15 (T-002 KG-2+KG-3) — критерии уже выполнены на текущем `app`

- **Задача**: ALTE-15 (дочерняя от ALTE-12 / T-002), стадия 1
- **Проверенный коммит**: `312fb7589f9de2c4d788e910540e1ec821ec614c` (origin/app)
- **Изменения в коде**: нет — это отчёт о верификации, не о разработке

## Контекст

ALTE-15 стояла в `blocked` с 2026-09-14. Единственный комментарий на задаче (разработчик,
2026-09-14T19:58:29Z) зафиксировал: на baseline `85d3af44` контрактный тест KG-2 нашёл RED —
`User.email` и `User.role` были доступны на публичном GraphQL-типе, и разработчик остановил
задачу, посчитав, что privacy GREEN требует продуктового результата T-027 (модуль видимости).
T-027 зависит от T-026, ни одна из них не начата (`docs/backlog/matrix.md`).

## Находка

На текущем `app` требования KG-2 и KG-3 **уже выполняются существующими тестами**, добавленными
позже независимо от T-026/T-027 — как побочный эффект схемы `User`/`AccountUser`, введённой T-013
(PR #54, «имя, хэндл, аватар, основной язык аккаунта»):

**KG-2** («схема GraphQL собирается без ошибок; ни один публичный тип не содержит поле `email`»):
`server/tests/public-schema-contract.test.ts`

- `assembles every SDL file into a valid schema` — `validateSchema(schema)` даёт `[]`.
- `exposes the public handle without account fields or the legacy slug` — явно проверяет, что
  публичный тип `User` не содержит `email`, `role`, `planTier`, `sessions`, `slug`.

Проверка `email`/`role` появилась в PR #54 (T-013, `70fd464`), исходный SDL-тест — в PR #29
(`0c0a6f6`). `email` в текущей SDL существует только на `AccountUser`
(`server/src/graphql/user/schema.graphql:41`), который отдают лишь `Query.me`
(`ensureAuthenticated`) и `Query.users` (`ensureHasRole(..., "admin", ...)`) — оба закрыты
авторизацией; `Query.user(handle)`/`Query.author(handle)` возвращают `User` без `email`/`role`.

**KG-3** («Playwright smoke: открывает `/`, проверяет заголовок; конфигурация и CI-шаг включены»):
`web/tests/e2e/homepage.smoke.spec.ts` (введён PR #21) — открывает `/`, проверяет `toHaveURL`,
видимость ссылки `Altera` и `toHaveTitle("Altera")`. Подключён через `web/playwright.config.ts`
(`testDir: "./tests/e2e"`) и уже выполняется CI-шагом «Браузерная проверка веба» на каждом PR.

## Как проверено

| Проверка | Результат |
| --- | --- |
| `pnpm --filter server exec vitest run tests/public-schema-contract.test.ts` | PASS — 3/3, включая проверку отсутствия `email`/`role` на `User` |
| `pnpm test` (полный прогон, тот же коммит) | PASS — server 125 passed + 16 skipped, web 132 passed |
| `git log --follow` на оба файла | подтверждает происхождение (PR #21, #29, #54) вне scope T-026/T-027 |
| Ручной аудит `server/src/graphql/user/schema.graphql` и `user/resolver.ts` | `email` только на `AccountUser`; `me`/`users` гейтятся `ensureAuthenticated`/`ensureHasRole(admin)` |

## Итог

Обе цели ALTE-15 (KG-2, KG-3) наблюдаемо выполнены на `app` без ожидания T-026/T-027 — новый код
не потребовался, только верификация существующего покрытия. Перевожу задачу в `in_review`;
финальный `done` — по канонической процедуре приёмки владельца/контроллера.

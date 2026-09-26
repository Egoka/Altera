# План T-123: исправления входа по одноразовой ссылке

- **Задача**: `docs/backlog/tasks/T-123-login-link-fixes.md`
  (source revision `cc89c28fd055299bcf3c7c1d97a8863d47844407`)
- **Native issue**: ALTE-116 (`01a0df5b-a265-7389-8f82-d71c4f2b2e1b`)
- **Эпик**: E-04 «Вход, сессии и лимиты»
- **Baseline `origin/app`**: `cc89c28fd055299bcf3c7c1d97a8863d47844407`
- **Ветка**: `server/t123-login-link-fixes`
- **Доработка после ревью**: T-022 (ALTE-57, PR #164),
  `docs/reports/2026-09-26-in-review-acceptance-report.md` строка T-022
- **Источники**: журнал #48, §25.7; ADR-0009, ADR-0023; `docs/spec/10-flows/register-and-login.md`,
  `docs/spec/20-public/verify.md` §3, §5, §8; `docs/spec/50-access/session-lifecycle.md` п. 1, 7

## Что уже есть и чего нет

`verifyMagicLink` разбирает четыре исхода и гасит токен; `acceptConsent` завершает вход через
тот же `completeLogin`, но архив аккаунта не проверяет — административно заблокированный
получает полноценную сессию. BFF отклоняет любую мутацию с `sec-fetch-site: cross-site`, а SSR
страницы `/auth/verify` пересылает заголовки исходной навигации, поэтому переход из веб-почты
даёт 403. `Set-Cookie` BFF ставится на внутреннем подзапросе Nitro и в ответ навигации не
попадает — после входа refresh-cookie в браузере нет. Отметка `usedAt` пишется безусловным
`update` после отдельного чтения, то есть два параллельных обмена одного токена проходят оба.

## Решение по §7 [ДОПУЩЕНИЕ]

Выбрано исключение для обмена токена, а не промежуточный экран: AC-2 требует, чтобы открытие
ссылки завершало вход, а «межсайтовая мутация, не являющаяся обменом токена» продолжала
отклоняться. Полномочие в `verifyMagicLink` и `acceptConsent` даёт секрет в теле запроса, а не
ambient cookie браузера, поэтому CSRF на них не действует. Исключение сужено тремя условиями,
чтобы им нельзя было прикрыть чужую мутацию:

1. все корневые поля операции — только `verifyMagicLink` и `acceptConsent` (батч с любой другой
   мутацией исключения не получает);
2. тип тела — `application/json` (обычная форма со чужого сайта его без CORS не отправит);
3. `sec-fetch-mode` — `navigate` или отсутствует (фоновый запрос со чужой страницы им не является).

## Что делаю

1. **`server/src/graphql/auth/resolver.ts`**
   - `consumeToken` — условный `updateMany({ id, usedAt: null })` с проверкой числа строк;
     нулевой счёт отвечает как использованный токен (`NOT_FOUND`, лог `reason: "used"`).
     Через него проходят `completeLogin` и ветка `archived_self`.
   - `archivedOutcome` — общая ветка архива для `verifyMagicLink` и `acceptConsent`:
     административный архив — без сессии, с `appealToken`, токен не гасится (журнал #48);
     самостоятельный — ограниченная сессия (`session-lifecycle.md` п. 7).
   - `acceptConsent` вызывает её сразу после чтения пользователя, до записи согласия.
2. **`web/server/utils/sessionCookie.ts`** — `isLoginTokenExchange(fields, headers)` по трём
   условиям выше; `isSameOriginMutation` остаётся без изменений для всех прочих мутаций.
3. **`web/server/api/graphql.post.ts`** — проверка происхождения пропускается только для обмена
   токена входа.
4. **`web/app/composables/useGraphQL.ts`** — на SSR запрос уходит через `$fetch.raw` с теми же
   заголовками и контекстом, что даёт `useRequestFetch`, а `Set-Cookie` внутреннего подзапроса
   переносится в ответ навигации (`appendResponseHeader`). Клиентская ветка не меняется, импорт
   `h3` лежит внутри серверной ветки и в клиентскую сборку не попадает.

## Проверки по критериям

- **AC-1**: `server/tests/auth-magic-link.test.ts` — `acceptConsent` для административного архива
  (нет сессии, исход `archived_admin`, согласие не записано) и для самостоятельного
  (`archived_self`, ограниченная сессия).
- **AC-2**: `web/tests/session-cookie.test.ts` — `isLoginTokenExchange` на обмене, на батче с
  чужой мутацией, на форменном типе тела и на фоновом запросе; Playwright — переход с чужого
  origin (`sec-fetch-site: cross-site`) завершает вход, а межсайтовая `logoutAll` даёт 403.
- **AC-3**: тот же Playwright-сценарий на настоящем сервере — после `/auth/verify` в контексте
  браузера есть httpOnly `altera_refresh`, и он недоступен из JavaScript.
- **AC-4**: `server/tests/auth-magic-link-database.test.ts` на PostgreSQL 17 (`T123_TEST_DATABASE_URL`,
  новый шаг CI) — два параллельных `verifyMagicLink` одного токена дают не больше одной сессии;
  в двойнике та же гонка проверяется на `updateMany`.

## Не делаю

- Обновление access-токена на клиенте — T-124; лимиты частоты — T-125; имя нового аккаунта —
  T-126; вход по паролю — T-115.
- Контракт операций `verifyMagicLink` / `acceptConsent`, имена и флаги cookie ADR-0023 не меняю.

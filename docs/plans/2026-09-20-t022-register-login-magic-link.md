# T-022: регистрация и вход по ссылке — план реализации

- **Дата**: 2026-09-20
- **Ветка**: `feat/t022-register-login`
- **Задача**: T-022 / ALTE-57 (native issue `01a0ab35-9d73-723f-bbb2-cf9c5db7a7df`)
- **Базовый коммит**: `4ea27a63d0fac9ccc9eb38cde522d9b17b58799b`
- **Исходное дерево**: clean (отдельный worktree `.worktrees/t022-auth`)
- **Отчёт**: `docs/reports/2026-09-20-t022-register-login-magic-link-report.md`

**Цель:** довести вход по ссылке из письма до состояния, описанного
`docs/spec/10-flows/register-and-login.md`, `docs/spec/20-public/login.md` и
`docs/spec/20-public/verify.md`: страница `/login`, страница `/auth/verify`, ветки согласия и
архива, ответ без раскрытия существования аккаунта, логи `auth.link.requested` / `auth.login` /
`auth.login.failed`.

## 1. Контракт и границы

Старшинство источников: журнал решений (#4, #48, §5.2, §20.11, §25.1) → спецификации страниц и
`50-access/session-lifecycle.md` → ADR-0022, ADR-0023, ADR-0024, ADR-0028, ADR-0032.

Инварианты:

1. Ответ `requestMagicLink` одинаков для существующего и неизвестного адреса: одна форма
   результата, одинаковые поля, отсутствие побочного различия в задержке ветвления.
2. Аккаунт создаётся при подтверждении ссылки (§25.1, `session-lifecycle.md` п. 2), а не при
   запросе: запрос по неизвестному адресу не оставляет учётной записи.
3. Токен входа хранится хэшем, живёт 15 минут, одноразовый; повторный запрос по тому же адресу
   отзывает прежний токен (`login.md` §7).
4. `next` — только относительный путь, переносится внутри записи токена, а не открытым
   параметром ссылки (`verify.md` §3).
5. Ветки архива: `self` — ограниченная сессия и переход на `/me/archived`; `admin`/`emergency` —
   сессии нет, переход на `/auth/appeal?token=` (`session-lifecycle.md` п. 7).
6. Устаревшее согласие даёт экран повторного согласия и `acceptConsent` (п. 9).

Не входит: ротация refresh, выход и обнаружение повторного предъявления (T-023); лимиты частоты
(T-024); сама страница `/me/archived` (T-035); форма оспаривания `/auth/appeal` (T-061);
страницы `/legal/*` и механизм версий юридических текстов (T-101).

## 2. Шаги

1. **Схема хранения.** `MagicLinkToken` перестаёт быть привязан к `User` и ключуется адресом:
   `email @unique`, `locale`, `next`, принятые версии согласия. `Session` получает флаг
   `limited` для ограниченной сессии самостоятельно архивированного аккаунта. Отдельная
   миграция; контракт-тест схемы обновляется под новые инварианты.
2. **Резолверы.** `legalVersions(locale)`, `requestMagicLink(email, consentVersion, locale, next)`
   → `MagicLinkRequestResult`, `verifyMagicLink(token)` → размеченный результат
   (`authenticated` / `consent_required` / `archived_self` / `archived_admin`), `acceptConsent`.
   Логи `auth.link.requested`, `auth.login`, `auth.login.failed` с `reason`.
3. **Страницы.** `web/app/pages/login.vue` и `web/app/pages/auth/verify.vue` по таблицам
   состояний обеих спецификаций; `noindex`; редиректы `/signup`, `/register` на `/login`.
4. **Сессия в браузере.** Обмен токена выполняется на SSR, сессия кладётся в httpOnly-cookie
   через BFF, прокси подставляет её в `Authorization`. Ротация и выход остаются за T-023.
5. **Проверки.** Юнит-тесты резолверов (AC-2 и ветки состояний), Playwright по таблице
   состояний `login.md` и `verify.md` (AC-1) и сценарий flow #1 с архивированным аккаунтом
   (AC-3).

## 3. Способ проверки

`pnpm format`, `pnpm lint`, `pnpm test`, `pnpm --filter server run build:ci`,
`pnpm --filter nuxt-app run build`, `pnpm --filter nuxt-app run typecheck`. Playwright и
миграционные тесты требуют PostgreSQL и Mailpit — их результат берётся из прогона CI на head
ветки, локальный Docker в этом runtime недоступен.

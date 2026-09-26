# T-126 — имя аккаунта не выводится из локальной части e-mail

- **Дата**: 2026-09-27
- **Карточка**: ALTE-120 (`01a0df5d-fbbc-7a58-a77c-6852fd8ff27e`), Task ID T-126
- **Постановка**: `docs/backlog/tasks/T-126-account-name-not-from-email.md`
  (blob `cc89c28fd055299bcf3c7c1d97a8863d47844407`)
- **Baseline**: `e0cf4f27282bb296329198ea5fd94bc634706782` (свежий `origin/app` на начало захода)
- **Tested SHA**: `ee2b5bb2b24327f499fc05ffd03ea001d93fb442`
- **PR**: [#238](https://github.com/Egoka/Altera/pull/238), merge `53ac1c16bd8df7f27a6ff1ffbdd38ae46d694294`
- **Ветка**: `server/t126-account-name` (удалена после слияния),
  рабочее дерево `/Users/egorbondarenko/WebstormProjects/Altera/.worktrees/t126-account-name`

## Что было не так

Регистрация по ссылке входа заполняла имя нового аккаунта локальной частью адреса:
`name: record.email.split("@")[0]` в `server/src/graphql/auth/resolver.ts` (введено PR #54,
T-013). ADR-0018 п. 3 это запрещает прямо: e-mail не попадает ни в хэндл, ни в имя, ни в
адреса страниц. Имя публично — его показывают `user(handle)`, `AuthorProfile` и ленты, поэтому
адрес почты читателя оказывался на публичной странице автора и в подписях карточек.

## Что сделано

1. **Регистрация имени не придумывает.** Новый аккаунт заводится с пустым именем
   (`EMPTY_ACCOUNT_NAME` в `server/src/visibility/display-name.ts`). Выбор хранения —
   пустая строка, а не `NULL`: тип `name` в схеме Prisma остаётся `String`, ни одна из
   десятков читающих его веток не получает нового варианта значения, а видимое поведение
   задаёт AC-3, как и оговорено в постановке (`[ДОПУЩЕНИЕ]` §7).
2. **Миграция `20260927120000_account_name_not_from_email`** очищает имена уже заведённых
   аккаунтов, равные локальной части собственного адреса. Сравнение без учёта регистра:
   «Ivan.Petrov» при `ivan.petrov@example.test` — тот же адрес, записанный другим регистром.
   Совпадение с чужой локальной частью и выбранные имена не трогаются.
3. **Публичные ответы вместо пустого имени показывают хэндл** — общий помощник
   `publicDisplayName(name, handle)`:
   - поле `name` публичного типа `User` (страница автора по хэндлу, автор материала,
     `popularAuthors`, `topAuthors`) — резолвер поля в `graphql/user/resolver.ts`;
   - `AuthorProfile` (`graphql/author/resolver.ts`);
   - ленты (`graphql/feed/resolver.ts`);
   - каталог авторов и подписи превью (`graphql/catalog/resolver.ts`): в выборку добавлен
     хэндл рядом с именем;
   - карточки закладок (`bookmarks/service.ts`).

   Личный кабинет (`AccountUser`, запрос `me`) подстановки не получает: своё пустое имя
   владелец аккаунта должен видеть пустым и заполнить его в профиле.

## Критерии

| AC   | Результат | Доказательство                                                                                                                                                                              |
| ---- | --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| AC-1 | passed    | `server/tests/auth-magic-link.test.ts`, «does not derive the account name from the address»: обмен ссылки на `ivan.petrov@example.test` создаёт аккаунт с `name === ""`, не `"ivan.petrov"` |
| AC-2 | passed    | `server/tests/account-name-migration-database.test.ts` на PostgreSQL: после миграции имя от своего адреса пусто (в том числе в другом регистре), чужой однофамилец и выбранное имя целы, контрольный запрос «имя = локальная часть своего адреса» пуст |
| AC-3 | passed    | `server/tests/author-page.test.ts` («без имени подписывается хэндлом…», «автор без имени подписывает карточки хэндлом»), `server/tests/account-display-name.test.ts`, `server/tests/public-catalogs.test.ts` («автор без имени показан хэндлом…») |

## Проверки

Локально на tested SHA: `pnpm install --frozen-lockfile` exit 0; `pnpm format` exit 0;
`pnpm lint` exit 0; `pnpm test` exit 0 (server 818 passed / 36 skipped, web 582 passed,
`@altera/content` 99 passed); `pnpm --filter server run build:ci` exit 0;
`T126_TEST_DATABASE_URL=… pnpm exec vitest run tests/account-name-migration-database.test.ts`
exit 0 на локальном PostgreSQL (docker-compose, порт 25432).

RED подтверждён для миграции: с пустым телом `migration.sql` тот же тест падает на строках
`derived` и `derived-case` — проверка ловит именно правило, а не совпадение.

CI прогона [36279975204](https://github.com/Egoka/Altera/actions/runs/36279975204) на tested
SHA: «Формат, линт и тесты» pass (server 76 файлов passed / 17 skipped, web 53 passed,
content 4 passed), «Сборка сервера и дымовая проверка старта» pass — в том числе новый шаг
«Проверить миграцию имён аккаунтов T-126» (1 passed на PostgreSQL 17 сервиса job),
«Сборка и типизация веба» pass, «Браузерная проверка веба» pass, агрегат `test` pass.

## Изменённый тест

`server/tests/profile-handle-allocation.test.ts` проверяет повтор занятого случайного хэндла,
а не происхождение имени, и ожидал `name: "reader"` для `reader@example.test`. Ожидание
приведено к новому поведению (`name: ""`); сама проверка повтора не ослаблена.

## Остаток

- Независимое ревью tested SHA и приёмка — вне этого захода; `done` ставит координатор.
- Экран правки профиля и проверка имени перед первой публикацией — T-031, не входили в границы.
- Закрытие публичного `user(handle)` — отдельная задача, не входило в границы.
- Правило «пустое имя показывается хэндлом» пока живёт только в коде и тестах: строка
  спецификации страницы автора (`docs/spec/20-public/author.md` §4) — за стадией документации.
- Приёмка возвращённой T-013 (ALTE-36) проходит в своей карточке после приёмки этой задачи.

Receipt: [docs/reports/tasks/T-126.md](tasks/T-126.md), [T-126.json](tasks/T-126.json).

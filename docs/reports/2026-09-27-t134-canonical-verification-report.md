# Отчёт: T-134 в канонической карточке ALTE-126 — сверка критериев и один итог

- **Дата**: 2026-09-27
- **Задача**: T-134 «Письма /admin/mail: без ПД в списке и без обхода аудита карточки»
- **Карточка Multica**: ALTE-126 (`01a0e1c9-7831-75f4-9e09-b106ffb81fa9`) — каноническая карточка T-134
- **Исполнитель**: Altera — разработчик (`b0f3bc32-dd95-471e-b40e-517aaf83edf0`), run `01a0e1d7-7b1a-7e27-855c-ddd7f1f0fa56`
- **Источник**: `docs/backlog/tasks/T-134-admin-mail-pd-in-list.md` (blob `784ca04d841de918f1339dc16d72e5a2d90dfb61`)
- **Baseline захода**: `origin/app` `2093e49e5407f7340e0b08afb4bdd769914ad00b`
- **План**: [docs/plans/2026-09-27-t134-canonical-verification.md](../plans/2026-09-27-t134-canonical-verification.md)

## 1. Что было до захода

Продуктовый код T-134 уже в `app`. PR [#230](https://github.com/Egoka/Altera/pull/230), head
`44b70286a1d28ca02a65f9c2171f98a6d93be6c6`, base `f1ed1885`, merge
`9553d2f4c1b32dcd4831ff6f02ae51583b5a6562` (2026-09-26, автослияние по зелёному CI, run
36263253435). Независимый ревьюер (`db94a617-807c-4eec-981f-51fd4b3217d4`, run
`01a0df34-d90c-7822-9f8e-8445a27ea488`) одобрил этот head и не нашёл дефектов.

Заход по реализации шёл в карточке T-080 (ALTE-95): отдельной карточки у доработки тогда не было.
Каноническую карточку T-134 (ALTE-126) создали 2026-09-27, уже после слияния. Контракт контроллера
(`docs/multica/autonomy-controller.md`, «Один итог задачи») требует, чтобы обе native execution
относились к `issue_id` канонического итога, и прямо говорит: run отдельной карточки доверие не
наследует, старый child-review сохраняется ссылкой как история, а актуальный независимый review
выполняется в канонической задаче. Поэтому заход ничего не переписывал в продуктовом коде: менять
в нём нечего, критерии выполнены. Заход сверил критерии на текущей ревизии и привёл канонический
итог к карточке ALTE-126.

## 2. Код не менялся с проверенного head

`git diff 44b70286..2093e49e` по файлам T-134 — `server/src/admin/mail.ts`,
`server/src/admin/personal-data.ts`, `server/tests/admin-mail.test.ts`,
`server/tests/admin-mail-secrets.test.ts`, `server/tests/mail-resend-database.test.ts`,
`web/tests/e2e/22-admin-mail.spec.ts`, `server/prisma/migrations/20260926120000_mail_resend_claim` —
пуст. Проверенный ревьюером код в `app` не менялся, поэтому сверка на текущей ревизии проверяет
именно его.

## 3. Критерии на текущей ревизии

| AC   | Результат | Проверка на `2093e49e`                                                                                                                                                                       |
| ---- | --------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| AC-1 | passed    | `presentMail` отдаёт `body` только при `view === "card"`; в списке всегда `null`. `vitest tests/admin-mail.test.ts tests/admin-mail-secrets.test.ts` exit 0, 29 passed                        |
| AC-2 | passed    | в списке адрес идёт через `maskEmail`, аудита нет; карточка отдаёт полный адрес и пишет `admin.read.personal`; фильтр по получателю пишет `admin.read.personal` с `purpose admin.mail.search`  |
| AC-3 | passed    | `SECRET_MAIL_TEMPLATES` содержит `magic_link` и `email_change_code` (`server/src/admin/mail.ts:20`), `canResend = false`, мутация отвечает `FORBIDDEN`                                        |
| AC-4 | passed    | `claimResend` — один условный `UPDATE ... WHERE "resentAt" IS NULL AND status = 'failed'`. `vitest tests/mail-resend-database.test.ts` на PostgreSQL 16 exit 0, 2 passed                      |

Отдельно проверено требование §3 о кнопках повтора: доступ к повтору идёт через право `job.retry`
(`hasPermission(ctx.currentUser, "job.retry")` в `ensureViewer`, `ensurePermission` в
`ensureRetryPermission`), а не через роль `owner`; веб берёт `viewerCanResend` с сервера.

## 4. Проверки захода

| Команда                                                                              | Exit | Вывод                                                              |
| ------------------------------------------------------------------------------------ | ---- | ------------------------------------------------------------------ |
| `pnpm install --frozen-lockfile`                                                     | 0    | Done in 15.7s                                                      |
| `pnpm format`                                                                        | 0    | All matched files use Prettier code style                          |
| `pnpm lint`                                                                          | 0    | без замечаний                                                      |
| `pnpm test`                                                                          | 0    | server 860 passed / 44 skipped; web 614 passed; `content` 99 passed |
| `vitest run tests/admin-mail.test.ts tests/admin-mail-secrets.test.ts`               | 0    | 2 files, 29 passed                                                 |
| `T134_TEST_DATABASE_URL=… vitest run tests/mail-resend-database.test.ts`              | 0    | 1 file, 2 passed                                                   |

Среда: Node 24.12.0, pnpm 10.18.3, PostgreSQL 16 из `docker-compose` на порту 25432 (собственные
порты Altera). Ветка `docs/t134-canonical-receipt` от `2093e49e` в отдельном рабочем дереве
`.worktrees/t134-admin-mail`; чужие checkout не затронуты.

Границы: локальная база — PostgreSQL 16, в CI на проверенном head — 17. Браузерный набор в этом
заходе не прогонялся: код не менялся, а на проверенном head джоб «Браузерная проверка веба» и
локальный `--grep "admin mail"` (21 passed) зелёные.

## 5. Что изменено в файлах

- `docs/backlog/tasks/T-134-admin-mail-pd-in-list.md` — заполнена `**Проверяемая revision**`.
- `docs/reports/tasks/T-134.json` — `issue_id` канонической карточки ALTE-126, реальный
  `implementer_run_id` этого захода, блок `checks` этого прогона, блок `history` с прежней карточкой
  и прежним вердиктом ревью; `review` возвращён в незаполненное состояние под актуальный вердикт.
- `docs/reports/tasks/T-134.md` — тот же итог в Markdown; `finalization.sha256` пересчитан.
- Планы и отчёт заходов сохранены ссылками, прежний отчёт 2026-09-26 не удалён.

## 6. Остаток

- Независимое ревью в ALTE-126 с маркером `ALTERA_REVIEW_V1` на `44b70286` — за независимым
  ревьюером; исполнитель свою работу не принимает. Прежний вердикт того же SHA сохранён в `history`.
- Выкладка обязательна (PR менял `server/` и добавлял миграцию): probe Render и `/health` того же
  SHA выполняет отдельный актор.
- После приёмки T-134 возвращённая T-080 проходит повторную приёмку в карточке ALTE-95.
- Производные таблицы бэклога (`docs/backlog/matrix.md`, `README.md`, `epics/E-12-admin-2.md`,
  `ready-candidates.md`) держат T-134 в статусе «кандидат» вместе с T-125, T-126, T-128…T-135,
  которые тоже уже слиты. Это общий разрыв, который закрывает проход
  `python3 scripts/backlog/sync_status.py --apply`, а не правка одной строки в этом заходе.
- `docs/vision/00-reality-check.md` в перечне «Кандидаты backlog (T-127–T-134)» всё ещё называет
  T-134 открытым дефектом: «ПД в /admin/mail — `recipientEmail: String` раскрывает e-mail
  получателя [ФАКТ: `server/src/graphql/mail/schema.graphql:25`]». Запись устарела: поле
  `recipientEmail` нулевое, в списке отдаётся маской, а комментарии схемы прямо описывают маску и
  запись чтения ПДн. Срез ведёт T-135, поэтому заход файл не трогал и передаёт разрыв как факт.
- Обезличивание копий писем при удалении аккаунта (журнал §28.8) остаётся за `/me/delete` (§35 п. 1).

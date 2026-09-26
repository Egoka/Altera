# План T-132: иерархия восстановления рубрик, конфликт и права в разделе

- **Задача**: `docs/backlog/tasks/T-132-sections-restore-hierarchy.md`, blob
  `babde820ad49343cfcb00e96ce2ba3b5817e8734`
- **Карточка**: ALTE-83 (`T-070` возвращена независимым ревью 2026-09-26)
- **Источники**: `docs/spec/40-admin/categories.md` §5, §9; журнал решений #1, #2;
  `docs/reports/2026-09-26-in-review-acceptance-report.md` (строка T-070)
- **Baseline**: `d8ee443d17801bcdd27cb9d1dcc30fbb56e74439` (`origin/app`, fetch 2026-09-26)
- **Ветка / worktree**: `server/t132-sections-restore-hierarchy` /
  `/Users/egorbondarenko/WebstormProjects/Altera/.worktrees/t132-sections`

## 1. Что именно возвращено

Ревью зафиксировало, что `restoreSection` (`server/src/taxonomy/service.ts:499-527`) не проверяет
ни статус рубрики, ни `archivedByRole`: `admin` восстанавливает рубрику, заархивированную `owner`,
и «восстанавливает» активную рубрику. Для тегов та же проверка уже есть (`restoreTag`, `:604-607`).
Строки состояний §9 «Нет прав на часть действий» и «Конфликт» в разделе не реализованы:
`updateSection` пишет поверх чужой версии, интерфейс не показывает ни запрет, ни конфликт.

## 2. Шаги

1. **Сервер, `restoreSection`**: внутри транзакции после `FOR UPDATE` читать `status` и
   `archivedByRole`; `NOT_FOUND` при отсутствии рубрики, `CONFLICT` при `status !== "archived"`,
   `FORBIDDEN` когда актор не `owner`, а архив сделан `owner`. Ни одна ветка отказа не пишет аудит.
   Форма проверок повторяет `restoreTag`, чтобы правило иерархии было одним и тем же.
2. **Сервер, `updateSection`**: необязательный аргумент `expectedUpdatedAt` сверяется с
   `updatedAt` записи; запись идёт условным `updateMany` с `updatedAt` в `WHERE`, пустой `count`
   даёт `CONFLICT`. Пара «сверка + условная запись» повторяет `server/src/admin/legal.ts`
   (`updateDraft`): сверка без условия в самом `UPDATE` пропускает параллельную правку между
   чтением и записью. `updatedAt` не попадает в `diff` аудита — там остаются JSON-безопасные поля.
3. **Сервер, `archiveFormat` / `restoreFormat`**: читать текущий статус, `NOT_FOUND` для
   отсутствующего формата, `CONFLICT` при повторном архивировании или восстановлении активного.
4. **Резолвер**: `restoreSection` завернуть в `handleAdminError` (как остальные мутации
   таксономии), `updateSection` — передавать `expectedUpdatedAt`.
5. **GraphQL**: `updateSection(id, input, expectedUpdatedAt: String)`. Аргумент необязательный —
   сохраняемый контракт мутаций рубрик и форматов не меняется.
6. **Веб**: `useAdminCategories` получает состояния `conflict` / `forbidden` по коду ошибки и
   передаёт `expectedUpdatedAt` при сохранении; страница скрывает «Восстановить» для архива
   `owner` у роли ниже и показывает пояснение «архивировано владельцем», а также баннеры
   конфликта («обновите карточку») и запрета. Форма при конфликте сохраняет введённое.
   Разметка и ключи повторяют `/admin/tags` (T-071), где это состояние уже реализовано.
7. **`syncUrl`**: раздел живёт по `/admin/sections` (реестр `routes.md` #42), а `syncUrl` уводил
   на `/admin/categories`; использовать текущий путь.
8. **Проверки**: серверные тесты на AC-1 и AC-2 (`taxonomy-service.test.ts`,
   `admin-categories.test.ts`), веб-тест страницы на состояния §9, Playwright на строки
   «нет прав на часть действий» и «конфликт» (AC-3).

## 3. Вне scope

Физическое удаление рубрик и тегов `admin` без аудита — T-076. Продуктовые правила не
придумываются: роли, иерархия архива и строки состояний берутся из §5 и §9 спецификации.

## 4. Как проверяется

`pnpm format`, `pnpm lint`, `pnpm test`, `pnpm --filter nuxt-app run typecheck`,
`pnpm --filter server run build:ci`, `pnpm --filter nuxt-app run test:e2e`. Результаты,
exit codes и ограничения — в отчёте и receipt `docs/reports/tasks/T-132.{json,md}`.

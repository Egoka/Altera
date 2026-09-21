# План T-083: раздел `/admin/legal` — версии, публикация, `legal.update`

- **Задача**: `docs/backlog/tasks/T-083-admin-legal-texts.md`; native issue ALTE-112
- **Спецификация**: `docs/spec/40-admin/legal-texts.md`; ADR-0028; матрица доступа #96; события #37, #75
- **Baseline `origin/app`**: `ad5b69ecc5ef61b0d74c3ba7b18e597e5a73bcfd`
- **Ветка / worktree**: `feat/t083-admin-legal`, `.worktrees/t083-admin-legal`

## Границы

Входит раздел: список видов и версий с фильтрами §4, карточка версии с предпросмотром и
сравнением, черновик и публикация (§5), двухшаговое подтверждение существенной версии (§7),
аудит `legal.update` (§8), строки состояний §9. Содержание текстов (Q-07) и письма о
существенных изменениях (§25.13) не входят. Механизм версий и страницы `/legal/*` — T-101.

## Шаги

1. Сервер `src/admin/legal.ts`: чтение для `admin`/`owner`, черновик и публикация — `perm(owner)`;
   один черновик на вид и локаль, его номер следует за последней опубликованной редакцией;
   `CONFLICT` по `updatedAt`; аудит без полного текста; сброс кеша `legal:<kind>` и `home`.
2. `legal:publish` (T-101) сдвигает открытый черновик, чтобы номера не пересекались.
3. GraphQL: `adminLegalKinds`, `adminLegalVersions`, `adminLegalVersion`, `createLegalDraft`,
   `publishLegalVersion`.
4. Веб: `/admin/legal`, `/admin/legal/{kind}`, `/admin/legal/{kind}/{version}`, middleware 403,
   переводы ru/en.
5. Тесты: юнит сервера и веба, тест на PostgreSQL (CI), Playwright: AC-1 и строки §9.

## Проверки

`pnpm format`, `pnpm lint`, `pnpm codegen --check`, `pnpm test`, typecheck и build веба,
`build:ci` сервера; Playwright и тест на базе — в CI (локально нет Docker и PostgreSQL).

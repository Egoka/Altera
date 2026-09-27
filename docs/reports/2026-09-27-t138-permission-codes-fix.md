# T-138: Срез реальности — число кодов прав в §С2.3

**Дата**: 2026-09-27
**Задача**: T-138 / ALTE-133
**Исполнитель**: e682f2d5-7541-475e-a0b4-ef0b8ae885f4 (хранитель документации)
**Run**: 01a0e345-fdcf-705e-bd09-925974074751
**Baseline SHA**: d5533cbb7b0789cfa11a33381a23b40bf050895f
**Tested SHA**: e67f3ad65535557d4c039551a41d62024f051a93
**Ветка**: docs/t138-fix-permission-count
**PR**: https://github.com/Egoka/Altera/pull/307

## Изменение

Файл: `docs/vision/00-reality-check.md`, строки 565–567.

**До**:
```
- **Матрица прав**: `DEFAULT_ROLE_PERMISSIONS` в `server/src/exceptions/permissions.ts`
  с 18 кодами прав и их носителями; `editor`/`moderator`/`analyst` имеют конкретные
  права [ФАКТ: `server/src/exceptions/permissions.ts:5-75`].
```

**После**:
```
- **Матрица прав**: `DEFAULT_ROLE_PERMISSIONS` в `server/src/exceptions/permissions.ts`
  с 13 кодами прав и их носителями; `editor`/`moderator`/`analyst` имеют конкретные
  права [ФАКТ: `server/src/exceptions/permissions.ts:5-19,53-67`].
```

## Верификация числа

`git show 4ea27a6:server/src/exceptions/permissions.ts` — ревизия среза 2026-09-20:
- `PERMISSION_CODES`: строки 5–19, 13 элементов (без `job.list`, добавленного позже).
- `DEFAULT_ROLE_PERMISSIONS`: строки 53–67.

## Проверки (check_id = e67f3ad)

| Проверка | Результат |
|----------|-----------|
| `pnpm format` | exit 0 — All matched files use Prettier code style |
| `pnpm lint` | exit 0 — no errors |
| `pnpm test` | server 884 passed / 47 skipped; web 677 passed; content 99 passed |

## Критерии готовности

- **AC-1**: число кодов прав в §С2.3 равно длине `PERMISSION_CODES` на ревизии среза `4ea27a6` (13 кодов),
  `[ФАКТ]` указывает строки массива (5–19) и матрицы (53–67) на ней. ✅

## Остаток и следующий шаг

Остатка нет. Ожидается независимое ревью PR #307 и слияние в `app`.

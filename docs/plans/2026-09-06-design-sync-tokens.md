# Синхронизация дизайн-токенов Altera в claude.ai/design

- **Дата**: 2026-09-06
- **Ветка**: docs/platform-design (текущая; изменения — корневые `.design-sync/` и `.gitignore`)
- **Базовый коммит**: c328133
- **Отчёт**: docs/reports/2026-09-06-design-sync-tokens-report.md
- **Статус**: выполняется

> План зафиксирован после разведки репозитория и до первой отгрузки в claude.ai/design;
> локальная сборка на момент записи уже прогонялась один раз (процесс вёл навык
> `/design-sync`, ритуал проекта применён с опозданием — см. отчёт, «Отклонения от плана»).

## 1. Цель

В claude.ai/design появляется проект-фундамент Altera: фирменная палитра, локальные гарнитуры и
принятый гайдлайн дизайн-системы. Дизайн-агент собирает макеты страниц из обычных элементов, но в
цветах и шрифтах Altera. В репозитории остаётся воспроизводимая конфигурация синхронизации, чтобы
следующий запуск был одной командой.

## 2. Контекст

- Навык `/design-sync` конвертирует **React**-пакеты компонентов; `web/` — приложение Vue 3 /
  Nuxt 4 (`web/app/components/**/*.vue`, 35 файлов), без `dist/`, без `.d.ts`, без Storybook.
  Компоненты в claude.ai/design перенести нельзя, реимплементация в React — вне рамок навыка.
- Конвертер поддерживает режим «только токены» (`lib/source-kit.mjs`: `[ZERO_MATCH] … treating as
  tokens-only DS`), валидатор принимает `componentCount === 0`.
- Источник токенов — `web/app/assets/css/main.css`: `@font-face` (строки 4–187), `@theme`
  (189–284), `body.dark` (363–376). Это исходник Tailwind 4, браузеру он не годится — нужна
  компиляция Tailwind-ом приложения (`tailwindcss@4.1.11`, `@tailwindcss/node` в pnpm-хранилище).
- Локальные гарнитуры в `web/app/assets/fonts/`: Bergamasco, Cormorant SC, Garamond Libre,
  Waterway. Токены `--font-inter/poppins/roboto/open-sans` объявлены без `@font-face`.
- Принятое видение — `docs/vision/06-design-system.md` (ADR-0004, 0016, 0017, 0021, 0025, 0030).
- `react`/`react-dom` в репозитории нет; конвертеру они нужны для `_vendor/`.

Решения владельца (2026-09-06): режим «только токены»; четыре токена шрифтов остаются в теме,
файлы не отгружаются (падение на системный sans соответствует видению).

## 3. Шаги

1. Разведка: форма репозитория, режим конвертера, источники токенов и шрифтов; подтверждение
   объёма и решения по шрифтам у владельца.
2. Постановка конвертера в `.ds-sync/` (скрипты навыка + `esbuild`, `ts-morph`, `@types/react`,
   `react`, `react-dom`); `.gitignore` для `.ds-sync/`, `ds-bundle/`, `.design-sync/.cache/`,
   `.design-sync/learnings/`, `.design-sync/node_modules`.
3. `.design-sync/compile-tokens.mjs`: компиляция `main.css` Tailwind-ом приложения в
   `.design-sync/.cache/tokens/altera-theme.css` (только слой темы, все переменные, без
   preflight и утилит), копии шрифтов с именами без пробелов в `.design-sync/.cache/fonts/`.
4. `.design-sync/config.json` (`pkg`, `globalName`, `shape`, `entry`, `buildCmd`, `cssEntry`,
   `guidelinesGlob`, `readmeHeader`), пустая точка входа `.design-sync/entry.mjs`,
   `.design-sync/NOTES.md`.
5. Сборка `package-build.mjs`, валидация `package-validate.mjs --no-render-check` (превью нет —
   рендерить нечего); разбор предупреждений.
6. `.design-sync/conventions.md` — заголовок README для дизайн-агента: настройка, словарь токенов,
   роли гарнитур (сверены по шаблонам `web/app/components/*`), раскладка, где искать истину,
   один пример. Каждое имя проверяется по собранному `_ds_bundle.css`. Пересборка драйвером
   `resync.mjs` (без `--remote`).
7. Авторизация `DesignSync` (`/design-login` в интерактивном терминале — действие владельца),
   выбор имени и создание проекта, запись `projectId` в `config.json`, план отгрузки,
   инкрементальная отгрузка (sentinel → файлы → sentinel → `_ds_sync.json` последним),
   `report_validate`, проверка `list_files`.
8. Отчёт в `docs/reports/`; предложение закоммитить durable-набор
   (`.design-sync/{config.json,NOTES.md,conventions.md,entry.mjs,compile-tokens.mjs}`,
   `.gitignore`, план и отчёт).

## 4. Критерии готовности

- `package-validate.mjs` завершается кодом 0; предупреждения — только принятые
  (`[FONT_MISSING]` по Cambria/Inter/Poppins/Open Sans, `[RENDER_SKIPPED]`).
- `ds-bundle/README.md` начинается с текста `conventions.md`; все `--имена` из заголовка есть в
  `ds-bundle/_ds_bundle.css` (кроме трёх, явно описанных как планируемые).
- `ds-bundle/styles.css` импортирует `fonts/fonts.css` и `_ds_bundle.css`; в `fonts/` — 19 файлов.
- В проекте claude.ai/design `list_files` совпадает с содержимым `ds-bundle/`; `projectId` записан
  в `config.json`; URL проекта — в отчёте.

## 5. Что сознательно не входит

- React-обёртки вокруг Vue-компонентов и любая реимплементация компонентов.
- Правки `main.css`: дубль палитр `primary`/`secondary`, чужеродный `success-500`, правило
  `body.dark` — остаются как есть (это работа по `06-design-system.md` §11).
- Отгрузка Inter, Poppins, Roboto, Open Sans; Google-шрифты.
- Playwright и визуальная проверка карточек — карточек нет.
- Утилиты Tailwind в проект claude.ai/design — только переменные темы.

## 6. Риски

- Авторизация недоступна из неинтерактивной сессии → шаг 7 ждёт владельца; локальный результат
  (`ds-bundle/`) самодостаточен, повторный `/design-sync` после входа подхватит конфиг.
- Изменение структуры `main.css` (слоистый импорт, `@theme inline`) → `compile-tokens.mjs`
  останавливается с понятной ошибкой, а не выдаёт неполную тему.
- Гайдлайн описывает планируемые токены (`--color-paper`, `--color-ink`) → оговорено в заголовке
  README, чтобы агент не использовал несуществующие имена.
- Пробелы в именах файлов шрифтов → копии переименованы, содержимое не меняется.

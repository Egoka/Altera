# design-sync — заметки по синхронизации Altera в claude.ai/design

Файл читается перед каждой повторной синхронизацией. Одна заметка — один пункт.

## Форма репозитория

- Репозиторий — **не** пакет React-компонентов: `web/` — приложение Vue 3 / Nuxt 4, компоненты
  лежат в `web/app/components/**/*.vue`. claude.ai/design рендерит только React, поэтому
  конвертер работает в режиме **«только токены»** (`components: []`): в проект уходят
  скомпилированная тема Tailwind, шрифты, гайдлайны и README. Карточек компонентов нет и
  быть не может, пока в репозитории не появится React-пакет (например, планируемый пакет
  `content`, ADR-0029).
- Storybook и story-файлов нет; `shape: "package"` закреплён в конфиге.
- Точка входа бандла — пустой модуль `.design-sync/entry.mjs` (`cfg.entry`). Через него
  конвертер находит корневой `package.json` (`altera@1.0.0`), поэтому `PKG_DIR` — корень
  репозитория, а `cssEntry` и `guidelinesGlob` считаются от корня.
- `react`/`react-dom` в репозитории нет (Vue). Конвертеру они нужны для `_vendor/`, поэтому
  ставятся в `.ds-sync/` вместе с `esbuild`, `ts-morph`, `@types/react`, а `--node-modules`
  указывает на `.ds-sync/node_modules`. Команда установки:
  `cd .ds-sync && COREPACK_ENABLE_STRICT=0 npm i esbuild ts-morph @types/react react react-dom`.
- Заголовок README (`.design-sync/conventions.md`, `cfg.readmeHeader`) написан по-английски
  намеренно: он вставляется в системный промт дизайн-агента claude.ai/design.

## Токены и шрифты

- Источник токенов — `web/app/assets/css/main.css` (Tailwind 4: `@import "tailwindcss"`,
  `@theme`, `@custom-variant dark`, `@layer base { body.dark … }`). Браузер такой файл не
  понимает, поэтому `.design-sync/compile-tokens.mjs` (`cfg.buildCmd`) компилирует его
  Tailwind-ом самого приложения (`@tailwindcss/node` из pnpm-хранилища рядом с
  `@tailwindcss/vite`, версия закреплена lock-файлом) в
  `.design-sync/.cache/tokens/altera-theme.css`: только слой темы, все переменные
  (`theme(static)` для темы Tailwind по умолчанию и `@theme static` для блока Altera), без
  preflight и утилит. Этот файл — `cfg.cssEntry`; в бандле он становится `_ds_bundle.css`.
- Файлы шрифтов копируются в `.design-sync/.cache/fonts/` с именами без пробелов
  (`Bergamasco Thin.ttf` → `Bergamasco-Thin.ttf`), чтобы пути в проекте claude.ai/design были
  без пробелов. Содержимое файлов не меняется.
- Владелец решил (2026-09-06): токены `--font-inter`, `--font-poppins`, `--font-roboto`,
  `--font-open-sans` остаются в теме как в `main.css`, но файлы шрифтов **не** отгружаются —
  в дизайнах они падают на системный sans, как и предписывает `docs/vision/06-design-system.md`
  (интерфейс — системный sans, без Google-шрифтов). Текущая сборка Nuxt подтягивает Inter через
  `@nuxt/fonts` автоматически — это сознательно не воспроизводится.
- Отгружаются три локальные гарнитуры из `web/app/assets/fonts/`: Cormorant SC (5 файлов),
  Garamond Libre (3), Waterway (1) — ровно те файлы, на которые ссылаются `@font-face` в
  `main.css`.
- **Bergamasco не отгружается.** Все десять `.ttf` в `web/app/assets/fonts/Bergamasco/` пустые
  (0 байт) и такими закоммичены в `b00cb5d`; LFS нет. Сайт никогда не рендерил Bergamasco —
  логотип падает на serif. Владелец решил (2026-09-06) пустые файлы не отгружать:
  `compile-tokens.mjs` выбрасывает `@font-face`, чей файл пуст, и печатает
  `! Bergamasco: 12 @font-face пропущено`. Токен `--font-bergamasco` в теме остаётся. Если
  положить настоящие файлы с теми же именами, они уйдут при следующей синхронизации без правок
  конфига (правило общее: пропускаются только файлы нулевого размера).
- `docs/guides/fonts-guide.md` помечен как исторический (Georgia в заголовках, Google-шрифты) и
  **намеренно не** включён в `guidelinesGlob` — он противоречит и коду, и принятому видению.
  В `guidelines/` уходит только `docs/vision/06-design-system.md`; его §3 описывает
  *планируемую* семантическую палитру (`--color-paper`, `--color-ink`), которой в сборке нет —
  заголовок README это оговаривает.

## Known render warns (приняты, повторная синхронизация не должна их считать новыми)

- `[FONT_MISSING] "Cambria" (--font-serif), "Bergamasco" (--font-bergamasco), "Inter" (--font-inter),
  "Poppins" (--font-poppins), "Open Sans" (--font-open-sans)` — Cambria из стека `--font-serif`
  Tailwind по умолчанию (системный шрифт), Bergamasco — пустые файлы (см. выше), остальные три —
  решение владельца выше. Порядок семейств в строке может отличаться.
- `[RENDER_SKIPPED] render check did not run (--no-render-check)` — превью нет (0 компонентов),
  проверять нечего; validate запускается с `--no-render-check` осознанно, Playwright не ставился.
- `[DTS_REACT] @types/react not found in node_modules` в логе сборки — конвертер ищет типы у
  корня репозитория, а не в `.ds-sync/node_modules`; при 0 компонентах безвредно.

## Повторная синхронизация

1. На свежем клоне: скопировать скрипты навыка в `.ds-sync/` (строка `cp -r` из навыка) и
   выполнить установку зависимостей (см. выше).
2. `node .design-sync/compile-tokens.mjs` — пересобрать тему (`cfg.buildCmd`).
3. Скачать `_ds_sync.json` из проекта в `.design-sync/.cache/remote-sync.json`.
4. `node .ds-sync/resync.mjs --config .design-sync/config.json --node-modules .ds-sync/node_modules
   --out ./ds-bundle --remote .design-sync/.cache/remote-sync.json --no-render-check`.
5. Отгрузка (`DesignSync`): проект `261e939d-1435-4fae-98f3-16a10f885a4f`
   (`https://claude.ai/design/p/261e939d-1435-4fae-98f3-16a10f885a4f`), `projectId` закреплён в
   конфиге, поэтому повторные синхронизации идут атомарным путём.
   - `finalize_plan` требует **абсолютный** `localDir`: относительный `./ds-bundle` разрешается
     от текущей директории оболочки, и после `cd` в `ds-bundle/` путь удваивается.
   - Токен плана живёт в памяти сессии: после возобновления сессии `write_files` отвечает «Plan
     token is missing» — открыть план заново (одно новое подтверждение), не искать ошибку в путях.
   - Порции, которые прошли без ошибок: тексты + `_vendor/` одним вызовом (~1,2 МБ), шрифты
     двумя (~3,8 МБ и ~2,2 МБ).
   - Авторизация `DesignSync` ставится только из интерактивного терминала (`/design-login`);
     из неинтерактивной сессии инструмент отвечает ошибкой авторизации.

## Re-sync risks (что может тихо устареть)

- `compile-tokens.mjs` полагается на структуру `main.css`: буквальная строка
  `@import "tailwindcss";` и блок `@theme {`. Если импорт станет слоистым или появится
  `@theme inline`, сценарий остановится с ошибкой — поправить замену, а не конфиг.
- Роли гарнитур в `conventions.md` списаны с компонентов `web/app/components/*` (сентябрь 2026).
  Рефакторинг `ArticleCard`/атомов из `06-design-system.md` §11–12 их изменит — перепроверить
  заголовок по шаблонам и по свежему `_ds_bundle.css`.
- Правило `body.dark` живёт в теме как есть; класс темы в приложении ставится на `html`, так что
  правило не срабатывает и там. Видение предписывает его удалить — тогда пропадёт из сборки само.
- Версия Tailwind берётся из `web/node_modules` — после обновления зависимостей вывод может
  измениться (новые переменные темы по умолчанию), это ожидаемо и попадёт в diff.
- Гайдлайн копируется verbatim: правки `06-design-system.md` уходят в проект при следующей
  синхронизации без проверки на соответствие сборке.

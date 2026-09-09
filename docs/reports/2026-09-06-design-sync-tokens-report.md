# Отчёт: Синхронизация дизайн-токенов Altera в claude.ai/design

- **Дата**: 2026-09-06
- **План**: docs/plans/2026-09-06-design-sync-tokens.md
- **Ветка**: docs/platform-design
- **Коммиты**: нет — изменения оставлены в рабочем дереве незакоммиченными (см. «Что осталось»)
- **Результат**: выполнено полностью
- **Проект claude.ai/design**: `Altera`, `261e939d-1435-4fae-98f3-16a10f885a4f`,
  https://claude.ai/design/p/261e939d-1435-4fae-98f3-16a10f885a4f

## 1. Что сделано

1. **Разведка и решения.** Установлено, что репозиторий — приложение Vue/Nuxt без React-пакета,
   Storybook и `dist/`; выбран режим конвертера «только токены». Владелец подтвердил объём и решил
   оставить токены `--font-inter/poppins/roboto/open-sans` без файлов шрифтов.
2. **Конвертер поставлен** в `.ds-sync/` (скрипты навыка + `esbuild`, `ts-morph`, `@types/react`,
   `react@19.2.8`, `react-dom`); пути машинного состояния добавлены в `.gitignore`.
3. **`compile-tokens.mjs`** компилирует `main.css` Tailwind-ом приложения (`tailwindcss@4.1.11`) в
   `.design-sync/.cache/tokens/altera-theme.css`: 434 переменных, 9 `@font-face`, 9 файлов
   шрифтов в `.design-sync/.cache/fonts/`. Блоки `@font-face` с пустыми файлами выбрасываются с
   предупреждением. Вывод детерминирован.
4. **Конфигурация**: `.design-sync/config.json` (с `projectId`), `.design-sync/entry.mjs`,
   `.design-sync/NOTES.md` (форма репозитория, решения по шрифтам, принятые предупреждения,
   команды и подводные камни повторной синхронизации, риски).
5. **Сборка и валидация** прошли: `ds-bundle/` содержит `_ds_bundle.js` (0 компонентов),
   `styles.css` → `fonts/fonts.css` + `_ds_bundle.css`, `fonts/` (9 файлов), `guidelines/`
   (`docs/vision/06-design-system.md`), `README.md`, `_ds_sync.json`.
6. **Заголовок README** `.design-sync/conventions.md` написан и вшит (`cfg.readmeHeader`); все 55
   упомянутых имён токенов найдены в `_ds_bundle.css`, три описаны как отсутствующие намеренно.
   Финальная сборка выполнена драйвером `resync.mjs`, вердикт `ok: true`.
7. **Проект создан и заполнен.** После `/design-login` владельца: `create_project` → `Altera`,
   `projectId` записан в конфиг до отгрузки, план отгрузки согласован (одно подтверждение),
   последовательность: страж `_ds_needs_recompile` → 18 файлов содержимого тремя порциями →
   сверка `list_files` (удалять нечего) → повторный страж → `_ds_sync.json` последним →
   контрольный `list_files` → `report_validate`.
8. Настоящий отчёт.

## 2. Что не сделано и почему

- Коммит durable-набора не сделан: владелец коммит не запрашивал, предложено в финальном
  сообщении.
- Карточек компонентов нет — и не может быть без React-пакета (это не входило в план).

## 3. Отклонения от плана

- **Bergamasco не отгружен.** При отгрузке обнаружилось, что все десять `.ttf` в
  `web/app/assets/fonts/Bergamasco/` пустые (0 байт) и такими закоммичены в `b00cb5d`; сайт
  никогда не рендерил эту гарнитуру. Владелец решил (2026-09-06) пустые файлы не отгружать.
  В `compile-tokens.mjs` добавлено общее правило: `@font-face` с файлом нулевого размера
  пропускается с предупреждением; токен `--font-bergamasco` в теме остаётся. Заголовок README
  и NOTES.md обновлены. План говорил о четырёх гарнитурах — отгружены три.
- План записан после разведки и первой локальной сборки, а не до начала работы: процесс вёл навык
  `/design-sync` со своим порядком шагов, ритуал проекта применён с опозданием. Задним числом
  план не правился.
- В тему отгружаются и переменные Tailwind по умолчанию (`theme(static)`), а не только блок
  `@theme` Altera: компоненты сайта реально используют `zinc`/`gray`/`red`, без них заголовок
  README не смог бы назвать ни одного существующего серого.
- Копии файлов шрифтов переименованы (пробелы → дефисы); содержимое не тронуто.
- Отгрузка потребовала повторного `finalize_plan`: первый токен плана был потерян при
  возобновлении сессии, а относительный `localDir` разрешился от `ds-bundle/`. Оба случая
  описаны в NOTES.md.

## 4. Затронутые файлы

- `.gitignore` — добавлены `.ds-sync/`, `ds-bundle/`, `.design-sync/.cache/`,
  `.design-sync/learnings/`, `.design-sync/node_modules`.
- `.design-sync/config.json`, `.design-sync/entry.mjs`, `.design-sync/compile-tokens.mjs`,
  `.design-sync/conventions.md`, `.design-sync/NOTES.md` — новые.
- `docs/plans/2026-09-06-design-sync-tokens.md`, этот отчёт — новые.
- Не в git (машинное состояние): `.ds-sync/`, `ds-bundle/`, `.design-sync/.cache/`.

## 5. Как проверено

```bash
node .design-sync/compile-tokens.mjs
# ! Bergamasco: 12 @font-face пропущено — файлы шрифта пустые (0 байт), семейство не отгружается
# ✓ .design-sync/.cache/tokens/altera-theme.css: 21.2 KB, 434 переменных, 9 @font-face,
#   9 файлов шрифтов -> .design-sync/.cache/fonts/

node .ds-sync/resync.mjs --config .design-sync/config.json --node-modules .ds-sync/node_modules \
  --out ./ds-bundle --no-render-check
# css: ../.design-sync/.cache/tokens/altera-theme.css (22 KB, copied); components: 0; guidelines: 1 file(s)
# readmeHeader: stitching .design-sync/conventions.md
# ! [FONT_MISSING] "Cambria" (--font-serif), "Bergamasco" (--font-bergamasco), "Inter" (--font-inter),
#   "Poppins" (--font-poppins), "Open Sans" (--font-open-sans)
# ! [RENDER_SKIPPED] render check did not run (--no-render-check)
# ✓ bundle is complete (2 warning(s) — review above, non-blocking)
# {"ok": true, stages: build/diff/validate exit 0, capture skipped "empty_worklist", upload.any: true}
```

Дополнительно по свежей сборке: `find ds-bundle -type f -size 0` — пустых файлов нет; в
`fonts/` 9 файлов, в `fonts/fonts.css` 9 `@font-face`; сверка имён из `conventions.md` с
`_ds_bundle.css` — 58 имён, пропусков нет (3 планируемых отсутствуют намеренно);
`ds-bundle/README.md` (8 435 байт) начинается с текста заголовка; `styles.css` — два `@import`,
оба разрешаются. Playwright не устанавливался — карточек для рендера нет.

Отгрузка (`DesignSync`): `list_projects` → `[]`; `create_project` → `261e939d-…`; `list_files`
до отгрузки → `[]`; `finalize_plan` → план принят; `write_files` → 1 + 9 + 5 + 4 + 1 + 1 файлов,
все с ответом `written`; `list_files` после отгрузки → 20 файлов (`README.md`, `_ds_bundle.css`,
`_ds_bundle.js`, `_ds_needs_recompile`, `_ds_sync.json`, `_vendor/react.js`,
`_vendor/react-dom.js`, `fonts/fonts.css`, 9 файлов шрифтов, `guidelines/index.md`,
`guidelines/docs/vision/06-design-system.md`, `styles.css`) — ровно содержимое `ds-bundle/` без
локальных dot-файлов; `report_validate` принят (0 компонентов, 3 сборки).

## 6. Что осталось

1. Открыть проект в claude.ai/design и посмотреть панель дизайн-системы (самопроверка приложения
   срабатывает при открытии — страж `_ds_needs_recompile` это запускает). Повторные отгрузки
   дешёвые: правки `conventions.md` или `main.css` → `compile-tokens.mjs` → драйвер → отгрузка.
2. Закоммитить durable-набор (`.design-sync/*`, `.gitignore`, план, отчёт) одним коммитом,
   предварительно `pnpm format:fix && pnpm lint`.
3. Настоящие файлы Bergamasco, если они есть у владельца, достаточно положить в
   `web/app/assets/fonts/Bergamasco/` под теми же именами — следующая синхронизация отгрузит их
   без правок конфига.
4. Карточки компонентов появятся только с React-пакетом (например, `content`, ADR-0029) — тогда
   это будет отдельный план.

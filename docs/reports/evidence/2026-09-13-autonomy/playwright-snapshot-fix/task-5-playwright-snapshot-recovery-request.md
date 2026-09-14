# Продолжение Playwright после исправления формата снимка

Статус: подготовлено для рассмотрения; не разрешает запуск само по себе.

## Основание

Разрешённое изменение chroot проверено: старый фильтр EPERM, новый успех.
Единственная разрешённая browser recovery завершилась отказом проверки на
формате ответа MCP. Страница и её YAML получены. Ошибка устранена офлайн,
пять статических тестов прошли; независимое ревью должно быть PASS до запуска.
Предыдущий scope явно требовал остановиться при неожиданном результате.

## Конкретное продолжение

Одна полная синтетическая Playwright canary с исправленным чтением снимка.
Используются прежний образ sha256:97bd451e71779dbd6527814023f16dd952e792ba633132fc7da297aed10b1426,
прежний согласованный seccomp e75c64002d22c7893bbc3aef2f8d7c0dde8f673254d0846d9182e89b180024f1
и неизменённый CLI vector. Образ не пересобирается. Учётные данные, модели,
Claude refresh и Multica в запуске не участвуют. UID1000, cap-drop ALL,
no-new-privileges, read-only root и Chromium sandbox сохраняются.

Перед запуском контроллер проверяет PASS независимого ревью и десять source pins
из snapshot-fix/source-proof.json с единственным последующим форматным обновлением
хэша test_runtime.py из playwright-static/format-only/source-proof.json, создаёт одноразовый claim и новый каталог
playwright-static/canary-4. Прежний failure count3 и evidence сохраняются.
Команда из изолированного worktree:

```text
/usr/bin/python3 -I scripts/agent-runtime/test_playwright_mcp.py --docker sha256:97bd451e71779dbd6527814023f16dd952e792ba633132fc7da297aed10b1426 /private/tmp/altera-agent-loop-autonomy/.superpowers/sdd/2026-09-13-autonomy-execution/playwright-static/canary-4
```

Проверяется полный существующий сценарий, включая обе предусмотренные им
топологии, действия страницы и отрицательные проверки ограничений. Код
проверки не редактируется во время запуска. При новом отказе — записать причину,
удалить только созданные ресурсы, остановиться без дополнительной попытки.
При успехе — независимый разбор raw evidence до принятия Playwright milestone.
Источник success/receipt не подменяется локальными тестами. Native adapters,
продуктовые проверки, интеграция и Multica остаются отдельной последующей работой.

## Точные изменения относительно предыдущего запуска

- scripts/agent-runtime/playwright-mcp-canary.mjs: 507040e0b6f3eb4b24632e2f90a7c32ecf40147d77a40a1eb411f915fe7302c2 → 8fdb109a7baf80cdab9449b41cc2facb5fa2043263afdb41dc6b8228f75be9f3
- scripts/agent-runtime/test_playwright_mcp.py: 2edb0379aecd453f2a31c90c7a13eaf50acc24dbd0e1a692d6ec729125ba12b7 → 5469691b9b6d856c0121da9c89ebd1e3bde2fcf5928aa0efee3408d2ae6e9297

Остальные восемь source pins сохранены. Frozen diff: e5c80ef5cfa33a30838254f696375b0def933e1b969c10f18caf134e5919cb7a.

Независимое ревью snapshot fix: PASS, SHA256 8b83b15eea732662901d6e8e958fd5f818c17ab56142d6fba193bd8942daa530.
Последующая форматная правка test_runtime.py удаляет один конечный пробел; новый SHA256 3625ee4b52f2bf5af3586818a0ad3fd9fa37f32723143edf31e3dfe0ededd3bc. Семантика не меняется.

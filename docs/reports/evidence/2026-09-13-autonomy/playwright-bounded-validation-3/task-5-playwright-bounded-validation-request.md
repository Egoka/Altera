# Ограниченное продолжение синтетической проверки Playwright

Статус: подготовлено после независимого PASS; ожидает явного разрешения владельца.

## Предлагаемый объём

До трёх полных запусков существующей синтетической Playwright canary после
принятого исправления разделения действия и свежего снимка. Проверка завершается
на первом полном PASS с последующим независимым разбором evidence. Каждый
запуск имеет отдельный claim, новый каталог evidence и неизменяемые во время
запуска source pins. Все прежние неуспехи сохраняются.

Если один из запусков обнаружит следующую ошибку самой проверки, допускается
её обратимое адресное исправление, локальный regression test и независимое
ревью перед следующим запуском в пределах общего лимита3. Повтор без выявленной
и исправленной причины не допускается. Критерии приёмки не ослабляются.

## Фиксированные ограничения

- Образ sha256:97bd451e71779dbd6527814023f16dd952e792ba633132fc7da297aed10b1426.
- Seccomp e75c64002d22c7893bbc3aef2f8d7c0dde8f673254d0846d9182e89b180024f1,
  UID1000, cap-drop ALL, no-new-privileges, read-only root, Chromium sandbox.
- Прежний CLI vector, синтетические web/redirect fixtures, внутренние сети,
  прежние limits памяти/CPU/PIDs и watchdog. Без изменения host/Docker daemon.
- Только canary.mjs и её тест могут корректироваться по подтверждённой причине;
  изменение runtime/security/vector/образа требует отдельного решения.
- Никаких credentials, запросов модели, Claude refresh, native назначений,
  изменений Multica, публикаций, push/merge или включения автопилотов.

При новом требуемом расширении безопасности, неясной причине, повторе той же
неустранённой ошибки или исчерпании3 запусков — остановить браузерные попытки
и сообщить точный результат. Удалять только ресурсы соответствующей попытки.
После полного PASS независимое ревью evidence предшествует приёмке; локальные
тесты и успешные отдельные шаги не заменяют полного результата.

## Первый подготовленный запуск

Исправление действий и свежих снимков готово; последующая правка сохраняет
метаданные текущего действия отдельно от свежих ссылок на элементы. Локальные
проверки:7/7. Финальное адресное ревью PASS, SHA256
`fb78d3aa7cb13976f9de5f926e8d515b7f17b21eed6af9bd4574c7df47c054f1`.
Первый запуск требует явного разрешения владельца на этот пакет.

Первый будущий запуск: canary-5; последующие, только при необходимости и после
принятых адресных исправлений: canary-6 и canary-7. Всего максимум3 новых
invocations; старые четыре неуспеха сохраняются.

```text
/usr/bin/python3 -I scripts/agent-runtime/test_playwright_mcp.py --docker sha256:97bd451e71779dbd6527814023f16dd952e792ba633132fc7da297aed10b1426 /private/tmp/altera-agent-loop-autonomy/.superpowers/sdd/2026-09-13-autonomy-execution/playwright-static/canary-5
```

Первый запуск сверяет следующие хэши из
playwright-static/current-action-metadata-fix/source-proof.json:

- scripts/agent-runtime/playwright-mcp-canary.mjs: `00c1f72a1e5b92c84ce9d41da40dc5dfd72dddd8d28e1c4be16441120f9345e9`
- scripts/agent-runtime/test_playwright_mcp.py: `d0b24d192d58746f699fc5f67ba076f9130e380af244849d14f3d7f7c2b6ded3`
- scripts/agent-runtime/Dockerfile: `f1e05c7a862717d3fb240ddc579f9e3e73aabad52ed9621f036bc09f91e28215`
- scripts/agent-runtime/playwright-seccomp.json: `e75c64002d22c7893bbc3aef2f8d7c0dde8f673254d0846d9182e89b180024f1`
- scripts/agent-runtime/playwright-mcp/package.json: `bc5f332d770e02e928bba6c83e50c9980aad60e71c3a4d574d2bd9a6663a70e3`
- scripts/agent-runtime/playwright-mcp/package-lock.json: `0e823db84be42dcd8b82bad7ba34f8072d08ba47d35ad7d5f7a3e8f30358e6ff`
- scripts/agent-runtime/codex_toml_map.py: `80daff5a550d08a12dc830ba896f71c46500463103513690ecafd999603c4bc4`
- scripts/agent-runtime/test_codex_toml_map.py: `3bc139cc131000c0e7337ef6c509aafea752de97c52a2ad86f2c998ef3c69558`
- scripts/agent-runtime/runtime.py: `86856ef487d5eaab2048e624a69678160ef8dd11a8d098884cf2e32e6e19c285`
- scripts/agent-runtime/test_runtime.py: `3625ee4b52f2bf5af3586818a0ad3fd9fa37f32723143edf31e3dfe0ededd3bc`


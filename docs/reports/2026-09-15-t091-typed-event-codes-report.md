# T-091: сверка кодов событий с реестром — отчёт

- **Базовый коммит:** `df5963e`
- **Ветка:** `server/t091-typed-event-codes`
- **План:** `docs/plans/2026-09-15-t091-typed-event-codes.md`

## Результат

Добавлен `server/tests/event-code-registry.test.ts`. Тест читает замороженный реестр, выбирает строки
типов `log` и `error`, статус которых начинается с `утверждён`, извлекает все коды из второй ячейки и
раскрывает сокращённые записи с ведущей точкой (например, `.started` после `ai.job.created`).

Отсортированный список утверждённых `log`-кодов сравнивается с `LOG_EVENT_CODES`, список `error`-кодов —
с ключами `ERROR_DEFINITIONS`. Сравнение массивов сохраняет контроль дублей и падает как при лишнем коде в
константах, так и при отсутствии утверждённого кода.

## Как проверено

### Чувствительность теста к расхождениям

После добавления временного `t091.registry.mutation` в `LOG_EVENT_CODES` выполнено:

```text
$ pnpm --filter server exec vitest run tests/event-code-registry.test.ts
Test Files  1 failed (1)
Tests       1 failed | 1 passed (2)
AssertionError: expected [...] to deeply equal [...]
+ "t091.registry.mutation"
exit 1
```

После временного удаления `http.request` из `LOG_EVENT_CODES` та же команда дала:

```text
Test Files  1 failed (1)
Tests       1 failed | 1 passed (2)
AssertionError: expected [...] to deeply equal [...]
- "http.request"
exit 1
```

Обе временные мутации восстановлены до итоговой проверки.

### Итоговый целевой тест

```text
$ pnpm --filter server exec vitest run tests/event-code-registry.test.ts
Test Files  1 passed (1)
Tests       2 passed (2)
exit 0
```

### Полный серверный Vitest

```text
$ pnpm --filter server test
Test Files  12 passed (12)
Tests       72 passed | 1 todo (73)
exit 0
```

### Статические проверки

```text
$ pnpm lint
exit 0

$ pnpm format
All matched files use Prettier code style!
exit 0
```

Первая попытка `pnpm format` завершилась с exit 1 и указала только
`server/tests/event-code-registry.test.ts`. После применения Prettier к этому файлу повторная проверка прошла.

Обе успешные команды вывели предупреждение среды: репозиторий требует Node `24.12.0`, локально использован
Node `24.3.0` с pnpm `10.18.3`. Ошибок и падений Vitest не было.

Перед первым запуском потребовался `pnpm install --frozen-lockfile`: исходная попытка не дошла до тестов из-за
отсутствующего бинарника `vitest` (`ERR_PNPM_RECURSIVE_EXEC_FIRST_FAIL`, exit 254). Установка завершилась с
exit 0 и не изменила отслеживаемые исходные файлы.

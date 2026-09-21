# План T-090: сроки хранения и housekeeping

- **Задача**: `docs/backlog/tasks/T-090-retention-housekeeping.md`
  (file SHA `4cf17e527c774d70761ffa0f6a476bd17e3b957f`)
- **Native issue**: ALTE-108 (`01a0c182-3784-7e79-b37a-18ca025aa32a`)
- **Эпик**: E-13 «Наблюдаемость»
- **Baseline `origin/app`**: `023797f2f65415de96e93b75101e0daaf9f2d1cf`
- **Ветка**: `feat/t090-housekeeping`
- **Источники**: `docs/spec/80-observability/retention-and-pd.md` §2 (таблица сроков, п. 5),
  `docs/spec/50-access/session-lifecycle.md` п. 11, `docs/spec/80-observability/error-collector.md`
  п. 2, `docs/vision/08-operations.md` §11; журнал прямого решения не содержит

## Что уже есть

Очередь заданий T-047 (`server/src/jobs`) с воркером, реестром обработчиков и записью ошибок
в `job.failed`; сессии T-023 (`Session.expiresAt`), токены входа (`MagicLinkToken`), коды смены
почты (`EmailChangeRequest`), ревизии (`ArticleRevision.kind = autosave`), журнал ошибок
(`BackendError` + `BackendErrorStatusHistory`). Периодические задачи в API — `setInterval` с
`unref` (лимиты T-024, исключения прав).

## Что делаю

1. `server/src/housekeeping/retention-policy.ts` — единственное место сроков; значения без
   решения владельца помечены `[ДОПУЩЕНИЕ]`.
2. `runHousekeeping(client, now)` — удаления по срокам. Клиент сужен до таблиц с ограниченным
   сроком: аудита и истории решений в типе нет.
3. Задание `housekeeping` регистрируется в очереди T-047; планировщик ставит его раз в период,
   если такое же не стоит в очереди и не выполняется.
4. Тесты: модульный с двойником (условия и сроки из политики, отсутствие дублей в очереди) и тест
   на PostgreSQL (`T090_TEST_DATABASE_URL`, шаг CI), который проверяет, что аудит и история
   статусов остаются.

## Не входит

Медиа-сироты (T-068), сырые события вовлечённости и соли (таблиц ещё нет), выгрузки данных,
старые записи самой очереди заданий.

# План T-058: служебные страницы 404, 500 и офлайн

- **Задача**: `docs/backlog/tasks/T-058-service-pages-404-500-offline.md`
  (file SHA `8afb1ed27bcd244983d22a08ade06387e1118a51`)
- **Native issue**: ALTE-105 (`01a0c113-1e40-7dd0-929f-2f5c41aebc18`)
- **Эпик**: E-09 «Публичные страницы»
- **Baseline `origin/app`**: `05c330290866b9af6646612be651fee1cf37189e`
- **Ветка**: `feat/t058-service-pages`
- **Источники**: `docs/spec/20-public/not-found.md`, `docs/spec/20-public/error.md`,
  `docs/spec/20-public/offline.md`, журнал §20.15, §20.17, §20.18, §28.4, ADR-0019, ADR-0032

## Что уже есть и чего нет

Служебной страницы нет ни одной. В `web/app/` лежит `error-t.vue` — файл с чужим градиентным
макетом, который Nuxt не находит: обработчик ошибок ищет `error.vue`. Поэтому сегодня 404 и 500
отдаёт встроенная страница Nuxt, без шапки, футера и `requestId`.

`requestId` уже сквозной (T-087): `web/server/middleware/request-id.ts` кладёт его в
`event.context.requestId` и в заголовок `x-request-id`, а `getGraphQLRouteError` прикладывает
его к отказам 5xx. Страницы лент уже показывают его через `ReadingErrorState`.

`/test-error` перечислен в `DEV_ONLY_ROUTES` `nuxt.config.ts`, в `devOnlyPages` теста словарей и
в `dev-only-routes.test.ts`, но самого файла страницы нет — инфраструктура его ждёт.

Мутации `createSupportRequest` на сервере нет: по `docs/backlog/tasks/T-059-about-and-contact.md`
§3 она входит в T-059 вместе со страницей `/contact`. Service worker по `offline.md` §1 — этап 3.

## Что делаю

### Страницы

1. `web/app/error.vue` — единственный обработчик ошибок Nuxt: 404 отдаёт `ServiceNotFound`,
   всё остальное — `ServiceServerError`. `error-t.vue` удаляется.
2. `ServiceNotFound` по `not-found.md` §5: полная шапка, сообщение «404 — такой страницы нет»,
   зона поиска скрыта (этап 3), ссылки «на главную / рубрики / авторы» и три карточки `small`
   из `feed(scope: home)`, кнопка «Сообщить о битой ссылке», футер. `requestId` не выводится —
   журнал §28.4: он показывается только при техническом сбое.
3. `ServiceServerError` по `error.md` §5: статическая шапка без запросов к API, `ErrorState`
   с `requestId` в `CopyField`, действия «Повторить / На главную / Написать в редакцию»
   (`/contact?requestId=`), строка про отсутствие публичной страницы статуса (журнал §20.17),
   статический футер. `Cache-Control: no-store` (ADR-0019, §10).
4. `web/app/pages/offline.vue` по `offline.md` §5: статическая шапка без входа и «Писать»,
   `ErrorState` «нет соединения» с индикатором попытки и кнопкой «попробовать снова»,
   `CachedList` из Cache Storage, автоматический возврат на исходный адрес по событию `online`.
5. `web/app/pages/test-error.vue` — dev-маршрут `error.md` §3, бросает 500 с `requestId`.

### Компоненты

- `ReadingCopyField` — поле с кнопкой копирования и запасным выделением текста
  (`error.md` §6); `ServiceReportLinkForm` (`not-found.md` §6) и `ServiceCachedList`
  (`offline.md` §6).
- `AppHeader` получает необязательные `static` (не ходить в API) и `minimal` (скрыть вход и
  «Писать»); поведение публичных страниц не меняется.

### Границы

- Мутация `createSupportRequest` и страница `/contact` — T-059. Форма 404 отправляет обращение
  по этому маршруту и честно показывает отказ, пока резолвера нет.
- Service worker и предкеширование — этап 3 `offline.md` §1; в задачу входят три страницы.
- 410 не входит (T-027/T-056): он остаётся внутри страниц и до `error.vue` не доходит.

## Как проверяю

- Vitest: рендер трёх страниц и состояний компонентов, словари локалей.
- Playwright `web/tests/e2e/service-pages.spec.ts`: строки состояний §8 трёх спецификаций и
  прямая проверка AC-2 — на 404 `requestId` нет, на 500 есть.
- `pnpm format`, `pnpm lint`, `pnpm test`, `pnpm --filter nuxt-app run build`, `typecheck`.

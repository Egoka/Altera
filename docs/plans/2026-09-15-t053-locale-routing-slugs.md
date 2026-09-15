# T-053: адресация локалей, переключатель языка и постоянство публичных адресов

- **Дата**: 2026-09-15
- **Ветка**: `docs/t-053-locale-routing`
- **Задача**: T-053 / ALTE-34
- **Authorization**: native issue `01a0a52d-d1cf-79a7-8ba9-f17673d24485`, поручение оркестратора
  `01a0a59d-479c-7866-9b4a-41a68e1b3a14`; scope — Nuxt i18n-маршруты, переключатель языка и
  проверка непереиспользования публичных адресов
- **Базовый коммит**: `bf5931670fc7145ac7a4a8994afb735dff83b3c4`
- **Исходное дерево**: clean
- **Отчёт**: `docs/reports/2026-09-15-t053-locale-routing-slugs-report.md` (заполняется разработчиком)
- **Статус**: утверждён для frontend; запуск AC-T053-2 требует входов из §4.3

> **Для исполнителя:** вести шаги по TDD; перед изменением TypeScript/Vue применить
> `coding-standards`, перед изменением поведения — `superpowers:test-driven-development`, перед
> заявлением о готовности — `superpowers:verification-before-completion`.

## 1. Цель

Зафиксировать один наблюдаемый маршрутный контракт:

- `/` всегда разрешается как русская локаль, `/en` — как английская;
- `/ru` отвечает прямым HTTP 301 на `/`;
- публичные страницы получают локализованные маршруты, а `/me/**` и `/admin/**` не получают
  копий под `/en`;
- переключатель языка открывает опубликованный sibling-path, а при отсутствии пары — главную
  целевой локали;
- адрес материала после физического удаления остаётся зарезервированным и не может быть выдан
  другой сущности.

Словари интерфейса, SEO-теги и sitemap этим планом не реализуются.

## 2. Источники и разрешение приоритетов

- `docs/backlog/tasks/T-053-locale-routing-slugs.md`: результат, границы и AC.
- `docs/spec/00-registries/routes.md`: русские публичные адреса без префикса, английские под
  `/en`; account/admin без префикса; hreflang только для опубликованных пар.
- `docs/spec/20-public/home.md` §3, §6, §10: переключатель в шапке, canonical `/` и `/en`, пара
  `ru`/`en` и `x-default` на `/`.
- `docs/decisions/ADR-0002-localization-article-translation.md`: `ru` — default locale;
  sibling существует только для опубликованной языковой версии; уникальность article slug —
  `(locale, slug)`.
- `docs/decisions/ADR-0004-identifiers-and-urls.md`, уточнённый журналом §26.10: публичные
  адреса не освобождаются архивированием или физическим удалением.
- Журнал §20.10 относится к видимости тега с одной публикацией и не вводит дополнительного
  правила маршрутизации. Журнал §26.10 является старшим источником требования «навсегда».
- Установленные версии: Nuxt `^4.0.0`, `@nuxtjs/i18n` `^10.0.3`. Для v10 подтверждены
  `prefix_except_default`, `useSwitchLocalePath` / `SwitchLocalePathLink`, отключение локализации
  через page meta и изменение browser-language detection:
  <https://i18n.nuxtjs.org/docs/guide/>.

## 3. Фактический baseline

- `web/nuxt.config.ts:97-119` уже использует `prefix_except_default`, но default locale — `en`,
  а browser detection на root может увести запрос `/` на локаль браузера. Это противоречит
  детерминированному AC для `/`.
- `web/app/components/functional/LanguageToggle.vue:1-20` вызывает `setLocale()` кнопкой и не
  строит URL. Компонент не различает статический маршрут, опубликованную пару и отсутствие пары.
- `@nuxtjs/i18n` локализует все Nuxt pages по умолчанию. Без явного opt-out существующие
  `pages/me/**` и `pages/admin/**` получают запрещённые английские копии.
- `server/prisma/schema.prisma:12-124` содержит только текущие `User.slug @unique`,
  `ContentType.slug @unique`, `SectionTag.slug @unique`, `Article.slug @unique`; таблиц
  `ArticleTranslation`, резервов слагов и хэндлов ещё нет.
- `server/src/graphql/article/resolver.ts:464-520` разрешает создать и изменить `Article.slug`,
  а `bulkDeleteArticles` на строках 617-646 физически удаляет запись. После такого удаления
  текущий unique index освобождает адрес, поэтому AC-T053-2 на baseline не выполнен.

## 4. Архитектурное решение

### 4.1. Рассмотренные варианты

1. **Рекомендуется: T-053 владеет route/UI-контрактом и проверяет уже созданные постоянные
   адресные резервы.** T-013 владеет хэндлами, T-014 — рубриками/тегами, T-015 —
   `ArticleTranslation(locale, slug)`, T-076 — физическим удалением. После их schema-входов
   T-053 добавляет сквозной тест «удалили → повторно занять нельзя». Вариант не создаёт вторую
   модель тех же данных и сохраняет одну миграционную цепочку.
2. **Создать временную `ArticleSlugHistory` прямо в T-053.** Отклонено: текущий `Article` не имеет
   locale, а T-015 меняет его на `Article + ArticleTranslation`; временная таблица потребует
   повторной миграции и расходится с T-015, где смена slug запрещена.
3. **Проверять занятость только запросом перед `create`.** Отклонено: check-then-insert имеет race,
   не переживает физическое удаление строки и не является гарантией уникальности.

### 4.2. Nuxt routing

В `web/nuxt.config.ts`:

```ts
i18n: {
  locales: [
    { code: "ru", iso: "ru-RU", name: "Русский", file: "ru.json" },
    { code: "en", iso: "en-US", name: "English", file: "en.json" }
  ],
  defaultLocale: "ru",
  strategy: "prefix_except_default",
  detectBrowserLanguage: false
},
routeRules: {
  "/ru": { redirect: { to: "/", statusCode: 301 } }
}
```

Browser detection отключается намеренно: при `redirectOn: "root"` результат `/` зависит от
`Accept-Language`/cookie и AC перестаёт быть детерминированным. Выбранный язык меняется явной
навигацией переключателя; сохранение языка аккаунта относится к T-013/T-031.

Каждая существующая страница под `web/app/pages/me/**` и `web/app/pages/admin/**` получает:

```ts
definePageMeta({ i18n: false })
```

Это локальное объявление является частью route-файла и не требует хрупкого списка route names в
config. Contract test перечисляет все page-файлы в этих двух деревьях и падает, если новый файл
не содержит opt-out. Публичные `/login` и `/legal/**`, когда появятся, не входят в opt-out:
`routes.md` задаёт для них пары под `/en`. `/auth/verify` должен быть unprefixed отдельным page-meta
по своему route-контракту, но такого page на baseline нет.

`/en/me` и `/en/admin` одновременно пересекаются с формой динамического публичного пути. Поэтому
тест не ограничивается HTTP status: Nuxt route manifest не должен содержать `me___en` или
`admin___en`, а публичный resolver обязан отвергать `en`, `me`, `admin` и остальные reserved first
segments из единого server-owned списка ADR-0004. Создание и backfill этого списка относятся к
T-014; T-053 после его merge проверяет интеграцию, но не заводит второй frontend-список.

### 4.3. Постоянство адресов и обязательный вход реализации

T-053 не вводит конкурирующую Prisma-модель. До исполнения AC-T053-2 оркестратор должен
зафиксировать один из двух эквивалентных входов:

- merge T-013, T-014 и T-015 с адресными резервами, которые сохраняются после удаления; либо
- корректировку владельцев/dependencies backlog, явно назначающую T-053 единственным владельцем
  общей таблицы резервов до старта реализации.

Рекомендуется первый вариант. После merge upstream-моделей разработчик T-053 добавляет
`server/tests/public-address-reservation.test.ts`, который через публичный service/GraphQL boundary:

1. создаёт русскую версию с уникальным slug;
2. выполняет разрешённое физическое удаление через реализацию T-076 либо repository boundary,
   используемый этой мутацией;
3. пытается создать другую версию с теми же `(locale, slug)`;
4. ожидает доменную ошибку `CONFLICT` и неизменный резерв адреса;
5. отдельно подтверждает, что одинаковый slug допустим для другой locale, как требует ADR-0002.

Тот же integration suite берёт server-owned reserved-segment validator из T-014 и подтверждает,
что `en`, `authors`, `tags`, `collections`, `search`, `me`, `admin`, `auth`, `login`, `legal`, `api`,
`rss` и `sitemap.xml` нельзя назначить slug рубрики. UI не дублирует этот список.

Проверка должна проходить конкурентно: две параллельные попытки занять один новый
`(locale, slug)` дают ровно один успех и один `CONFLICT`. Гарантия опирается на unique constraint
PostgreSQL/Prisma, а не только на предварительный `find`.

Хэндлы и слаги таксономии не мигрируются в T-053: их модели и backfill принадлежат T-013/T-014.
Независимый reviewer T-053 проверяет, что общий тест адресного резерва покрывает article slug и
что T-053 не ослабил upstream constraints. Это сохраняет требование заголовка задачи без
дублирования владельцев схемы.

### 4.4. Контракт переключателя

`web/app/components/functional/LanguageToggle.vue` становится ссылочным, а не событийным
компонентом. Интерфейс:

```ts
type PublishedSiblingPath = string | null | undefined

const props = defineProps<{
  publishedSiblingPath?: PublishedSiblingPath
}>()
```

Семантика трёх состояний обязательна:

| Значение    | Назначение                                                                   |
| ----------- | ---------------------------------------------------------------------------- |
| `undefined` | статическая публичная page; использовать `useSwitchLocalePath(targetLocale)` |
| `string`    | динамический материал; использовать точный `sibling.path` из API             |
| `null`      | опубликованной пары нет; вести на `/` для `ru` или `/en` для `en`            |

Для `string` принимается только внутренний absolute-path, начинающийся с одного `/`; `//host` и
absolute URL заменяются locale-home. Компонент рендерит `NuxtLink`, сохраняет SSR/client target
одинаковым, содержит `aria-label` и показывает только переход в другую локаль. Тексты
`Русский`/`English` остаются локальными именами из `i18n.locales`; новые ключи словаря не нужны.

`web/app/components/app/header.vue` включает компонент без prop для главной и остальных
статических публичных routes. Страница материала в T-056 передаёт `article.sibling.path` либо
`null`; нельзя вычислять sibling заменой `/en` или повторным использованием текущего slug — у
языковых версий разные slugs и публикационные статусы.

### 4.5. SEO-граница

T-053 поставляет T-100 однозначные входы: locale из route, locale-home, каноническую пару route
names и только опубликованный `sibling.path`. Сам `useLocaleHead`, canonical, hreflang,
`x-default`, sitemap, RSS, OG и JSON-LD остаются в T-100/T-055. Account/admin routes уже в T-053
исключаются из локализованной route generation, sitemap и индексации; последнюю часть отдельно
проверяет T-100.

SEO-заключение запрошено в thread комментарием `01a0a5a1-7325-730a-af28-77febe8e3e05`.
Если специалист уточнит только набор проверок, это включается в developer report; изменение
route/sibling-контракта требует нового плана или явного отклонения в отчёте.

## 5. Файлы реализации

### Frontend T-053

- изменить `web/nuxt.config.ts` — default locale, browser detection, 301 `/ru`;
- изменить существующие `web/app/pages/me/**/*.vue` и `web/app/pages/admin/**/*.vue` —
  `definePageMeta({ i18n: false })` без иных UI-изменений;
- изменить `web/app/components/functional/LanguageToggle.vue` — ссылочный tri-state контракт;
- изменить `web/app/components/app/header.vue` — подключение переключателя на публичной шапке;
- создать `web/app/utils/localeRoute.ts` — чистые `localeHome()` и
  `resolveLocaleSwitchPath()` с проверкой same-origin path;
- создать `web/tests/locale-routing.test.ts` — config/page-meta contract;
- создать `web/tests/locale-route.test.ts` — чистая матрица target-path;
- создать `web/tests/language-toggle.test.ts` — SSR-safe render и accessible link;
- создать `web/tests/e2e/locale-routing.spec.ts` — реальные `/`, `/en`, `/ru` и отсутствие
  локализованных account/admin route names;
- изменить `web/scripts/smoke.sh` — curl-проверка прямого 301 без follow redirects;
- создать `docs/reports/2026-09-15-t053-locale-routing-slugs-report.md`.

### После schema-входов

- создать `server/tests/public-address-reservation.test.ts` — последовательная, после удаления и
  конкурентная проверки `(locale, slug)`, а также единый reserved-segment contract;
- изменять server implementation разрешено только в файлах уже принятой модели адресных резервов;
  новую параллельную таблицу T-053 не создаёт.

## 6. Шаги реализации

### Task 1. RED: route config и нелокализуемые зоны

- [ ] Создать `web/tests/locale-routing.test.ts`, импортировать Nuxt config и проверить
      `defaultLocale === "ru"`, `strategy === "prefix_except_default"`,
      `detectBrowserLanguage === false`, redirect `/ru` со `statusCode: 301`.
- [ ] Тем же тестом рекурсивно собрать `.vue` под `app/pages/me` и `app/pages/admin`; для каждого
      файла потребовать `definePageMeta({ i18n: false })`.
- [ ] Запустить
      `pnpm --filter nuxt-app exec vitest run tests/locale-routing.test.ts` и сохранить ожидаемый RED:
      default `en`, включён browser detection, нет redirect и page opt-out.
- [ ] Изменить config и page meta минимально по §4.2; не менять тексты страниц.
- [ ] Повторить targeted test до GREEN.

### Task 2. RED/GREEN: чистый resolver target-path

- [ ] Создать `web/tests/locale-route.test.ts` с матрицей:
      `ru→en: undefined + static route = switchLocalePath result`,
      `en→ru: sibling string = sibling`, `null = locale-home`, `https://...` и `//...` = locale-home.
- [ ] Запустить targeted test и сохранить RED из-за отсутствующего module.
- [ ] Создать `web/app/utils/localeRoute.ts` с типом `LocaleCode = "ru" | "en"`, функциями
      `localeHome(locale)` и `resolveLocaleSwitchPath({ targetLocale, publishedSiblingPath,
staticLocalePath })`.
- [ ] Повторить targeted test до GREEN.

### Task 3. RED/GREEN: компонент и header

- [ ] Создать `web/tests/language-toggle.test.ts` через Nuxt `mountSuspended`; замокать текущую
      locale и `useSwitchLocalePath`, проверить `href`, подпись и `aria-label` для всех трёх состояний.
- [ ] До изменения компонента получить RED: текущая кнопка не имеет `href` и игнорирует sibling.
- [ ] Переписать `LanguageToggle.vue` по §4.4 и подключить его в `app/header.vue`.
- [ ] Проверить, что SSR и hydration дают один `href`; не использовать `route.fullPath`, browser API
      или чтение storage в первом render.
- [ ] Повторить component test до GREEN.

### Task 4. RED/GREEN: HTTP-маршруты

- [ ] Создать `web/tests/e2e/locale-routing.spec.ts`: `request.get("/", { maxRedirects: 0 })` и
      `/en` возвращают 200; `/ru` возвращает 301 и `Location: /`.
- [ ] Проверить сгенерированный Nuxt route manifest: в нём нет локализованных route names для
      `me`/`admin`. Запросы `/en/me` и `/en/admin` не должны рендерить account/admin shell; если URL
      сопоставлен динамическому public route, server-owned reserved-segment validator возвращает 404.
- [ ] В браузере проверить, что switch на `/` ведёт `/en`, а на `/en` — `/`.
- [ ] Добавить в `web/scripts/smoke.sh` отдельную `check_redirect "/ru" "301" "/"`; curl вызывается
      без `-L`, status и `Location` проверяются раздельно.
- [ ] Выполнить production build и targeted E2E; dev server не является доказательством Nitro 301.

### Task 5. GREEN: адрес не переиспользуется

- [ ] До начала проверить наличие принятого schema-входа §4.3. При его отсутствии остановить
      только AC-T053-2 и вернуть оркестратору точные незавершённые зависимости.
- [ ] Создать `server/tests/public-address-reservation.test.ts` с пятью утверждениями §4.3.
- [ ] Запустить targeted test на реализации upstream; если он RED, исправлять только общий
      reserve/create/delete boundary, не вводя вторую таблицу.
- [ ] Повторить targeted test до GREEN и выполнить `pnpm --filter server run build:ci`.

### Task 6. Полная проверка и отчёт

- [ ] Выполнить `pnpm format`, `pnpm lint`, `pnpm test`.
- [ ] Выполнить `pnpm --filter nuxt-app run typecheck`, `pnpm --filter nuxt-app run build`,
      `pnpm --filter nuxt-app run test:e2e` и `pnpm --filter nuxt-app run smoke` на production output.
- [ ] Для изменённого server выполнить `pnpm --filter server run build:ci`; обычный `server build`
      не использовать как проверку миграции.
- [ ] Записать в парный отчёт команды, cwd, exit code, значимый вывод, точный HEAD/dirty
      fingerprint, check_id и отдельно результаты каждого AC.
- [ ] Передать тестировщику branch, полный SHA, diff, отчёт и SEO-заключение. Успех developer run
      не равен независимой приёмке.

## 7. Критерии готовности

| AC-ID       | Наблюдаемый результат                                                                                                         | Проверка / check_id                                                    |
| ----------- | ----------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| AC-T053-1a  | `/` = ru и `/en` = en независимо от `Accept-Language` и i18n cookie                                                           | production HTTP/E2E, `t053-locale-root`                                |
| AC-T053-1b  | `/ru` отвечает прямым 301 с `Location: /`                                                                                     | curl/smoke без `-L`, `t053-ru-redirect`                                |
| AC-T053-1c  | `/me/**`, `/admin/**` не получают локализованных route names; reserved public segments закрывают конфликт динамического route | route manifest + E2E/server contract, `t053-unprefixed-private-routes` |
| AC-T053-1d  | switch ведёт на published sibling или locale-home; static route сохраняет страницу                                            | unit/component/E2E, `t053-language-switch`                             |
| AC-T053-2   | удалённый `(locale, slug)` нельзя занять повторно; race даёт один success                                                     | server integration, `t053-address-reservation`                         |
| AC-T053-SEO | T-100 получает только фактические route/sibling inputs; SEO-теги не дублируются                                               | SEO/reviewer verdict, `t053-seo-boundary`                              |

## 8. Что сознательно не входит

- словари и перевод UI (T-095);
- canonical, hreflang, x-default, sitemap, RSS, OG, JSON-LD (T-100/T-055);
- schema/backfill хэндлов (T-013), таксономии (T-014), переводов материалов (T-015);
- страница материала и получение `sibling` из GraphQL (T-056);
- UI/authorization физического удаления (T-076);
- автоматический выбор локали браузера и перенаправление по географии.

## 9. Риски и снятие

- **`/` уходит на `/en` из-за browser detection.** Отключить detection; проверить разные
  `Accept-Language` и cookie на production server.
- **Служебные страницы появляются под `/en`.** Page-local opt-out и contract scan всех файлов
  `me/admin` делают новый route красным до merge.
- **Переключатель строит несуществующий перевод заменой префикса.** Для dynamic page принимать
  только опубликованный sibling path; `null` всегда ведёт на locale-home.
- **Open redirect через sibling.** Разрешать только строку с одним начальным `/`.
- **Application precheck проигрывает race.** Принимать AC-T053-2 только при DB unique constraint и
  конкурентном тесте.
- **T-053 дублирует миграции E-03.** Не начинать schema-часть без входа §4.3; временную таблицу не
  создавать.
- **SEO scope расползается.** T-053 стабилизирует URL inputs, T-100 владеет head/sitemap.

## 10. Стадии и handoff

| Стадия             | Вход                                          | Обязательный выход                                                     |
| ------------------ | --------------------------------------------- | ---------------------------------------------------------------------- |
| Архитектура        | T-053, trigger, baseline, источники           | этот план, SEO-заключение и явный dependency finding по AC2            |
| Разработка         | план, same worktree, подтверждённый вход §4.3 | scoped code, tests, парный отчёт, exact output SHA                     |
| Тестирование       | implementation SHA и отчёт                    | независимые curl/E2E/concurrency результаты по каждому AC              |
| Ревью              | источники, diff, test evidence, SEO verdict   | принято/возврат по route, scope и DB-backed uniqueness                 |
| Документация/релиз | принятый SHA и merge evidence                 | metadata/finalization; deploy применим по фактическому web/server diff |

Каждый handoff фиксирует task/stage/source run, baseline, branch/worktree, output SHA, dirty paths,
check_id, фактический вывод и следующий шаг. Две подряд неуспешные попытки одного check_id
останавливают соответствующую стадию.

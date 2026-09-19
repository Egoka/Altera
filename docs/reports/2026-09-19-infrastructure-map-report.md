# Отчёт: карта инфраструктуры, Cloudflare для altera.com и российский CDN для altera.ru

- **Дата**: 2026-09-19
- **План**: docs/plans/2026-09-19-infrastructure-map.md
- **Задача / authorization**: прямое поручение владельца в чате 2026-09-19 (цитата в плане);
  границы — документация и конфигурация Cloudflare как код, без продуктового кода, журнала и ADR
- **Ветка**: docs/infrastructure-map
- **Baseline**: a5f6c64eef712dceef8f36b2aea69f07a331ffd1, clean
- **Проверенная revision**: коммит этой работы в ветке `docs/infrastructure-map` (SHA — в pull request)
- **Коммиты**: один коммит с планом, документами, Terraform и этим отчётом
- **Actor / run**: Claude Code, прямой чат с владельцем; исследование CDN — параллельный субагент
  той же сессии
- **Run outcome**: success
- **Stage outcome**: завершена
- **Task acceptance**: не проверено (ревью владельца)
- **Результат**: выполнено полностью в границах плана

## 1. Что сделано

1. Прочитаны документы об инфраструктуре: vision 02 и 08; ADR-0002, 0004, 0008, 0011, 0019, 0023;
   спецификации `80-observability`, `85-media-and-binary`, публичных страниц (кеш); журнал §21.21,
   §28, §29; эпик E-17 и T-103; `render-neon.md`; CI, compose, `nuxt.config.ts`, точки входа API.
2. Проверены домены по whois.
3. Проверены ограничения бесплатного плана Cloudflare по документации.
4. Написана карта `docs/infrastructure/README.md`: как есть, требования, семь расхождений новых
   вводных с документами, целевая топология в Kubernetes, изменения кода, база в кластере,
   поставка, два домена, бюджет, девять решений владельца, двенадцать задач-кандидатов.
5. Написан `docs/infrastructure/cloudflare-altera-com.md` и Terraform `infra/cloudflare/`: DNS,
   настройки зоны, Tiered Cache, пять правил кеша, два редиректа (гео-редирект выключен).
6. Российские CDN сравнены в `docs/infrastructure/ru-cdn.md` (14 провайдеров, у трёх данных нет).
7. Ссылка на раздел добавлена в `docs/README.md`.

## 2. Что не сделано и почему

- Terraform не применён: зоны Cloudflare нет, домены проекту, по whois, не принадлежат.
- Dockerfile, Helm-чарт, деплой, правки кода — вне плана; перечислены задачами-кандидатами.
- Новые вводные в журнал не записаны: это решение владельца (карта, раздел 8, вопрос 9).
- Цена мастера Kubernetes у Yandex Cloud не снята: калькулятор подставляет её скриптом.

## 3. Отклонения от плана

- Сравнение CDN опровергло допущение, на котором держалась первая версия документов, — что
  российский CDN, как и Cloudflare, подчиняется `Cache-Control`. Yandex Cloud CDN кеширует ответ
  без `public, max-age` на время из настроек ресурса, а обхода кеша по конкретной cookie нет ни у
  одного провайдера. Схема для `altera.ru` изменена: HTML отдаётся с Gateway напрямую, через CDN
  идут только `static.altera.ru` и `media.altera.ru`. Карта и документ по Cloudflare исправлены.
- Ранее в этом же чате владельцу было сказано, что у Yandex Cloud CDN нет абонентской платы. Это
  неверно: с 2026-07-01 берётся 150 ₽ в месяц за ресурс, включено 150 ГБ и 100 млн запросов.
  Исправлено в `ru-cdn.md` и в ответе владельцу.
- Побочное действие исследования: на странице FAQ VK Cloud скрипт субагента нажал все кнопки
  страницы. Это засчитало анонимную оценку «была ли статья полезна» и скопировало текст в буфер
  обмена. Форма отзыва закрыта без отправки; других отправок, регистраций и покупок не было.

## 4. Затронутые файлы

- `docs/infrastructure/README.md`, `docs/infrastructure/cloudflare-altera-com.md`,
  `docs/infrastructure/ru-cdn.md` — новые
- `infra/cloudflare/versions.tf`, `variables.tf`, `main.tf`, `cache.tf`, `redirects.tf`,
  `terraform.tfvars.example`, `.gitignore`, `.terraform.lock.hcl` — новые
- `docs/plans/2026-09-19-infrastructure-map.md`, этот отчёт — новые
- `docs/README.md` — ссылка на раздел

## 5. Как проверено

| AC               | check_id      | Команда (cwd — корень рабочего дерева)                                                   | Exit | Результат                                                          |
| ---------------- | ------------- | ---------------------------------------------------------------------------------------- | ---- | ------------------------------------------------------------------ |
| AC-1, AC-2, AC-4 | review-docs   | ревью файлов автором; источники — ссылки в документах                                    | —    | ревью владельца не проводилось                                     |
| AC-3             | tf-fmt        | `terraform fmt -check` в `infra/cloudflare` (Terraform 1.13.3)                           | 0    | изменений нет                                                      |
| AC-3             | tf-init       | `terraform init -backend=false -input=false`                                             | 0    | провайдер `cloudflare/cloudflare` 5.25.0                           |
| AC-3             | tf-validate   | `terraform validate`                                                                     | 0    | `Success! The configuration is valid.`                             |
| AC-3             | tf-expr       | `terraform console`: `local.private_paths_expression`, `local.session_cookie_expression` | 0    | выражения построены, как задумано                                  |
| AC-5             | prettier-docs | `prettier --check docs/infrastructure/*.md docs/plans/2026-09-19-infrastructure-map.md`  | 0    | `All matched files use Prettier code style!`                       |
| —                | health-redis  | чтение `server/src/cache/noop.ts:6`, `server/src/health.ts:114`                          | —    | без `REDIS_URL` `/health` отвечает 503; вынесено отдельной задачей |

`pnpm format` запускает prettier только в пакетах `web` и `server` и документы не проверяет,
поэтому AC-5 проверен прямым вызовом prettier. `docs/README.md` не проходил prettier и до этой
работы; добавленные в него пять строк формат файла не меняют.

Ограничения: Terraform проверен без обращения к API Cloudflare. Для бесплатного плана по
документации подтверждено только `http.cookie` в правилах кеша. Функция `starts_with` и поля
`ip.src.country` и `cf.client.bot` на бесплатном плане не проверены; это покажет первый
`terraform plan` на реальной зоне.

## 6. Что осталось

Ответы владельца на раздел 8 карты. После них: запись в журнал, задачи из раздела 9 карты,
выбор провайдера (Q-01) и CDN, применение `infra/cloudflare/`.

# Правила кеша (фаза http_request_cache_settings). Подходящие правила применяются все по
# порядку, и при конфликте побеждает более позднее. Поэтому сначала идут правила «можно
# кешировать», а в конце — обходы кеша: они сильнее.
#
# Политику TTL задаёт источник заголовком Cache-Control (Nuxt routeRules). Cloudflare
# кеширует HTML, только если источник явно разрешил (edge_ttl = bypass_by_default).
# Российский CDN перед altera.ru так не умеет (docs/infrastructure/ru-cdn.md, раздел 4),
# поэтому там HTML на старте отдаётся без CDN.
#
# Бесплатный план: до 10 правил; свой ключ кеша (cookie, заголовки, страна, язык) —
# только Enterprise, поэтому язык страницы обязан быть в пути (/en), а не в заголовке.

resource "cloudflare_ruleset" "cache" {
  zone_id     = var.zone_id
  name        = "altera cache rules"
  description = "Кеширование altera.com: статика, публичные страницы, медиа, обходы"
  kind        = "zone"
  phase       = "http_request_cache_settings"

  rules = [
    {
      ref         = "static_assets"
      description = "Сборка Nuxt: имена файлов с хешем, неизменяемы"
      expression  = "(http.host eq \"${var.domain}\" and starts_with(http.request.uri.path, \"/_nuxt/\"))"
      action      = "set_cache_settings"
      action_parameters = {
        cache = true
        edge_ttl = {
          mode    = "override_origin"
          default = 31536000
        }
        browser_ttl = {
          mode = "respect_origin"
        }
      }
    },
    {
      ref         = "public_pages"
      description = "Публичные страницы: кешируются, только если источник прислал Cache-Control"
      expression  = "(http.host eq \"${var.domain}\")"
      action      = "set_cache_settings"
      action_parameters = {
        cache = true
        edge_ttl = {
          mode = "bypass_by_default"
        }
        browser_ttl = {
          mode = "respect_origin"
        }
        serve_stale = {
          disable_stale_while_updating = false
        }
        cache_key = {
          cache_deception_armor      = true
          ignore_query_strings_order = true
        }
      }
    },
    {
      ref         = "media"
      description = "Публичные варианты изображений: ключи неизменяемы, снятие — через очистку кеша"
      expression  = "(http.host eq \"${local.media_host}\")"
      action      = "set_cache_settings"
      action_parameters = {
        cache = true
        edge_ttl = {
          mode    = "override_origin"
          default = 31536000
          status_code_ttl = [
            {
              # Закрытый или ещё не опубликованный объект: коротко, чтобы публикация
              # открылась быстро даже без очистки.
              status_code_range = {
                from = 400
                to   = 499
              }
              value = 60
            },
            {
              # Ошибки источника не кешируются.
              status_code_range = {
                from = 500
                to   = 599
              }
              value = -1
            },
          ]
        }
        browser_ttl = {
          # Браузер нельзя очистить удалённо: сутки — компромисс между скоростью и тем,
          # как быстро снятое изображение пропадает у читателя.
          mode    = "override_origin"
          default = 86400
        }
      }
    },
    {
      ref         = "bypass_private_paths"
      description = "Кабинет, админка, вход, BFF, health и предпросмотр — никогда из кеша"
      expression  = "(http.host eq \"${var.domain}\" and (${local.private_paths_expression}))"
      action      = "set_cache_settings"
      action_parameters = {
        cache = false
      }
    },
    {
      ref         = "bypass_session"
      description = "Запрос с cookie сессии может отдать персональную страницу — мимо кеша"
      expression  = "(http.host eq \"${var.domain}\" and (${local.session_cookie_expression}))"
      action      = "set_cache_settings"
      action_parameters = {
        cache = false
      }
    },
  ]
}

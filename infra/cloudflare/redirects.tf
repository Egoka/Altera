resource "cloudflare_ruleset" "redirects" {
  zone_id     = var.zone_id
  name        = "altera redirects"
  description = "www на основной домен; гео-редирект России на altera.ru (выключен)"
  kind        = "zone"
  phase       = "http_request_dynamic_redirect"

  rules = [
    {
      ref         = "www_to_apex"
      description = "www.altera.com → altera.com"
      expression  = "(http.host eq \"www.${var.domain}\")"
      action      = "redirect"
      action_parameters = {
        from_value = {
          status_code           = 301
          preserve_query_string = true
          target_url = {
            expression = "concat(\"https://${var.domain}\", http.request.uri.path)"
          }
        }
      }
    },
    {
      # Провайдеры в РФ с 2025 года замедляют соединения с Cloudflare, но короткий ответ
      # с редиректом обычно проходит. Путь сохраняется, поэтому правило имеет смысл только
      # при схеме, где у обоих доменов одинаковые адреса (docs/infrastructure/README.md,
      # решение владельца о локалях). Проверенные боты не перенаправляются.
      ref         = "ru_visitors_to_ru_domain"
      description = "Посетители из России → altera.ru"
      enabled     = var.enable_ru_geo_redirect
      expression  = "(http.host eq \"${var.domain}\" and ip.src.country eq \"RU\" and not cf.client.bot)"
      action      = "redirect"
      action_parameters = {
        from_value = {
          status_code           = 302
          preserve_query_string = true
          target_url = {
            expression = "concat(\"https://${var.ru_domain}\", http.request.uri.path)"
          }
        }
      }
    },
  ]
}

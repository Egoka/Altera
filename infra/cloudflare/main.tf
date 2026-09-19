locals {
  media_host = "media.${var.domain}"

  # Персональные и служебные адреса (ADR-0004, таблица адресов): кабинет, админка, вход,
  # BFF /api, health. Английские варианты — под /en (ADR-0002 п. 5).
  private_exact_paths = [
    "/login", "/me", "/admin", "/health",
    "/en/login", "/en/me", "/en/admin",
  ]
  private_path_prefixes = [
    "/api/", "/auth/", "/me/", "/admin/",
    "/en/auth/", "/en/me/", "/en/admin/",
  ]

  private_paths_expression = join(" or ", concat(
    ["http.request.uri.path in {${join(" ", formatlist("\"%s\"", local.private_exact_paths))}}"],
    [for prefix in local.private_path_prefixes : "starts_with(http.request.uri.path, \"${prefix}\")"],
    # Предпросмотр неопубликованной версии никогда не кешируется (docs/spec/20-public/article.md).
    ["http.request.uri.query contains \"preview=\""],
  ))

  session_cookie_expression = join(" or ", [
    for name in var.session_cookie_names : "http.cookie contains \"${name}=\""
  ])
}

# --- DNS -------------------------------------------------------------------------------

resource "cloudflare_dns_record" "apex" {
  zone_id = var.zone_id
  name    = var.domain
  type    = "A"
  content = var.origin_ipv4
  proxied = true
  ttl     = 1
  comment = "Gateway кластера Kubernetes в РФ (web для мирового рынка)"
}

resource "cloudflare_dns_record" "www" {
  zone_id = var.zone_id
  name    = "www.${var.domain}"
  type    = "CNAME"
  content = var.domain
  proxied = true
  ttl     = 1
  comment = "Только редирект на основной домен (redirects.tf)"
}

resource "cloudflare_dns_record" "media" {
  zone_id = var.zone_id
  name    = local.media_host
  type    = "CNAME"
  content = var.media_origin_hostname
  proxied = true
  ttl     = 1
  comment = "Публичные варианты изображений из S3 в РФ"
}

# --- Настройки зоны -------------------------------------------------------------------

# Источник — Gateway кластера с действительным сертификатом (cert-manager или Origin CA).
resource "cloudflare_zone_setting" "ssl" {
  zone_id    = var.zone_id
  setting_id = "ssl"
  value      = "strict"
}

resource "cloudflare_zone_setting" "always_use_https" {
  zone_id    = var.zone_id
  setting_id = "always_use_https"
  value      = "on"
}

resource "cloudflare_zone_setting" "min_tls_version" {
  zone_id    = var.zone_id
  setting_id = "min_tls_version"
  value      = "1.2"
}

resource "cloudflare_zone_setting" "http3" {
  zone_id    = var.zone_id
  setting_id = "http3"
  value      = "on"
}

# Tiered Cache со Smart Topology доступен на бесплатном плане: промахи верхнего уровня
# собираются в одном дата-центре Cloudflare рядом с источником, и в РФ уходит меньше запросов.
resource "cloudflare_argo_tiered_caching" "this" {
  zone_id = var.zone_id
  value   = "on"
}

resource "cloudflare_tiered_cache" "smart" {
  zone_id = var.zone_id
  value   = "on"
}

# Cloudflare предъявляет клиентский сертификат источнику. Пока Gateway его не проверяет,
# включение ничего не ломает; после настройки mTLS на Gateway источник принимает только Cloudflare.
resource "cloudflare_authenticated_origin_pulls_settings" "this" {
  zone_id = var.zone_id
  enabled = true
}

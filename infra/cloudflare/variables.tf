variable "zone_id" {
  description = "ID зоны домена в Cloudflare (создаётся после покупки домена и переноса NS)."
  type        = string
}

variable "domain" {
  description = "Домен для мирового рынка."
  type        = string
  default     = "altera.com"
}

variable "ru_domain" {
  description = "Домен для России; нужен только для гео-редиректа."
  type        = string
  default     = "altera.ru"
}

variable "origin_ipv4" {
  description = "Внешний IPv4 балансировщика (Gateway) кластера Kubernetes в РФ, куда Cloudflare ходит за страницами."
  type        = string
}

variable "media_origin_hostname" {
  description = <<-EOT
    Имя источника для media.<domain>. Бесплатный план Cloudflare не подменяет Host
    к источнику (Origin Rules: Host header override — только Enterprise), поэтому источник
    обязан принять Host «media.<domain>»: либо бакет с именем, равным этому хосту, у
    провайдера, который так умеет, либо маршрут /media в Gateway кластера, который
    проксирует в бакет. Выбор — в docs/infrastructure/cloudflare-altera-com.md, раздел «Медиа».
  EOT
  type        = string
}

variable "session_cookie_names" {
  description = <<-EOT
    Имена cookie, наличие которых означает сессию пользователя. С такой cookie страница
    может содержать персональные данные и не кешируется. Имя должно совпадать с тем, что
    выставляет BFF Nuxt (ADR-0023: refresh-cookie); в коде его пока нет.
  EOT
  type        = list(string)
  default     = ["altera_session"]

  validation {
    condition     = length(var.session_cookie_names) > 0
    error_message = "Нужна хотя бы одна cookie сессии, иначе персональные страницы попадут в общий кеш."
  }
}

variable "enable_ru_geo_redirect" {
  description = <<-EOT
    Перенаправлять посетителей из России с altera.com на altera.ru. Выключено до решения
    владельца: соответствие адресов двух доменов зависит от выбора схемы локалей.
  EOT
  type        = bool
  default     = false
}

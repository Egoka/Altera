# Cloudflare перед altera.com: DNS, кеширование, редиректы, настройки зоны.
# Описание и порядок применения — docs/infrastructure/cloudflare-altera-com.md.

terraform {
  required_version = ">= 1.6.0"

  required_providers {
    cloudflare = {
      source  = "cloudflare/cloudflare"
      version = "~> 5.0"
    }
  }

  # Состояние хранится в S3-совместимом бакете у российского провайдера, когда он выбран
  # (Q-01). До этого — локальное состояние, в git не попадает (.gitignore рядом).
  # backend "s3" {
  #   bucket                      = "altera-terraform-state"
  #   key                         = "cloudflare/altera-com.tfstate"
  #   region                      = "ru-central1"
  #   endpoints                   = { s3 = "https://storage.yandexcloud.net" }
  #   skip_credentials_validation = true
  #   skip_region_validation      = true
  #   skip_requesting_account_id  = true
  #   skip_s3_checksum            = true
  #   use_path_style              = true
  # }
}

# Токен берётся из переменной окружения CLOUDFLARE_API_TOKEN.
# Права токена: Zone Settings Edit, Zone DNS Edit, Zone Cache Rules Edit,
# Zone Single Redirect Edit, Zone Cache Purge (для приложения — отдельный токен).
provider "cloudflare" {}

# Настройка переменных окружения

## Обязательные переменные

### База данных

- `DATABASE_URL` - URL подключения к PostgreSQL
- `DATABASE_URL_UNPOOLED` - URL для прямого подключения к БД (для миграций)

### Redis

- `REDIS_URL` - URL подключения к Redis
- `CACHE_TTL` - время жизни кэша в секундах (по умолчанию: 21600 = 6 часов)

### JWT токены

- `JWT_ACCESS_SECRET` - секретный ключ для access токенов
- `JWT_REFRESH_SECRET` - секретный ключ для refresh токенов

### CORS

- `FRONTEND_URL` - URL фронтенда для настройки CORS

## Опциональные переменные

### Сервер

- `PORT` - порт сервера (по умолчанию: 4000)
- `NODE_ENV` - окружение (development/production)

### Magic Link

- `MAGIC_LINK_EXPIRY_MINUTES` - время жизни magic link в минутах (по умолчанию: 15)
- `MAGIC_LINK_BASE_URL` - базовый URL для magic link (по умолчанию: http://localhost:3000/auth/verify)

### JWT токены

- `JWT_ACCESS_TOKEN_EXPIRY` - время жизни access токена (по умолчанию: 15m)
- `JWT_REFRESH_TOKEN_EXPIRY` - время жизни refresh токена (по умолчанию: 7d)

## Настройка

1. Скопируйте `env.example` в `.env`:

   ```bash
   cp env.example .env
   ```

2. Отредактируйте `.env` файл, указав ваши значения

3. Убедитесь, что `.env` файл добавлен в `.gitignore` (уже добавлен)

## Генерация секретных ключей

Для генерации секретных ключей JWT используйте:

```bash
# Для JWT_ACCESS_SECRET
openssl rand -base64 32

# Для JWT_REFRESH_SECRET
openssl rand -base64 32
```

## Пример .env файла

```env
# Server Configuration
PORT=4000
NODE_ENV=development

# Frontend URL for CORS
FRONTEND_URL=http://localhost:3000

# Database Configuration
DATABASE_URL="postgresql://username:password@localhost:5432/altera"
DATABASE_URL_UNPOOLED="postgresql://username:password@localhost:5432/altera"

# Redis Configuration
REDIS_URL=redis://localhost:6379
CACHE_TTL=21600

# JWT Configuration
JWT_ACCESS_SECRET=your-super-secret-access-key-here
JWT_REFRESH_SECRET=your-super-secret-refresh-key-here

# Magic Link Configuration
MAGIC_LINK_EXPIRY_MINUTES=15
MAGIC_LINK_BASE_URL=http://localhost:3000/auth/verify

# Security Configuration
JWT_ACCESS_TOKEN_EXPIRY=15m
JWT_REFRESH_TOKEN_EXPIRY=7d

# Cache Configuration
CACHE_TTL=21600
```

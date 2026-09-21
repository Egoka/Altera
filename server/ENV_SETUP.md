# Настройка переменных окружения

## Обязательные переменные

### База данных

- `DATABASE_URL` - URL подключения к PostgreSQL
- `DATABASE_URL_UNPOOLED` - URL для прямого подключения к БД (для миграций)

### Redis

- `REDIS_URL` - URL подключения к Redis
- `CACHE_TTL` - время жизни кэша в секундах (по умолчанию: 21600 = 6 часов)

### Хранилище медиа (T-062)

- `STORAGE_DRIVER` - `local` или `s3`. Вне production без значения используется `local`:
  объекты лежат в `STORAGE_LOCAL_DIR` (по умолчанию `.storage`), сервер сам раздаёт их по
  `/media/<ключ>`. В production `local` запрещён, а без значения каждая операция хранилища
  возвращает `PROVIDER_UNAVAILABLE: storage`.
- `STORAGE_MEDIA_BASE_URL` - префикс публичных ссылок на варианты: CDN-домен провайдера для `s3`
  (обязателен), для `local` по умолчанию `http://localhost:$PORT/media`.
- `STORAGE_SIGNING_SECRET` - ключ подписи ссылок локальной реализации; без него ссылки
  действуют до перезапуска процесса.
- `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`,
  `S3_FORCE_PATH_STYLE` (`true` — адрес вида `endpoint/bucket/key`) - параметры `s3`. Провайдер
  не выбран (Q-01): адаптер работает с любым S3-совместимым API.

### JWT токены

- `JWT_ACCESS_SECRET` - секретный ключ для access токенов

### CORS

- `FRONTEND_URL` - URL фронтенда для настройки CORS

## Опциональные переменные

### Сервер

- `PORT` - порт сервера (по умолчанию: 4000)
- `NODE_ENV` - окружение (development/production)

### Magic Link

- `MAGIC_LINK_EXPIRY_MINUTES` - время жизни magic link в минутах (по умолчанию: 15)
- `MAGIC_LINK_BASE_URL` - базовый URL для magic link (по умолчанию: http://localhost:3000/auth/verify)

### Почта (T-021)

- `MAIL_TRANSPORT` - `smtp`, `console` или `fake`. Вне production без значения используется
  `console`: письмо не доставляется, в логах остаются только шаблон, статус, провайдер и
  `messageId`. В production неявный `console` не подставляется: без значения каждая отправка
  фиксируется как `failed` и возвращает `PROVIDER_UNAVAILABLE: mail`; `fake` в production запрещён.
- `MAIL_FROM` - адрес отправителя (вне production по умолчанию `Altera <no-reply@localhost>`;
  для `smtp` в production обязателен).
- `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE` (`true`/`false`), `SMTP_USER` и `SMTP_PASSWORD`
  (задаются вместе) - параметры `smtp`. Локально это Mailpit из `docker-compose.yml`:
  SMTP `localhost:21025`, веб-интерфейс `http://localhost:28025`. Реальный провайдер — Q-01.

### Хранилище медиа (T-062)

- `STORAGE_DRIVER` - `local` или `s3`. Вне production без значения используется `local`:
  объекты лежат в `STORAGE_LOCAL_DIR` (по умолчанию `.storage`), сервер сам раздаёт их по
  `/media/<ключ>`. В production `local` запрещён, а без значения каждая операция хранилища
  возвращает `PROVIDER_UNAVAILABLE: storage`.
- `STORAGE_MEDIA_BASE_URL` - префикс публичных ссылок на варианты: CDN-домен провайдера для `s3`
  (обязателен), для `local` по умолчанию `http://localhost:$PORT/media`.
- `STORAGE_SIGNING_SECRET` - ключ подписи ссылок локальной реализации; без него ссылки
  действуют до перезапуска процесса.
- `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`,
  `S3_FORCE_PATH_STYLE` (`true` — адрес вида `endpoint/bucket/key`) - параметры `s3`. Провайдер
  не выбран (Q-01): адаптер работает с любым S3-совместимым API.

### JWT токены

- `JWT_ACCESS_TOKEN_EXPIRY` - время жизни access токена (по умолчанию: 15m)

Refresh-токен не является JWT и секрета не требует: это случайное значение, хэш которого
хранится в таблице сессий, а срок задан в коде (30 дней, ADR-0009 п. 1).

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
DATABASE_URL="postgresql://username:password@localhost:25432/altera"
DATABASE_URL_UNPOOLED="postgresql://username:password@localhost:25432/altera"

# Redis Configuration
REDIS_URL=redis://localhost:26379
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

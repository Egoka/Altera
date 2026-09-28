import { createServer, type Server } from "node:http"
import type { AddressInfo } from "node:net"
import { afterEach, describe, expect, it } from "vitest"
import {
  createBackupMonitorFromEnv,
  createHealthCheck,
  createProviderProbes,
  withHealth,
  type BackupRunsClient,
  type MailHistoryClient
} from "../src/health"
import { createMailConfigFromEnv } from "../src/mail/config"
import { createStorageConfigFromEnv } from "../src/storage/config"

// T-088 AC-2: контрактный тест — `/health` не раскрывает секретов
// (`80-observability/health-and-alerts.md` п. 1 «без ПДн и секретов», §27.6, §28.11).
// Проверка собирается из тех же функций окружения, что и `src/server.ts`: секрет, попавший в
// состояние зависимости, был бы виден здесь.

const SECRETS = {
  DATABASE_URL: "postgresql://altera:db-password-value@db.internal:5432/altera",
  JWT_ACCESS_SECRET: "jwt-secret-value",
  LOG_HASH_SECRET: "log-hash-secret-value",
  STORAGE_SIGNING_SECRET: "storage-signing-secret-value",
  SMTP_USER: "smtp-user-value",
  SMTP_PASSWORD: "smtp-password-value",
  S3_ACCESS_KEY_ID: "s3-access-key-value",
  S3_SECRET_ACCESS_KEY: "s3-secret-key-value"
} as const

const ENV = {
  ...SECRETS,
  NODE_ENV: "production",
  MAIL_TRANSPORT: "smtp",
  MAIL_FROM: "Altera <no-reply@altera.test>",
  SMTP_HOST: "smtp.altera.test",
  SMTP_PORT: "587",
  SMTP_SECURE: "true",
  STORAGE_DRIVER: "s3",
  // Неслушающий порт: проверка провайдера отказывает сразу, без ожидания сети.
  S3_ENDPOINT: "http://127.0.0.1:1",
  S3_REGION: "ru-central1",
  S3_BUCKET: "altera-media-private",
  S3_FORCE_PATH_STYLE: "true",
  STORAGE_MEDIA_BASE_URL: "https://cdn.altera.test/media"
} as const

/** Ожидаемый набор ключей ответа: новое поле должно попасть сюда осознанно. */
const CONTRACT_KEYS = [
  "status",
  "revision",
  "checkedAt",
  "checks",
  "checks.postgres",
  "checks.redis",
  "checks.migrations",
  "components",
  ...["db", "redis", "psp", "ai", "mail", "storage"].flatMap((name) => [
    `components.${name}`,
    `components.${name}.status`,
    `components.${name}.adapter`,
    `components.${name}.latencyMs`
  ]),
  "backups",
  ...["database", "media"].flatMap((kind) => [
    `backups.${kind}`,
    `backups.${kind}.status`,
    `backups.${kind}.lastSuccessAt`,
    `backups.${kind}.ageSeconds`,
    `backups.${kind}.maxAgeSeconds`
  ])
].sort()

const paths = (value: unknown, prefix = ""): string[] => {
  if (typeof value !== "object" || value === null) return []
  return Object.entries(value).flatMap(([key, nested]) => {
    const path = prefix ? `${prefix}.${key}` : key
    return [path, ...paths(nested, path)]
  })
}

const servers: Server[] = []

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((resolve) => {
          server.closeAllConnections()
          server.close(() => resolve())
        })
    )
  )
})

const serveConfiguredHealth = async (): Promise<string> => {
  const storageConfig = createStorageConfigFromEnv(ENV)
  const mailConfig = createMailConfigFromEnv(ENV)
  const mailHistory: MailHistoryClient = {
    mailMessage: { findFirst: async () => ({ status: "failed" }) }
  }
  const backupRuns: BackupRunsClient = {
    backupRun: { groupBy: async () => [] }
  }
  const check = createHealthCheck(
    {
      // Отказ базы приходит с сообщением драйвера, в котором есть строка подключения.
      postgres: async () => {
        throw new Error(`connect ECONNREFUSED: ${ENV.DATABASE_URL}`)
      },
      migrations: async () => false,
      redis: async () => {
        throw new Error("redis://default:redis-password-value@cache:6379")
      },
      providers: createProviderProbes({
        storage: storageConfig.storage,
        mail: mailConfig.transport,
        mailHistory
      }),
      backups: createBackupMonitorFromEnv(ENV, backupRuns)
    },
    "b".repeat(40)
  )
  const server = createServer(
    withHealth((_request, response) => {
      response.statusCode = 418
      response.end("graphql fallback")
    }, check)
  )
  servers.push(server)
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject)
    server.listen(0, "127.0.0.1", resolve)
  })
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`
}

describe("/health не раскрывает секретов", () => {
  it("не содержит ни одного значения секрета, адреса и строки подключения", async () => {
    const url = await serveConfiguredHealth()
    const response = await fetch(`${url}/health`)
    expect(response.status).toBe(503)
    const payload = await response.text()

    for (const [key, secret] of Object.entries(SECRETS)) {
      expect(payload, `${key} не должен попадать в ответ`).not.toContain(secret)
    }
    for (const leak of [
      "db-password-value",
      "redis-password-value",
      "smtp.altera.test",
      "no-reply@altera.test",
      "altera-media-private",
      "127.0.0.1:1",
      "cdn.altera.test",
      "ECONNREFUSED"
    ]) {
      expect(payload, `${leak} не должен попадать в ответ`).not.toContain(leak)
    }
    expect(payload).not.toMatch(/@/)
  })

  it("отдаёт только поля контракта: имена адаптеров, статусы и возраст копий", async () => {
    const url = await serveConfiguredHealth()
    const health: unknown = await (await fetch(`${url}/health`)).json()
    expect(paths(health).sort()).toEqual(CONTRACT_KEYS)
    expect(health).toMatchObject({
      status: "unavailable",
      revision: "b".repeat(40),
      components: {
        mail: { status: "down", adapter: "smtp" },
        storage: { status: "down", adapter: "s3" },
        db: { status: "down", adapter: "postgres" }
      },
      // Production без отметок копирования: копии обязательны, подтверждения нет.
      backups: { database: { status: "unknown" }, media: { status: "unknown" } }
    })
  })
})

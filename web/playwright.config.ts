import { defineConfig, devices } from "@playwright/test"

const port = 4173
const databaseUrl = process.env.T069_TEST_DATABASE_URL ?? "postgresql://test:test@127.0.0.1:5432/test"
// SMTP-порт Mailpit из docker-compose.yml; в CI поднимается тот же сервис с теми же портами.
const smtpPort = process.env.T021_SMTP_PORT ?? "21025"

export default defineConfig({
  testDir: "./tests/e2e",
  outputDir: "./test-results",
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    trace: "on-first-retry"
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] }
    }
  ],
  webServer: [
    {
      name: "API",
      command: "pnpm --filter server run dev",
      env: {
        DATABASE_URL: databaseUrl,
        DATABASE_URL_UNPOOLED: databaseUrl,
        FRONTEND_URL: `http://127.0.0.1:${port}`,
        JWT_ACCESS_SECRET: "t009-test-access-secret",
        JWT_REFRESH_SECRET: "t009-test-refresh-secret",
        LOG_HASH_SECRET: "t053-test-log-hash-secret",
        MAGIC_LINK_BASE_URL: `http://127.0.0.1:${port}/auth/verify`,
        MAIL_TRANSPORT: "smtp",
        SMTP_HOST: "127.0.0.1",
        SMTP_PORT: smtpPort,
        PORT: "4000",
        REQUEST_ID_FORWARD_SECRET: "t087-e2e-forward-secret"
      },
      url: "http://127.0.0.1:4000/",
      reuseExistingServer: false,
      timeout: 120_000
    },
    {
      name: "Nitro",
      // Собранный сервер не использует dev/HMR-прокси, который завершался при EPIPE.
      command: "pnpm run build && node .output/server/index.mjs",
      env: {
        NUXT_GRAPHQL_API_URL: "http://127.0.0.1:4000/",
        NUXT_REQUEST_ID_FORWARD_SECRET: "t087-e2e-forward-secret",
        NITRO_HOST: "127.0.0.1",
        NITRO_PORT: String(port)
      },
      url: `http://127.0.0.1:${port}`,
      reuseExistingServer: false,
      timeout: 120_000
    }
  ]
})

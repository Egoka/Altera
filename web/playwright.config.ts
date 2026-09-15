import { defineConfig, devices } from "@playwright/test"

const port = 4173

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
      command:
        "DATABASE_URL=postgresql://test:test@127.0.0.1:5432/test JWT_ACCESS_SECRET=t009-test-access-secret JWT_REFRESH_SECRET=t009-test-refresh-secret FRONTEND_URL=http://127.0.0.1:4173 PORT=4000 pnpm --filter server run dev",
      url: "http://127.0.0.1:4000/",
      reuseExistingServer: false,
      timeout: 120_000
    },
    {
      command: `NUXT_GRAPHQL_API_URL=http://127.0.0.1:4000/ pnpm run dev --host 127.0.0.1 --port ${port}`,
      url: `http://127.0.0.1:${port}`,
      reuseExistingServer: false,
      timeout: 120_000
    }
  ]
})

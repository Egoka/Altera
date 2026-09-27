import path from "node:path"
import { defineConfig } from "vitest/config"

// Тесты лежат вне `src`, поэтому не попадают в сборку `tsc` (rootDir: src).
export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    environment: "node"
  },
  resolve: {
    alias: {
      // `@altera/content` публикует собранный `dist`, а тесты берут исходники пакета: иначе
      // `pnpm test` зависел бы от порядка сборки пакетов в монорепозитории.
      "@altera/content": path.resolve(__dirname, "../packages/content/src/index.ts")
    }
  }
})

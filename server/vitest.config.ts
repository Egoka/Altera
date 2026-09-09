import { defineConfig } from "vitest/config"

// Тесты лежат вне `src`, поэтому не попадают в сборку `tsc` (rootDir: src).
export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    environment: "node"
  }
})

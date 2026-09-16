import { fileURLToPath } from "node:url"
import vue from "@vitejs/plugin-vue"
import { defineConfig } from "vitest/config"

export default defineConfig({
  plugins: [vue()],
  resolve: {
    // Алиас Nuxt `~` → `app/`: модули из `app/utils` импортируют типы и константы через него.
    alias: { "~": fileURLToPath(new URL("./app", import.meta.url)) }
  },
  test: {
    include: ["tests/**/*.test.ts"],
    environment: "node"
  }
})

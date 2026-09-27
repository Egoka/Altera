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
    environment: "node",
    // fishtvue импортирует CSS (`v-calendar/dist/style.css`), который Node не загрузит напрямую:
    // пакет прогоняется через Vite, чтобы тесты могли монтировать настоящие компоненты.
    server: { deps: { inline: ["fishtvue"] } }
  }
})

import path from "path"
import { fileURLToPath } from "url"
import tsParser from "@typescript-eslint/parser"
import typescriptEslint from "@typescript-eslint/eslint-plugin"
import vuePlugin from "eslint-plugin-vue"
import vueParser from "vue-eslint-parser"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
// импорт кастомного правила
// const noConsoleLog = await import(path.resolve(__dirname, "eslint-rules/no-console-log.js")).then(m => m.default ?? m);

export default [
  {
    ignores: ["**/node_modules/**", "**/dist/**", "**/.nuxt/**", "**/coverage/**", "server/src/prisma/*"]
  },

  // === Для TypeScript и JavaScript файлов ===
  {
    files: ["**/*.ts", "**/*.js"],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        ecmaVersion: "latest",
        sourceType: "module"
      }
    },
    plugins: {
      "@typescript-eslint": typescriptEslint,
      local: {
        rules: {}
      }
    },
    rules: {
      "@typescript-eslint/no-unused-vars": "error",
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/ban-ts-comment": "off",
      "@typescript-eslint/no-dynamic-delete": "off",
      "@typescript-eslint/consistent-type-definitions": ["error", "interface"]
    }
  },

  // === Для Vue файлов (.vue) ===
  {
    files: ["**/*.vue"],
    languageOptions: {
      parser: vueParser,
      parserOptions: {
        parser: tsParser,
        ecmaVersion: "latest",
        sourceType: "module",
        extraFileExtensions: [".vue"]
      }
    },
    plugins: {
      vue: vuePlugin,
      "@typescript-eslint": typescriptEslint,
      local: {
        rules: {}
      }
    },
    rules: {
      // Vue
      "vue/no-unused-vars": "error",
      "vue/html-self-closing": "off",
      "vue/no-v-html": "off",

      // TypeScript внутри <script lang="ts">
      "@typescript-eslint/no-unused-vars": "error",
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/ban-ts-comment": "off",
      "@typescript-eslint/consistent-type-definitions": ["error", "interface"]
    }
  }
]

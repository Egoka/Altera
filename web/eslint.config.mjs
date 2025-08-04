import tsParser from "@typescript-eslint/parser"
import typescriptEslint from "@typescript-eslint/eslint-plugin"
import vuePlugin from "eslint-plugin-vue"
import vueParser from "vue-eslint-parser"

export default [
  {
    ignores: ["**/node_modules/**", "**/dist/**", "**/.nuxt/**", "**/coverage/**", "server/src/generated/*"]
  },
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
      "vue/no-unused-vars": "error",
      "vue/html-self-closing": "off",
      "vue/no-v-html": "off",
      "@typescript-eslint/no-unused-vars": "error",
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/ban-ts-comment": "off",
      "@typescript-eslint/consistent-type-definitions": ["error", "interface"]
    }
  }
]

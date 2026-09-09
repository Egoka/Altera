// https://nuxt.com/docs/api/configuration/nuxt-config
import { defineNuxtConfig } from "nuxt/config"
import tailwindcss from "@tailwindcss/vite"

export default defineNuxtConfig({
  compatibilityDate: "2025-07-15",
  devtools: { enabled: false },

  modules: [
    "@nuxt/eslint",
    "@nuxt/fonts",
    "@nuxt/icon",
    "@nuxt/image",
    "@nuxt/test-utils",
    "@pinia/nuxt",
    "@vueuse/nuxt",
    "@nuxtjs/color-mode",
    "@nuxtjs/i18n",
    "fishtvue/module"
  ],

  css: ["~/assets/css/main.css"],

  vite: {
    plugins: [tailwindcss()]
  },
  fishtvue: {
    prefix: "",
    theme: {
      semantic: {
        customThemeColor: 150,
        customThemeColorContrast: 0
      }
    },
    componentsOptions: {
      Button: {
        class: "font-semibold"
      }
    },
    optionsTheme: {
      isNotMinifyCSS: true,
      darkModeSelector: "html.dark"
    }
  },

  // Конфигурация иконок
  icon: {
    customCollections: [
      {
        prefix: "a-icon",
        dir: "./app/assets/icons"
      }
    ]
  },

  // Конфигурация цветовых режимов
  colorMode: {
    preference: "system", // system, light, dark
    fallback: "light",
    classSuffix: "",
    storageKey: "nuxt-color-mode"
  },

  // Конфигурация интернационализации
  i18n: {
    locales: [
      {
        code: "en",
        iso: "en-US",
        name: "English",
        file: "en.json"
      },
      {
        code: "ru",
        iso: "ru-RU",
        name: "Русский",
        file: "ru.json"
      }
    ],
    defaultLocale: "en",
    strategy: "prefix_except_default",
    detectBrowserLanguage: {
      useCookie: true,
      cookieKey: "i18n_redirected",
      redirectOn: "root"
    }
  }
})

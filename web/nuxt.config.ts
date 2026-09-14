// https://nuxt.com/docs/api/configuration/nuxt-config
import { defineNuxtConfig } from "nuxt/config"
import type { NuxtPage } from "@nuxt/schema"
import tailwindcss from "@tailwindcss/vite"

const DEV_ONLY_ROUTES = new Set(["/fonts-showcase", "/components-showcase", "/test-error"])

const removeDevOnlyPages = (pages: NuxtPage[]) => {
  for (let index = pages.length - 1; index >= 0; index -= 1) {
    const page = pages[index]

    if (!page) continue

    if (DEV_ONLY_ROUTES.has(page.path)) {
      pages.splice(index, 1)
      continue
    }

    if (page.children) {
      removeDevOnlyPages(page.children)
    }
  }
}

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

  hooks: {
    "pages:extend": (pages) => {
      if (process.env.NODE_ENV === "production") {
        removeDevOnlyPages(pages)
      }
    }
  },

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

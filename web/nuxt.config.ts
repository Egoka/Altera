// https://nuxt.com/docs/api/configuration/nuxt-config
import { fileURLToPath } from "node:url"
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

  runtimeConfig: {
    graphqlApiUrl: "http://127.0.0.1:4000/",
    requestIdForwardSecret: "",
    // Сколько доверенных прокси площадки стоит перед BFF: из `X-Forwarded-For` берётся элемент,
    // добавленный самым внешним из них (`server/utils/clientAddress.ts`). Свойство площадки,
    // а не продуктовое правило: за Cloudflare и Gateway значение 2, на Render — 1.
    trustedProxyHops: 1
  },

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

  routeRules: {
    "/ru": { redirect: { to: "/", statusCode: 301 } },
    // [ДОПУЩЕНИЕ] Отдельной регистрации нет: первый вход по ссылке создаёт аккаунт
    // (docs/spec/20-public/login.md §3).
    "/signup": { redirect: { to: "/login", statusCode: 301 } },
    "/register": { redirect: { to: "/login", statusCode: 301 } },
    "/en/signup": { redirect: { to: "/en/login", statusCode: 301 } },
    "/en/register": { redirect: { to: "/en/login", statusCode: 301 } },
    // Каталог рубрик переехал с `/types` на `/sections` (`sections-index.md` §3).
    "/types": { redirect: { to: "/sections", statusCode: 301 } },
    "/en/types": { redirect: { to: "/en/sections", statusCode: 301 } },
    // Старые адреса подписки ведут на единственную страницу планов
    // (`docs/spec/20-public/pricing.md` §3, помечено там как `[ДОПУЩЕНИЕ]`).
    "/plans": { redirect: { to: "/pricing", statusCode: 301 } },
    "/subscribe": { redirect: { to: "/pricing", statusCode: 301 } },
    "/en/plans": { redirect: { to: "/en/pricing", statusCode: 301 } },
    "/en/subscribe": { redirect: { to: "/en/pricing", statusCode: 301 } },
    // Сводка кабинета (`docs/spec/30-account/reader/dashboard.md` §4): все ответы персональные.
    "/me": { headers: { "cache-control": "private, no-store" } },
    // Страница «Подписка» (`docs/spec/30-account/reader/subscription.md` §3, §10): старые адреса
    // `/me/billing`, `/me/plan` — `[ДОПУЩЕНИЕ]`; ответ личный и не кешируется.
    "/me/billing": { redirect: { to: "/me/subscription", statusCode: 301 } },
    "/me/plan": { redirect: { to: "/me/subscription", statusCode: 301 } },
    "/me/subscription": { headers: { "cache-control": "private, no-store" } }
  },

  hooks: {
    "pages:extend": (pages) => {
      if (process.env.NODE_ENV === "production") {
        removeDevOnlyPages(pages)
      }
    },
    // Nuxt к этому моменту уже поставил свой обработчик; `server/error.ts` встаёт перед ним.
    "nitro:config": (nitroConfig) => {
      const handlers = [nitroConfig.errorHandler ?? []].flat()
      nitroConfig.errorHandler = [fileURLToPath(new URL("./server/error", import.meta.url)), ...handlers]
    }
  },

  vite: {
    plugins: [tailwindcss()]
  },
  fishtvue: {
    prefix: "",
    componentsStyle: "outlined",
    theme: {
      semantic: {
        customThemeColor: 150,
        customThemeColorContrast: 0
      }
    },
    componentsOptions: {
      Button: {
        class: "font-semibold"
      },
      Table: {
        class: "app-table__component"
      },
      Form: {
        class: "app-form__component"
      },
      // fishtvue 1.0: `class` — корень диалога (бывший `classBody`), карточка — `classes.content`
      // (бывший `class`).
      Dialog: {
        class: "app-dialog__body",
        classes: { content: "app-dialog" }
      }
    },
    optionsTheme: {
      isNotMinifyCSS: true,
      darkModeSelector: "html.dark",
      layers: "theme, base, fishtvue, components, utilities"
    }
  },

  // Картинки не обрабатываются на лету (ADR-0030). IPX требовал `sharp` в процессе Nuxt, а
  // платформенного бинарника `sharp` 0.32 в сборке нет: `/_ipx/...` отвечал 500, сборка
  // предупреждала о `sharp`. `none` отдаёт `src` как есть; варианты и `srcset` пользовательских
  // изображений строит `MediaPicture` из набора, сделанного при загрузке (T-064).
  image: {
    provider: "none"
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
    defaultLocale: "ru",
    strategy: "prefix_except_default",
    detectBrowserLanguage: false
  }
})

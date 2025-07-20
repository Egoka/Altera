import type { RouterConfig } from "@nuxt/schema"

// https://router.vuejs.org/api/interfaces/routeroptions.html
export default <RouterConfig>{
  scrollBehavior(to, _form, savedPosition) {
    return new Promise((resolve) => {
      setTimeout(() => {
        if (history.state.smooth) {
          resolve({
            el: history.state.smooth,
            behavior: "smooth"
          })
        }

        if (to.hash) {
          const el = document.querySelector(to.hash) as any
          if (!el) resolve({ el: to.hash, top: 0 })

          const { marginTop } = getComputedStyle(el)
          const marginTopValue = Number.parseInt(marginTop)
          const offset = (document.querySelector(to.hash) as any).offsetTop - marginTopValue

          resolve({
            top: offset,
            behavior: "smooth"
          })
        }

        // Scroll to top of window
        if (savedPosition) resolve(savedPosition)
        else resolve({ top: 0 })
      }, 1) // Hack page wise navigation
    })
  },
  routes: () => [
    // === Публичные маршруты ===
    {
      name: "article-view",
      path: "/articles/:slug",
      component: () => import("@/pages/articles/[slug].vue"),
      meta: { public: true }
    },
    {
      name: "type-view",
      path: "/types/:slug",
      component: () => import("@/pages/types/[slug].vue"),
      meta: { public: true }
    },
    {
      name: "tag-view",
      path: "/tags/:slug",
      component: () => import("@/pages/tags/[slug].vue"),
      meta: { public: true }
    },
    {
      name: "author-profile",
      path: "/authors/:slug",
      component: () => import("@/pages/authors/[slug].vue"),
      meta: { public: true }
    },

    // === Пользователь ===
    {
      name: "me",
      path: "/me",
      component: () => import("@/pages/me/index.vue"),
      meta: { requiresAuth: true, role: "user" }
    },
    {
      name: "my-articles",
      path: "/me/articles",
      component: () => import("@/pages/me/articles/index.vue"),
      meta: { requiresAuth: true, role: "user" }
    },
    {
      name: "my-article-view",
      path: "/me/articles/:slug",
      component: () => import("@/pages/me/articles/[slug].vue"),
      meta: { requiresAuth: true, role: "user" }
    },
    {
      name: "my-article-edit",
      path: "/me/articles/:slug/edit",
      component: () => import("@/pages/me/articles/[slug]/edit.vue"),
      meta: { requiresAuth: true, role: "user" }
    },
    {
      name: "my-article-new",
      path: "/me/articles/new",
      component: () => import("@/pages/me/articles/new.vue"),
      meta: { requiresAuth: true, role: "user" }
    },

    // === Администратор ===
    {
      name: "admin-me",
      path: "/admin/me",
      component: () => import("@/pages/admin/me.vue"),
      meta: { requiresAuth: true, role: "admin" }
    },
    {
      name: "admin-types",
      path: "/admin/types",
      component: () => import("@/pages/admin/types/index.vue"),
      meta: { requiresAuth: true, role: "admin" }
    },
    {
      name: "admin-tags",
      path: "/admin/tags",
      component: () => import("@/pages/admin/tags/index.vue"),
      meta: { requiresAuth: true, role: "admin" }
    },
    {
      name: "admin-articles",
      path: "/admin/articles",
      component: () => import("@/pages/admin/articles/index.vue"),
      meta: { requiresAuth: true, role: "admin" }
    },
    {
      name: "admin-article-view",
      path: "/admin/articles/:slug",
      component: () => import("@/pages/admin/articles/[slug].vue"),
      meta: { requiresAuth: true, role: "admin" }
    },
    {
      name: "admin-article-edit",
      path: "/admin/articles/:slug/edit",
      component: () => import("@/pages/admin/articles/[slug]/edit.vue"),
      meta: { requiresAuth: true, role: "admin" }
    },
    {
      name: "admin-article-new",
      path: "/admin/articles/new",
      component: () => import("@/pages/admin/articles/new.vue"),
      meta: { requiresAuth: true, role: "admin" }
    }
  ]
}

// @vitest-environment happy-dom

import { mount } from "@vue/test-utils"
import { onMounted, ref, watch } from "vue"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import AdminHeader from "../app/components/admin/header.vue"

beforeEach(() => {
  vi.stubGlobal("ref", ref)
  vi.stubGlobal("watch", watch)
  vi.stubGlobal("onMounted", onMounted)
  vi.stubGlobal("useRoute", () => ({ path: "/admin" }))
  vi.stubGlobal("navigateTo", vi.fn())
  vi.stubGlobal("useAdminStore", () => ({ isMenuCollapsed: false, toggleMenuCollapsed: vi.fn() }))
  vi.stubGlobal("useAdminDashboard", () => ({ summary: ref({ role: "editor", cards: [] }) }))
  vi.stubGlobal("useI18n", () => ({ t: (key: string) => key }))
  vi.stubGlobal("useNuxtApp", () => ({ $i18n: { t: (key: string) => key } }))
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe("admin header", () => {
  it("renders only the current service role navigation", () => {
    const wrapper = mount(AdminHeader, {
      global: {
        stubs: {
          Button: true,
          FixWindow: true,
          IconBurger: true,
          IconLogo: true,
          Icons: true,
          Menu: {
            props: ["groups"],
            template:
              '<nav><a v-for="item in groups[0].items" :key="item.to" :href="item.to">{{ item.title }}</a></nav>'
          },
          NuxtLink: { props: ["to"], template: '<a :href="to"><slot /></a>' },
          Transition: false
        }
      }
    })

    const routes = [
      ...new Set(
        wrapper
          .findAll("nav a")
          .map((link) => link.attributes("href"))
          .filter((href) => href.startsWith("/admin"))
      )
    ]
    expect(routes).toEqual(["/admin", "/admin/articles", "/admin/mail", "/admin/audit"])
    expect(wrapper.text()).not.toContain("alex.ivanov@example.com")
  })
})

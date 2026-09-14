import type { NuxtPage } from "@nuxt/schema"
import { afterEach, describe, expect, it } from "vitest"
import config from "../nuxt.config"

const originalNodeEnv = process.env.NODE_ENV

const makePages = (): NuxtPage[] => [
  { name: "index", path: "/", file: "~/app/pages/index.vue" },
  { name: "fonts-showcase", path: "/fonts-showcase", file: "~/app/pages/fonts-showcase.vue" },
  { name: "components-showcase", path: "/components-showcase", file: "~/app/pages/components-showcase.vue" },
  { name: "test-error", path: "/test-error", file: "~/app/pages/test-error.vue" }
]

const runPagesExtend = async (pages: NuxtPage[]) => {
  const hook = config.hooks?.["pages:extend"]
  expect(hook).toBeTypeOf("function")

  if (typeof hook === "function") {
    await hook(pages)
  }
}

afterEach(() => {
  process.env.NODE_ENV = originalNodeEnv
})

describe("dev-only routes", () => {
  it("removes showcase and error routes from a production build", async () => {
    process.env.NODE_ENV = "production"
    const pages = makePages()

    await runPagesExtend(pages)

    expect(pages.map((page) => page.path)).toEqual(["/"])
  })

  it("keeps showcase and error routes in development", async () => {
    process.env.NODE_ENV = "development"
    const pages = makePages()

    await runPagesExtend(pages)

    expect(pages.map((page) => page.path)).toEqual(["/", "/fonts-showcase", "/components-showcase", "/test-error"])
  })
})

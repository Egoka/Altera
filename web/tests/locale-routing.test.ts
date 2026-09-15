import { readdirSync, readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"
import config from "../nuxt.config"

const here = dirname(fileURLToPath(import.meta.url))
const pagesDir = join(here, "..", "app", "pages")

const privatePageFiles = ["me", "admin"].flatMap((area) =>
  readdirSync(join(pagesDir, area), { recursive: true })
    .filter((path): path is string => typeof path === "string" && path.endsWith(".vue"))
    .map((path) => join(pagesDir, area, path))
)

describe("locale routing contract", () => {
  it("uses deterministic Russian default routes and an English prefix", () => {
    expect(config.i18n).toMatchObject({
      defaultLocale: "ru",
      strategy: "prefix_except_default",
      detectBrowserLanguage: false
    })
  })

  it("redirects the non-canonical Russian prefix permanently", () => {
    expect(config.routeRules?.["/ru"]).toEqual({ redirect: { to: "/", statusCode: 301 } })
  })

  it.each(privatePageFiles)("does not localize %s", (pageFile) => {
    const source = readFileSync(pageFile, "utf8")

    expect(source).toMatch(/definePageMeta\(\s*\{[\s\S]*?i18n:\s*false/)
  })
})

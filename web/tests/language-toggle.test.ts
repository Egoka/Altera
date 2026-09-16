import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"

const here = dirname(fileURLToPath(import.meta.url))
const componentSource = readFileSync(join(here, "..", "app", "components", "functional", "LanguageToggle.vue"), "utf8")
const headerSource = readFileSync(join(here, "..", "app", "components", "app", "header.vue"), "utf8")
const ruMessages = JSON.parse(readFileSync(join(here, "..", "i18n", "locales", "ru.json"), "utf8"))

describe("LanguageToggle", () => {
  it("renders an SSR-visible link to the other locale", () => {
    expect(componentSource).toContain("<NuxtLink")
    expect(componentSource).toContain(':to="targetPath"')
    expect(componentSource).toContain(':aria-label="ariaLabel"')
    expect(ruMessages.language.switchTo).toBe("Switch language to {language}")
    expect(componentSource.match(/<NuxtLink/g)).toHaveLength(1)
  })

  it("uses Nuxt SPA navigation and preserves the tri-state sibling resolver", () => {
    expect(componentSource).toContain("publishedSiblingPath")
    expect(componentSource).toContain("useSwitchLocalePath")
    expect(componentSource).toContain("resolveLocaleSwitchPath")
    expect(componentSource).not.toContain("location.reload")
    expect(componentSource).not.toMatch(/replace\s*\(/)
  })

  it("is explicitly imported by the public header", () => {
    expect(headerSource).toContain('import LanguageToggle from "~/components/functional/LanguageToggle.vue"')
    expect(headerSource).toContain("<LanguageToggle compact />")
  })
})

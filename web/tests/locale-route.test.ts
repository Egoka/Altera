import { describe, expect, it } from "vitest"
import { localeHome, resolveLocaleSwitchPath } from "~/utils/localeRoute"

describe("locale switch target", () => {
  it.each([
    ["ru", "/"],
    ["en", "/en"]
  ] as const)("uses the %s locale home", (locale, expected) => {
    expect(localeHome(locale)).toBe(expected)
  })

  it("keeps the localized path for a static page", () => {
    expect(
      resolveLocaleSwitchPath({
        targetLocale: "en",
        publishedSiblingPath: undefined,
        staticLocalePath: "/en/popular"
      })
    ).toBe("/en/popular")
  })

  it("uses the exact published sibling path for dynamic content", () => {
    expect(
      resolveLocaleSwitchPath({
        targetLocale: "ru",
        publishedSiblingPath: "/drugoy-slug",
        staticLocalePath: "/current-slug"
      })
    ).toBe("/drugoy-slug")
  })

  it.each([null, "https://example.com/en/article", "//example.com/en/article", "relative/path", ""])(
    "falls back to locale home for an unavailable or unsafe sibling: %s",
    (publishedSiblingPath) => {
      expect(
        resolveLocaleSwitchPath({
          targetLocale: "en",
          publishedSiblingPath,
          staticLocalePath: "/en/current"
        })
      ).toBe("/en")
    }
  )
})

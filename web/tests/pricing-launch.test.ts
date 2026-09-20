import { describe, expect, it } from "vitest"
import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import {
  PRICING_COMPARE_ROWS,
  PRICING_FAQ_KEYS,
  PRICING_LAUNCH_PLANS,
  hasPromoQuery,
  pricingCanonicalPath,
  resolveHighlightedPlan,
  resolvePricingLaunchState
} from "~/utils/pricingLaunch"

// Первый запуск без платности (журнал §24.1): каталог планов не знает ни цен, ни интервалов,
// а query-параметры страницы не должны уводить её за пределы этого режима.

const here = dirname(fileURLToPath(import.meta.url))
const locales = ["ru", "en"] as const
const dictionary = (locale: string): Record<string, unknown> =>
  JSON.parse(readFileSync(join(here, "..", "i18n", "locales", `${locale}.json`), "utf8"))

const lookup = (source: Record<string, unknown>, path: string): unknown =>
  path.split(".").reduce<unknown>((value, key) => {
    if (value !== null && typeof value === "object") return (value as Record<string, unknown>)[key]
    return undefined
  }, source)

describe("каталог планов первого запуска", () => {
  it("держит три плана в порядке free → standard → pro", () => {
    expect(PRICING_LAUNCH_PLANS.map((plan) => plan.tier)).toEqual(["free", "standard", "pro"])
  })

  it("объявляет бесплатным только free, а платные планы — будущими", () => {
    expect(PRICING_LAUNCH_PLANS.map((plan) => plan.availability)).toEqual(["now", "later", "later"])
  })

  it("не содержит ни цен, ни интервалов, ни чисел рейтинга", () => {
    const serialised = JSON.stringify({ PRICING_LAUNCH_PLANS, PRICING_COMPARE_ROWS, PRICING_FAQ_KEYS })

    // Поля `plans(locale)` из `pricing.md` §4 — это и есть цены; на запуске их нет нигде.
    expect(serialised).not.toMatch(/\d/)
    expect(serialised).not.toMatch(/priceMonth|priceYear|currency|interval|checkout|promo/i)
  })

  it("сравнивает планы только по составу возможностей", () => {
    expect(PRICING_COMPARE_ROWS.length).toBeGreaterThan(0)

    for (const row of PRICING_COMPARE_ROWS) {
      expect(Object.keys(row.included).sort()).toEqual(["free", "pro", "standard"])
    }

    // Чтение бесплатно для всех (журнал §24.1), писать на `free` нельзя (plan-free.md п. 3).
    expect(PRICING_COMPARE_ROWS.find((row) => row.key === "read")?.included.free).toBe(true)
    expect(PRICING_COMPARE_ROWS.find((row) => row.key === "write")?.included.free).toBe(false)
  })

  it("показывает 6 вопросов FAQ из диапазона 6–8 спецификации", () => {
    expect(PRICING_FAQ_KEYS.length).toBeGreaterThanOrEqual(6)
    expect(PRICING_FAQ_KEYS.length).toBeLessThanOrEqual(8)
    expect(new Set(PRICING_FAQ_KEYS).size).toBe(PRICING_FAQ_KEYS.length)
  })
})

describe.each(locales)("словарь %s покрывает страницу планов", (locale) => {
  const messages = dictionary(locale)

  it("содержит название, описание и возможности каждого плана", () => {
    for (const plan of PRICING_LAUNCH_PLANS) {
      expect(lookup(messages, `pricing.plans.${plan.tier}.name`)).toBeTypeOf("string")
      expect(lookup(messages, `pricing.plans.${plan.tier}.summary`)).toBeTypeOf("string")

      for (const feature of plan.features) {
        expect(lookup(messages, `pricing.plans.${plan.tier}.features.${feature}`)).toBeTypeOf("string")
      }
    }
  })

  it("содержит строки сравнения, FAQ и состояния «планы временно недоступны»", () => {
    for (const row of PRICING_COMPARE_ROWS) {
      expect(lookup(messages, `pricing.compare.rows.${row.key}`)).toBeTypeOf("string")
    }

    for (const key of PRICING_FAQ_KEYS) {
      expect(lookup(messages, `pricing.faq.items.${key}.question`)).toBeTypeOf("string")
      expect(lookup(messages, `pricing.faq.items.${key}.answer`)).toBeTypeOf("string")
    }

    expect(lookup(messages, "pricing.states.empty.title")).toBeTypeOf("string")
    expect(lookup(messages, "pricing.availability.later")).toBeTypeOf("string")
  })

  it("не называет ни одной цены в текстах страницы", () => {
    const texts = JSON.stringify(lookup(messages, "pricing"))

    expect(texts).not.toMatch(/[\d]/)
    expect(texts).not.toMatch(/[₽$€]|\bRUB\b|\bUSD\b/i)
  })
})

describe("состояния страницы на первом запуске", () => {
  it("показывает страницу, пока в каталоге есть планы", () => {
    expect(resolvePricingLaunchState(PRICING_LAUNCH_PLANS)).toBe("ready")
  })

  it("уходит в «планы временно недоступны», если каталог пуст", () => {
    expect(resolvePricingLaunchState([])).toBe("empty")
  })
})

describe("query-параметры страницы", () => {
  it("подсвечивает только платные карточки", () => {
    expect(resolveHighlightedPlan("standard")).toBe("standard")
    expect(resolveHighlightedPlan("pro")).toBe("pro")
  })

  it("игнорирует неверные значения", () => {
    expect(resolveHighlightedPlan("free")).toBeNull()
    expect(resolveHighlightedPlan("platinum")).toBeNull()
    expect(resolveHighlightedPlan(undefined)).toBeNull()
    expect(resolveHighlightedPlan(["pro", "standard"])).toBe("pro")
  })

  it("считает визитом с промокодом только непустое значение", () => {
    expect(hasPromoQuery({ promo: "launch" })).toBe(true)
    expect(hasPromoQuery({ promo: ["launch"] })).toBe(true)
    expect(hasPromoQuery({ promo: "" })).toBe(false)
    expect(hasPromoQuery({ promo: " " })).toBe(false)
    expect(hasPromoQuery({})).toBe(false)
  })

  it("держит канонический адрес без query для обеих локалей", () => {
    expect(pricingCanonicalPath("ru")).toBe("/pricing")
    expect(pricingCanonicalPath("en")).toBe("/en/pricing")
  })
})

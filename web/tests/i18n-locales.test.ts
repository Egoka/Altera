import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { dirname, join } from "node:path"

// Двуязычность — полные переводы материалов и интерфейса (CLAUDE.md).
// Ключ, добавленный в одну локаль и забытый в другой, ломает страницу молча:
// vue-i18n подставит сам ключ. Этот тест делает такую забывчивость красной.

const here = dirname(fileURLToPath(import.meta.url))
const localesDir = join(here, "..", "i18n", "locales")

const load = (locale: string): Record<string, unknown> =>
  JSON.parse(readFileSync(join(localesDir, `${locale}.json`), "utf8"))

const flatten = (value: unknown, prefix = ""): Map<string, unknown> => {
  const result = new Map<string, unknown>()
  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
      const path = prefix ? `${prefix}.${key}` : key
      for (const [k, v] of flatten(nested, path)) result.set(k, v)
    }
  } else if (prefix) {
    result.set(prefix, value)
  }
  return result
}

const ru = flatten(load("ru"))
const en = flatten(load("en"))

describe("словари локалей", () => {
  it("непустые", () => {
    expect(ru.size).toBeGreaterThan(0)
    expect(en.size).toBe(ru.size)
  })

  it("каждый ключ ru существует в en", () => {
    const missing = [...ru.keys()].filter((key) => !en.has(key))
    expect(missing).toEqual([])
  })

  it("каждый ключ en существует в ru", () => {
    const missing = [...en.keys()].filter((key) => !ru.has(key))
    expect(missing).toEqual([])
  })

  it("нет пустых переводов", () => {
    const empty = [...ru, ...en]
      .filter(([, value]) => typeof value === "string" && value.trim() === "")
      .map(([key]) => key)
    expect(empty).toEqual([])
  })

  it("все значения — строки", () => {
    const wrong = [...ru, ...en].filter(([, value]) => typeof value !== "string").map(([key]) => key)
    expect(wrong).toEqual([])
  })
})

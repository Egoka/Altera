import { readFileSync } from "node:fs"
import { createRequire } from "node:module"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { compile } from "tailwindcss"
import { describe, expect, it } from "vitest"

const require = createRequire(import.meta.url)
const cssDir = fileURLToPath(new URL("../app/assets/css", import.meta.url))

const buildUtilities = async (candidates: string[]) => {
  const compiler = await compile(readFileSync(path.join(cssDir, "main.css"), "utf8"), {
    base: cssDir,
    loadStylesheet: async (id, base) => {
      const file = id === "tailwindcss" ? require.resolve("tailwindcss/index.css") : path.resolve(base, id)
      return { path: file, base: path.dirname(file), content: readFileSync(file, "utf8") }
    }
  })
  return compiler.build(candidates)
}

describe("theme tokens", () => {
  // Ключ `--container-*` в `@theme` становится значением для `w-*`, `min-w-*`, `max-w-*`
  // и `basis-*`. Ключ-совпадение со словом Tailwind (`max`, `min`, `fit`) дописывает
  // второе правило и перебивает `max-content`, в том числе у компонентов fishtvue:
  // их слой объявлен раньше `utilities`.
  it("keeps keyword sizing utilities intrinsic", async () => {
    const candidates = ["w", "min-w", "max-w", "basis"].flatMap((prefix) =>
      ["min", "max", "fit"].map((keyword) => `${prefix}-${keyword}`)
    )

    const css = await buildUtilities(candidates)

    expect(css).toContain(".w-max {\n    width: max-content;")
    expect(css).not.toMatch(/var\(--container-(min|max|fit)\)/)
  })
})

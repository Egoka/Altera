// Компилирует Tailwind-тему Altera в обычный CSS для design-sync (claude.ai/design).
//
// Вход:  web/app/assets/css/main.css — исходник Tailwind 4 (`@import "tailwindcss"`, `@theme`,
//        `@font-face`, `@custom-variant dark`, `@layer base { body.dark … }`). Браузер и
//        конвертер design-sync такой файл не понимают.
// Выход: .design-sync/.cache/tokens/altera-theme.css — только слой темы, все переменные
//        (`theme(static)` + `@theme static`), без preflight и утилит; `@font-face` с url()
//        на копии шрифтов в .design-sync/.cache/fonts/ (имена без пробелов).
//
// Компилирует Tailwind самого приложения (`@tailwindcss/node` из pnpm-хранилища рядом с
// `@tailwindcss/vite`), поэтому версия совпадает с lock-файлом. Результат детерминирован:
// повторный запуск без изменений в main.css даёт байт-в-байт тот же файл.
//
// Запуск из корня репозитория: node .design-sync/compile-tokens.mjs

import { copyFileSync, existsSync, mkdirSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { basename, dirname, join, relative, resolve } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const SRC = join(ROOT, "web", "app", "assets", "css", "main.css")
const CACHE = join(ROOT, ".design-sync", ".cache")
const OUT_DIR = join(CACHE, "tokens")
const FONTS_DIR = join(CACHE, "fonts")
const OUT = join(OUT_DIR, "altera-theme.css")

const rel = (p) => relative(ROOT, p).split("\\").join("/")

// -- Tailwind приложения ------------------------------------------------------------------
const viteDir = realpathSync(join(ROOT, "web", "node_modules", "@tailwindcss", "vite"))
const nodeEntry = createRequire(join(viteDir, "package.json")).resolve("@tailwindcss/node")
const { compile } = await import(pathToFileURL(nodeEntry).href)
const twVersion = JSON.parse(
  readFileSync(join(realpathSync(join(ROOT, "web", "node_modules", "tailwindcss")), "package.json"), "utf8")
).version

// -- Исходник -> вход компилятора ----------------------------------------------------------
const source = readFileSync(SRC, "utf8")
const IMPORT = '@import "tailwindcss";'
if (!source.includes(IMPORT)) {
  console.error(`✗ ${rel(SRC)}: ожидалась строка ${IMPORT} — сценарий рассчитан на текущую структуру main.css`)
  process.exit(1)
}
// Только слой темы. theme(static) эмитит все переменные темы Tailwind по умолчанию,
// `@theme static` — все переменные Altera; без обоих в выход попали бы лишь использованные.
const input = source
  .replace(IMPORT, '@layer theme, base;\n@import "tailwindcss/theme.css" layer(theme) theme(static);')
  .replace(/@theme\s*\{/g, "@theme static {")

const compiler = await compile(input, {
  base: dirname(SRC),
  from: SRC,
  onDependency: () => {},
  shouldRewriteUrls: false
})
let css = compiler.build([])

// -- Шрифты: копии с безопасными именами, url() относительно выходного файла ----------------
// Блок @font-face, чей файл пуст (0 байт — заглушка вместо шрифта, как Bergamasco в репозитории),
// выбрасывается целиком с предупреждением: пустой файл браузер загрузить не сможет, а его
// @font-face перекрыл бы честный fallback. Решение владельца от 2026-09-06, см. NOTES.md.
rmSync(FONTS_DIR, { recursive: true, force: true })
mkdirSync(FONTS_DIR, { recursive: true })
mkdirSync(OUT_DIR, { recursive: true })
const URL_RX = /url\(\s*(['"]?)([^'")]+?\.(?:woff2?|ttf|otf))\1\s*\)/gi
const copied = new Map() // безопасное имя -> исходный путь
const missing = []
const dropped = new Map() // семейство -> число выброшенных @font-face
css = css.replace(/@font-face\s*\{[^}]*\}/g, (block) => {
  const family = block.match(/font-family\s*:\s*["']?([^;"'\n]+)/)?.[1]?.trim() ?? "?"
  let empty = false
  const rewritten = block.replace(URL_RX, (whole, quote, url) => {
    if (/^(?:https?:|data:)/i.test(url)) return whole
    const srcPath = resolve(dirname(SRC), url)
    if (!existsSync(srcPath)) {
      missing.push(url)
      return whole
    }
    if (statSync(srcPath).size === 0) {
      empty = true
      return whole
    }
    const safe = basename(srcPath).replace(/\s+/g, "-")
    const prev = copied.get(safe)
    if (prev && prev !== srcPath) {
      console.error(`✗ два разных файла шрифтов дают одно имя ${safe}: ${rel(prev)} и ${rel(srcPath)}`)
      process.exit(1)
    }
    if (!prev) {
      copyFileSync(srcPath, join(FONTS_DIR, safe))
      copied.set(safe, srcPath)
    }
    return `url("${rel(join(FONTS_DIR, safe)).replace(/^\.design-sync\/\.cache\//, "../")}")`
  })
  if (!empty) return rewritten
  dropped.set(family, (dropped.get(family) ?? 0) + 1)
  return ""
})
css = css.replace(/\n{3,}/g, "\n\n")
if (missing.length) {
  console.error(`✗ в main.css есть url() на несуществующие файлы шрифтов: ${missing.join(", ")}`)
  process.exit(1)
}
for (const [family, n] of dropped) {
  console.error(`! ${family}: ${n} @font-face пропущено — файлы шрифта пустые (0 байт), семейство не отгружается`)
}

// -- Запись --------------------------------------------------------------------------------
const header =
  `/* Сгенерировано .design-sync/compile-tokens.mjs из ${rel(SRC)} (tailwindcss@${twVersion}).\n` +
  `   Только слой темы Tailwind: переменные + @font-face + переопределения body.dark. Не редактировать вручную. */\n`
writeFileSync(OUT, header + css)

const vars = new Set([...css.matchAll(/(--[a-z0-9-]+)\s*:/gi)].map((m) => m[1]))
const faces = (css.match(/@font-face/g) ?? []).length
console.error(
  `✓ ${rel(OUT)}: ${(Buffer.byteLength(css) / 1024).toFixed(1)} KB, ${vars.size} переменных, ` +
    `${faces} @font-face, ${copied.size} файлов шрифтов -> ${rel(FONTS_DIR)}/`
)

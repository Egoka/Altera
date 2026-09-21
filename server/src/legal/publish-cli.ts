import "dotenv/config"
import { readFileSync } from "node:fs"
import { parseArgs } from "node:util"
import { PrismaClient, type LegalTextKind, type Locale } from "../generated/prisma"
import { createCache } from "../cache"
import { legalCacheTag, LEGAL_LOCALES, PUBLIC_LEGAL_KINDS, publishLegalVersion } from "./texts"

/**
 * Публикация редакции юридического текста релизом кода — до раздела `/admin/legal` (T-083,
 * `docs/spec/40-admin/legal-texts.md`: «до этапа 4 версии публикуются релизом кода»).
 *
 *   pnpm --filter server legal:publish --kind terms --locale ru --file terms-ru.html \
 *     --summary "Первая редакция" [--material]
 *
 * Скрипт пишет в базу из `DATABASE_URL`; среду выбирает тот, кто публикует.
 */
const USAGE =
  "Usage: legal:publish --kind <terms|privacy|content_rules|license> --locale <ru|en> --file <path> --summary <text> [--material]"

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      kind: { type: "string" },
      locale: { type: "string" },
      file: { type: "string" },
      summary: { type: "string" },
      material: { type: "boolean", default: false }
    }
  })

  const kind = values.kind as LegalTextKind | undefined
  const locale = values.locale as Locale | undefined
  if (!kind || !(PUBLIC_LEGAL_KINDS as readonly string[]).includes(kind)) throw new Error(USAGE)
  if (!locale || !LEGAL_LOCALES.includes(locale)) throw new Error(USAGE)
  if (!values.file || !values.summary) throw new Error(USAGE)

  const prisma = new PrismaClient()
  const cache = createCache({ redisUrl: process.env.REDIS_URL })
  try {
    const published = await publishLegalVersion(prisma, {
      kind,
      locale,
      body: readFileSync(values.file, "utf8"),
      summaryOfChanges: values.summary,
      isMaterial: values.material ?? false
    })
    // Карта сайта кешируется под тегом `home` и тоже перечисляет `/legal/*`.
    await cache.delByTags([legalCacheTag(kind), "home"])
    process.stdout.write(
      `Published ${published.kind}/${published.locale} version ${published.version}` +
        (published.isMaterial ? " (material: consent is requested again on next login)" : "") +
        "\n"
    )
  } finally {
    await cache.close()
    await prisma.$disconnect()
  }
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
  process.exitCode = 1
})

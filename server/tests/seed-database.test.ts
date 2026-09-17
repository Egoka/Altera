import { execFileSync } from "node:child_process"
import { randomUUID } from "node:crypto"
import path from "node:path"
import { ArticleStatus, PrismaClient } from "../src/generated/prisma"
import { seedDatabase } from "../seed/seed"
import { describe, expect, it } from "vitest"

const testDatabaseUrl = process.env.T007_TEST_DATABASE_URL
const serverRoot = path.resolve(__dirname, "..")

const databaseUrl = (name: string): string => {
  const url = new URL(testDatabaseUrl!)
  url.pathname = `/${name}`
  return url.toString()
}

const prismaFor = (url: string): PrismaClient =>
  new PrismaClient({
    datasources: { db: { url } }
  })

const migrateDatabase = (url: string): void => {
  execFileSync("pnpm", ["exec", "prisma", "migrate", "deploy", "--schema", "prisma/schema.prisma"], {
    cwd: serverRoot,
    env: { ...process.env, DATABASE_URL: url, DATABASE_URL_UNPOOLED: url },
    stdio: "pipe"
  })
}

const withDatabase = async (run: (url: string) => Promise<void>): Promise<void> => {
  const name = `t007_seed_${randomUUID().replaceAll("-", "")}`
  const admin = prismaFor(databaseUrl("postgres"))
  const url = databaseUrl(name)

  try {
    await admin.$executeRawUnsafe(`CREATE DATABASE "${name}"`)
    migrateDatabase(url)
    await run(url)
  } finally {
    await admin.$executeRawUnsafe(
      `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '${name}' AND pid <> pg_backend_pid()`
    )
    await admin.$executeRawUnsafe(`DROP DATABASE IF EXISTS "${name}"`)
    await admin.$disconnect()
  }
}

describe.skipIf(!testDatabaseUrl)("T-007 deterministic seed", () => {
  it("creates the complete fixture once and remains unchanged after a second run", async () => {
    await withDatabase(async (url) => {
      const prisma = prismaFor(url)

      try {
        await seedDatabase(prisma)
        const firstCounts = {
          users: await prisma.user.count(),
          sections: await prisma.section.count(),
          formats: await prisma.format.count(),
          tags: await prisma.tag.count(),
          articles: await prisma.article.count(),
          translations: await prisma.articleTranslation.count(),
          revisions: await prisma.articleRevision.count()
        }

        await seedDatabase(prisma)

        await expect(
          Promise.all([
            prisma.user.count(),
            prisma.section.count(),
            prisma.format.count(),
            prisma.tag.count(),
            prisma.article.count(),
            prisma.articleTranslation.count(),
            prisma.articleRevision.count()
          ])
        ).resolves.toEqual(Object.values(firstCounts))

        const serviceRoleCounts = await prisma.user.groupBy({
          by: ["role"],
          where: { isServiceAccount: true },
          _count: { _all: true },
          orderBy: { role: "asc" }
        })
        expect(serviceRoleCounts).toEqual([
          { role: "editor", _count: { _all: 1 } },
          { role: "moderator", _count: { _all: 1 } },
          { role: "analyst", _count: { _all: 1 } },
          { role: "admin", _count: { _all: 1 } },
          { role: "owner", _count: { _all: 1 } }
        ])

        const articleStatusCounts = await prisma.article.groupBy({
          by: ["status"],
          _count: { _all: true }
        })
        expect(new Map(articleStatusCounts.map(({ status, _count }) => [status, _count._all]))).toEqual(
          new Map(Object.values(ArticleStatus).map((status) => [status, 1]))
        )

        await expect(prisma.user.count({ where: { role: "reader", isServiceAccount: false } })).resolves.toBe(1)
        await expect(prisma.user.count({ where: { role: "author", isServiceAccount: false } })).resolves.toBe(2)
        await expect(prisma.section.count()).resolves.toBe(6)
        await expect(prisma.format.count()).resolves.toBe(5)
        await expect(prisma.tag.count()).resolves.toBeGreaterThan(0)
      } finally {
        await prisma.$disconnect()
      }
    })
  }, 30_000)
})

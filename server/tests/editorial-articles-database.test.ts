import { randomUUID } from "node:crypto"
import { createDocument, createParagraph, createText } from "@altera/content"
import { describe, expect, it, vi } from "vitest"
import { archiveStaffAccount } from "../src/admin/staff"
import { createUserWithReservedHandle } from "../src/auth/handle"
import { PrismaClient, type User } from "../src/generated/prisma"
import articleResolver from "../src/graphql/article/resolver"
import type { GraphQLContext } from "../src/prisma"
import { saveTranslation } from "../src/translation/editor"
import { applyAllMigrations } from "./helpers/migration-database"

/**
 * T-052: редакционная статья принадлежит журналу, а не создавшему её редактору.
 *
 * Проверка идёт на PostgreSQL: создание черновика взаимодействует с legacy-trigger языковых
 * версий, а отсутствие каскада при архиве служебной записи — инвариант сохранённых строк.
 */
const testDatabaseUrl = process.env.T052_TEST_DATABASE_URL
const PARAGRAPH_ID = "0b7e4c1a-3f2d-4c8e-9a1b-2c3d4e5f6a52"

const databaseUrl = (name: string): string => {
  const url = new URL(testDatabaseUrl!)
  url.pathname = `/${name}`
  return url.toString()
}

const prismaFor = (url: string): PrismaClient => new PrismaClient({ datasources: { db: { url } } })

const withDatabase = async (run: (database: PrismaClient) => Promise<void>): Promise<void> => {
  const name = `t052_${randomUUID().replaceAll("-", "")}`
  const admin = prismaFor(databaseUrl("postgres"))
  const url = databaseUrl(name)

  try {
    await admin.$executeRawUnsafe(`CREATE DATABASE "${name}"`)
    applyAllMigrations(url)
    const database = prismaFor(url)
    try {
      await run(database)
    } finally {
      await database.$disconnect()
    }
  } finally {
    await admin.$executeRawUnsafe(
      `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '${name}' AND pid <> pg_backend_pid()`
    )
    await admin.$executeRawUnsafe(`DROP DATABASE IF EXISTS "${name}"`)
    await admin.$disconnect()
  }
}

const createStaff = (database: PrismaClient, role: "editor" | "owner", suffix: string): Promise<User> =>
  createUserWithReservedHandle(database, {
    email: `t052-${suffix}@altera.test`,
    name: role === "owner" ? "Владелец" : `Редактор ${suffix}`,
    locale: "ru",
    role,
    isServiceAccount: true
  })

const context = (database: PrismaClient, actor: User): GraphQLContext =>
  ({
    prisma: database,
    currentUser: { ...actor, permissionExceptions: [] },
    requestId: "req-t052",
    cache: { delByTags: vi.fn().mockResolvedValue(undefined) },
    logger: { log: vi.fn() }
  }) as unknown as GraphQLContext

const createEditorialArticle = async (database: PrismaClient, editor: User) =>
  articleResolver.Mutation.createArticle(null, { input: { locale: "ru" } }, context(database, editor))

describe.skipIf(!testDatabaseUrl)("T-052 редакционные статьи в PostgreSQL", () => {
  it("архив редактора не меняет статус созданной им редакционной статьи", async () => {
    await withDatabase(async (database) => {
      const owner = await createStaff(database, "owner", "owner")
      const editor = await createStaff(database, "editor", "first")
      const article = await createEditorialArticle(database, editor)

      await archiveStaffAccount(context(database, owner), { id: editor.id, reason: "Смена состава редакции" })

      await expect(database.article.findUniqueOrThrow({ where: { id: article.id } })).resolves.toMatchObject({
        isEditorial: true,
        status: "draft"
      })
    })
  })

  it("второй редактор сохраняет редакционную статью первого", async () => {
    await withDatabase(async (database) => {
      const firstEditor = await createStaff(database, "editor", "first")
      const secondEditor = await createStaff(database, "editor", "second")
      const article = await createEditorialArticle(database, firstEditor)
      const translation = await database.articleTranslation.findFirstOrThrow({
        where: { articleId: article.id },
        include: { revisions: { orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 1 } }
      })

      const saved = await saveTranslation(context(database, secondEditor), {
        id: translation.id,
        baseRevisionId: translation.revisions[0]!.id,
        patch: {
          title: "Материал редакции",
          body: createDocument([createParagraph([createText("Текст второго редактора")], PARAGRAPH_ID)])
        },
        kind: "manual"
      })

      await expect(
        database.articleRevision.findUniqueOrThrow({ where: { id: saved.revisionId } })
      ).resolves.toMatchObject({
        createdById: secondEditor.id,
        title: "Материал редакции"
      })
    })
  })
})

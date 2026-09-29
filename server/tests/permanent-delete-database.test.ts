import { randomUUID } from "node:crypto"
import { describe, expect, it } from "vitest"
import { GraphQLError } from "graphql"
import { PrismaClient } from "../src/generated/prisma"
import { applyAllMigrations } from "./helpers/migration-database"
import { deletePermanently, previewPermanentDelete } from "../src/admin/permanent-delete"
import { setSlug } from "../src/translation/editor"
import { createTag, archiveTag } from "../src/taxonomy/service"
import { createUserWithReservedHandle } from "../src/auth/handle"
import type { GraphQLContext } from "../src/prisma"

/**
 * T-076 «Удалить навсегда» (`docs/spec/10-flows/permanent-delete.md`): критерии готовности §5.
 * Каскад полагается на реальные ограничения схемы (Cascade/Restrict/SetNull) и на trigger,
 * блокирующий UPDATE/DELETE журнала аудита — двойник Prisma их не воспроизводит, поэтому
 * проверка идёт на настоящем PostgreSQL, как остальные `*-database.test.ts`.
 */

const testDatabaseUrl = process.env.T076_TEST_DATABASE_URL

const databaseUrl = (name: string): string => {
  const url = new URL(testDatabaseUrl!)
  url.pathname = `/${name}`
  return url.toString()
}

const prismaFor = (url: string): PrismaClient => new PrismaClient({ datasources: { db: { url } } })

const withDatabase = async (prefix: string, run: (prisma: PrismaClient) => Promise<void>): Promise<void> => {
  const name = `${prefix}_${randomUUID().replaceAll("-", "")}`
  const admin = prismaFor(databaseUrl("postgres"))
  const url = databaseUrl(name)

  try {
    await admin.$executeRawUnsafe(`CREATE DATABASE "${name}"`)
    applyAllMigrations(url)
    const prisma = prismaFor(url)
    try {
      await run(prisma)
    } finally {
      await prisma.$disconnect()
    }
  } finally {
    await admin.$executeRawUnsafe(
      `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '${name}' AND pid <> pg_backend_pid()`
    )
    await admin.$executeRawUnsafe(`DROP DATABASE IF EXISTS "${name}"`)
    await admin.$disconnect()
  }
}

const OWNER_ID = "owner-t076"

const ctxFor = (prisma: PrismaClient, currentUser: Record<string, unknown>): GraphQLContext =>
  ({ prisma, currentUser, requestId: `req-${randomUUID()}` }) as never

const ownerCtx = (prisma: PrismaClient): GraphQLContext =>
  ctxFor(prisma, { id: OWNER_ID, role: "owner", archivedAt: null, planTier: "free", planUntil: null })

const errorCode = async (run: () => Promise<unknown>): Promise<string | undefined> => {
  try {
    await run()
    return undefined
  } catch (error) {
    expect(error).toBeInstanceOf(GraphQLError)
    return (error as GraphQLError).extensions.code as string | undefined
  }
}

interface SeedArticle {
  articleId: string
  translationId: string
  authorId: string
}

/** Автор — редактор со своим же материалом: `ensureOwnTranslation` проходит по авторству. */
const seedArticle = async (
  prisma: PrismaClient,
  options: { slug?: string; archived?: boolean; published?: boolean; authorId?: string } = {}
): Promise<SeedArticle> => {
  const author = options.authorId
    ? await prisma.user.findUniqueOrThrow({ where: { id: options.authorId } })
    : await createUserWithReservedHandle(prisma, {
        name: "Редактор T-076",
        email: `t076-${randomUUID()}@example.test`,
        role: "editor",
        isServiceAccount: true
      })

  const articleId = randomUUID()
  const draftSlug = `draft-${articleId}`
  const now = new Date()

  // Legacy trigger `t015_sync_legacy_article` заводит свою языковую версию при вставке наследной
  // строки — как и `createArticle` (resolver.ts), сеанс выключает синхронизацию перед вставкой.
  const article = await prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`SET LOCAL "altera.legacy_sync" = 'off'`)
    return tx.article.create({
      data: {
        id: articleId,
        title: "Материал T-076",
        slug: draftSlug,
        body: "",
        authorId: author.id,
        status: options.archived ? "archived" : options.published ? "published" : "draft",
        ...(options.archived
          ? { archivedAt: now, archivedByActorId: OWNER_ID, archivedByRole: "owner", archiveReason: "t076-test" }
          : {}),
        ...(options.published ? { firstPublishedAt: now, publishedAt: now } : {}),
        translations: {
          create: {
            locale: "ru",
            slug: draftSlug,
            title: "Материал T-076",
            body: [],
            status: options.archived ? "archived" : options.published ? "published" : "draft",
            revisions: { create: { title: "Материал T-076", body: [], kind: "manual", createdById: author.id } }
          }
        }
      },
      include: { translations: true }
    })
  })

  const translationId = article.translations[0]!.id

  if (options.slug) {
    const actor = await prisma.user.findUniqueOrThrow({
      where: { id: author.id },
      include: { permissionExceptions: true }
    })
    await setSlug(ctxFor(prisma, actor), translationId, options.slug)
  }

  return { articleId, translationId, authorId: author.id }
}

describe.skipIf(!testDatabaseUrl)("T-076 «Удалить навсегда»", () => {
  it("AC-1: неархивную и уже опубликованную статью нельзя удалить навсегда", async () => {
    await withDatabase("t076_ac1", async (prisma) => {
      const { articleId } = await seedArticle(prisma, { published: true })

      const code = await errorCode(() =>
        deletePermanently(ownerCtx(prisma), {
          entity: "article",
          id: articleId,
          confirmedName: "Материал T-076",
          reason: "152-ФЗ"
        })
      )

      expect(code).toBe("CONFLICT")
      expect(await prisma.article.count({ where: { id: articleId } })).toBe(1)
    })
  })

  it("VALIDATION_ERROR при несовпадении введённого имени", async () => {
    await withDatabase("t076_name", async (prisma) => {
      const { articleId } = await seedArticle(prisma, { archived: true })

      const code = await errorCode(() =>
        deletePermanently(ownerCtx(prisma), {
          entity: "article",
          id: articleId,
          confirmedName: "Совсем другое имя",
          reason: "152-ФЗ"
        })
      )

      expect(code).toBe("VALIDATION_ERROR")
      expect(await prisma.article.count({ where: { id: articleId } })).toBe(1)
    })
  })

  it("FORBIDDEN не-владельцу", async () => {
    await withDatabase("t076_forbidden", async (prisma) => {
      const { articleId } = await seedArticle(prisma, { archived: true })
      const admin = ctxFor(prisma, {
        id: "admin-1",
        role: "admin",
        archivedAt: null,
        planTier: "free",
        planUntil: null
      })

      const code = await errorCode(() =>
        deletePermanently(admin, { entity: "article", id: articleId, confirmedName: "Материал T-076", reason: "x" })
      )

      expect(code).toBe("FORBIDDEN")
    })
  })

  it("AC-2 и AC-3: аудит остаётся, адрес материала занят навсегда и не выдаётся новой версии", async () => {
    await withDatabase("t076_ac2_ac3", async (prisma) => {
      const { articleId, translationId } = await seedArticle(prisma, {
        archived: true,
        slug: "permanent-delete-target"
      })

      const preview = await previewPermanentDelete(ownerCtx(prisma), "article", articleId)
      expect(preview.name).toBe("Материал T-076")

      const result = await deletePermanently(ownerCtx(prisma), {
        entity: "article",
        id: articleId,
        confirmedName: "Материал T-076",
        reason: "152-ФЗ: запрос на уничтожение данных"
      })
      expect(result).toBe(true)

      // Сущность физически удалена — включая версию, каскадом.
      expect(await prisma.article.count({ where: { id: articleId } })).toBe(0)
      expect(await prisma.articleTranslation.count({ where: { id: translationId } })).toBe(0)

      // AC-2: запись аудита переживает удаление сущности, на которую ссылается.
      const audit = await prisma.auditLog.findFirst({
        where: { action: "entity.delete.permanent", entityType: "article", entityId: articleId }
      })
      expect(audit).not.toBeNull()
      expect(audit?.diff).toMatchObject({ confirmedName: "Материал T-076" })

      // Реестр адресов пережил удаление: строка осталась, владелец снят.
      const reservation = await prisma.articleSlugHistory.findUnique({
        where: { locale_slug: { locale: "ru", slug: "permanent-delete-target" } }
      })
      expect(reservation).not.toBeNull()
      expect(reservation?.articleId).toBeNull()

      // AC-3: тот же адрес нельзя выдать новой версии — даже другому материалу.
      const second = await seedArticle(prisma)
      const secondActor = await prisma.user.findUniqueOrThrow({
        where: { id: second.authorId },
        include: { permissionExceptions: true }
      })
      const code = await errorCode(() =>
        setSlug(ctxFor(prisma, secondActor), second.translationId, "permanent-delete-target")
      )
      expect(code).toBe("CONFLICT")
    })
  })

  it("тег: не в архиве → CONFLICT; из архива без материалов — удаляется, адрес занят навсегда", async () => {
    await withDatabase("t076_tag", async (prisma) => {
      const ownerUser = await createUserWithReservedHandle(prisma, {
        name: "Владелец T-076",
        email: `t076-owner-${randomUUID()}@example.test`,
        role: "owner",
        isServiceAccount: true
      })
      const actor = { id: ownerUser.id, role: "owner" as const }
      const tag = await createTag(prisma, {
        input: { name: "Тег T-076" },
        actor,
        requestId: "seed"
      })

      const activeConflict = await errorCode(() =>
        deletePermanently(ownerCtx(prisma), { entity: "tag", id: tag.id, confirmedName: "Тег T-076", reason: "x" })
      )
      expect(activeConflict).toBe("CONFLICT")

      await archiveTag(prisma, { tagId: tag.id, actor, requestId: "seed" })

      const result = await deletePermanently(ownerCtx(prisma), {
        entity: "tag",
        id: tag.id,
        confirmedName: "Тег T-076",
        reason: "152-ФЗ"
      })
      expect(result).toBe(true)
      expect(await prisma.tag.count({ where: { id: tag.id } })).toBe(0)

      const history = await prisma.tagSlugHistory.findUnique({ where: { slug: tag.slug } })
      expect(history).not.toBeNull()
      expect(history?.ownerTagId).toBeNull()
    })
  })

  it("пользователь: собственные статьи и медиа уходят каскадом, хэндл остаётся занят навсегда", async () => {
    await withDatabase("t076_user", async (prisma) => {
      const reader = await createUserWithReservedHandle(prisma, {
        name: "Читатель T-076",
        email: `t076-reader-${randomUUID()}@example.test`,
        role: "author",
        archivedAt: new Date(),
        archiveMode: "admin",
        archivedByActorId: OWNER_ID,
        archivedByRole: "owner",
        archiveReason: "t076-test"
      } as never)
      const handle = reader.handle

      // Собственный материал и собственная загрузка (аватар) — обе Restrict-связи, которые
      // каскад обязан снять до удаления самой записи (`MediaAsset.owner`, `Article.author`).
      await prisma.mediaAsset.create({
        data: {
          id: randomUUID(),
          ownerId: reader.id,
          storageKey: `t076/${randomUUID()}.jpg`,
          mimeType: "image/jpeg",
          byteSize: 1024,
          sha256: "a".repeat(64),
          attribution: "T-076 test",
          license: "own"
        }
      })
      const { articleId } = await seedArticle(prisma, { authorId: reader.id })

      const result = await deletePermanently(ownerCtx(prisma), {
        entity: "user",
        id: reader.id,
        confirmedName: "Читатель T-076",
        reason: "152-ФЗ"
      })
      expect(result).toBe(true)

      expect(await prisma.user.count({ where: { id: reader.id } })).toBe(0)
      expect(await prisma.mediaAsset.count({ where: { ownerId: reader.id } })).toBe(0)
      // Собственная статья уходит вместе с записью: `Article.author` не каскадный сам по себе.
      expect(await prisma.article.count({ where: { id: articleId } })).toBe(0)

      // Хэндл — как и адрес статьи — занят навсегда, владелец снят.
      const handleRecord = await prisma.handleHistory.findUnique({ where: { handle } })
      expect(handleRecord).not.toBeNull()
      expect(handleRecord?.userId).toBeNull()
    })
  })

  it("служебная запись с ролью owner не может быть удалена навсегда", async () => {
    await withDatabase("t076_staff_owner", async (prisma) => {
      const owner = await createUserWithReservedHandle(prisma, {
        name: "Владелец T-076",
        email: `t076-owner-${randomUUID()}@example.test`,
        role: "owner",
        isServiceAccount: true,
        archivedAt: new Date(),
        archiveMode: "admin",
        archivedByActorId: OWNER_ID,
        archivedByRole: "owner",
        archiveReason: "t076-test"
      } as never)

      const code = await errorCode(() =>
        deletePermanently(ownerCtx(prisma), {
          entity: "staff",
          id: owner.id,
          confirmedName: "Владелец T-076",
          reason: "x"
        })
      )
      expect(code).toBe("CONFLICT")
    })
  })
})

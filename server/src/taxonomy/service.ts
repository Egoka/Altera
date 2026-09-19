import { Prisma, PrismaClient, Role } from "../generated/prisma"
import { createApiError } from "../errors/graphql-error"

interface TaxonomyActor {
  id: string
  role: Role
}

interface TaxonomyClient {
  $transaction: PrismaClient["$transaction"]
}

const editorialRoles = new Set<Role>(["admin", "owner"])
const tagCreatorRoles = new Set<Role>(["author", "admin", "owner"])
const slugPattern = /^[a-z0-9-]+$/
const cyrillicToLatin: Readonly<Record<string, string>> = {
  а: "a",
  б: "b",
  в: "v",
  г: "g",
  д: "d",
  е: "e",
  ё: "e",
  ж: "zh",
  з: "z",
  и: "i",
  й: "i",
  к: "k",
  л: "l",
  м: "m",
  н: "n",
  о: "o",
  п: "p",
  р: "r",
  с: "s",
  т: "t",
  у: "u",
  ф: "f",
  х: "h",
  ц: "c",
  ч: "ch",
  ш: "sh",
  щ: "sch",
  ъ: "",
  ы: "y",
  ь: "",
  э: "e",
  ю: "yu",
  я: "ya"
}
const reservedSectionSlugs = new Set([
  "en",
  "authors",
  "tags",
  "collections",
  "search",
  "me",
  "admin",
  "auth",
  "login",
  "legal",
  "api",
  "rss",
  "sitemap.xml"
])

function requireRole(actor: TaxonomyActor, roles: ReadonlySet<Role>, action: string, requestId: string): void {
  if (!roles.has(actor.role)) {
    throw createApiError("FORBIDDEN", { requestId, action })
  }
}

function normalizeSlug(value: string, requestId: string): string {
  const slug = value.trim().toLowerCase()
  if (!slugPattern.test(slug)) {
    throw createApiError("VALIDATION_ERROR", { requestId, field: "slug", rule: "lowercase-latin-slug" })
  }
  return slug
}

function slugFromName(name: string, requestId: string): string {
  const slug = Array.from(name.trim().toLowerCase())
    .map((character) => cyrillicToLatin[character] ?? character)
    .join("")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")

  if (!slug) {
    throw createApiError("VALIDATION_ERROR", { requestId, field: "name", rule: "slug-source" })
  }
  return slug
}

function normalizeSectionSlug(value: string, requestId: string): string {
  const slug = normalizeSlug(value, requestId)
  if (reservedSectionSlugs.has(slug)) {
    throw createApiError("VALIDATION_ERROR", { requestId, field: "slug", rule: "not-reserved" })
  }
  return slug
}

function isRegistryConflict(error: unknown): boolean {
  return typeof error === "object" && error !== null && Reflect.get(error, "code") === "P2002"
}

export async function archiveSection(
  prisma: TaxonomyClient,
  input: {
    sectionId: string
    successorId: string
    reason: string
    actor: TaxonomyActor
    requestId: string
  }
) {
  requireRole(input.actor, editorialRoles, "section.archive", input.requestId)
  const reason = input.reason.trim()
  if (!reason) {
    throw createApiError("VALIDATION_ERROR", { requestId: input.requestId, field: "reason", rule: "required" })
  }
  if (input.sectionId === input.successorId) {
    throw createApiError("VALIDATION_ERROR", {
      requestId: input.requestId,
      field: "successorId",
      rule: "different-from-section"
    })
  }

  return prisma.$transaction(async (tx) => {
    const rows = await tx.$queryRaw<Array<{ id: string; status: string }>>(Prisma.sql`
      SELECT "id", "status"::text
      FROM "sections"
      WHERE "id" IN (${input.sectionId}, ${input.successorId})
      FOR UPDATE
    `)
    const source = rows.find(({ id }) => id === input.sectionId)
    const successor = rows.find(({ id }) => id === input.successorId)

    if (!source || !successor) {
      throw createApiError("NOT_FOUND", { requestId: input.requestId, entity: "section" })
    }
    if (source.status !== "active" || successor.status !== "active") {
      throw createApiError("CONFLICT", {
        requestId: input.requestId,
        entity: "section",
        expected: "active source and successor",
        actual: `source:${source.status},successor:${successor.status}`
      })
    }

    const movedArticles = await tx.article.updateMany({
      where: { sectionId: input.sectionId },
      data: { sectionId: input.successorId }
    })
    await tx.sectionSlugHistory.updateMany({
      where: { ownerSectionId: input.sectionId },
      data: { redirectToSectionId: input.successorId }
    })
    const section = await tx.section.update({
      where: { id: input.sectionId },
      data: {
        status: "archived",
        successorId: input.successorId,
        archivedAt: new Date(),
        archivedByActorId: input.actor.id,
        archivedByRole: input.actor.role
      }
    })
    await tx.auditLog.create({
      data: {
        action: "section.archive",
        actorId: input.actor.id,
        actorRole: input.actor.role,
        entityType: "Section",
        entityId: input.sectionId,
        diff: { successorId: input.successorId, movedArticles: movedArticles.count, reason },
        requestId: input.requestId
      }
    })
    return section
  })
}

export async function createTag(
  prisma: TaxonomyClient,
  input: {
    input: { name: string; nameEn?: string | null; slug?: string | null; description?: string | null }
    actor: TaxonomyActor
    requestId: string
  }
) {
  requireRole(input.actor, tagCreatorRoles, "tag.create", input.requestId)
  const slug = input.input.slug
    ? normalizeSlug(input.input.slug, input.requestId)
    : slugFromName(input.input.name, input.requestId)

  try {
    return await prisma.$transaction(async (tx) => {
      await tx.tagSlugHistory.create({ data: { slug } })
      const tag = await tx.tag.create({
        data: {
          ...input.input,
          slug,
          createdByActorId: input.actor.id,
          createdByRole: input.actor.role
        }
      })
      await tx.tagSlugHistory.update({
        where: { slug },
        data: { ownerTagId: tag.id, redirectToTagId: tag.id }
      })
      return tag
    })
  } catch (error) {
    if (isRegistryConflict(error)) {
      throw createApiError("CONFLICT", {
        requestId: input.requestId,
        entity: "tag",
        expected: "unused slug",
        actual: "reserved slug"
      })
    }
    throw error
  }
}

export async function archiveTag(
  prisma: TaxonomyClient,
  input: { tagId: string; actor: TaxonomyActor; requestId: string }
) {
  requireRole(input.actor, editorialRoles, "tag.archive", input.requestId)

  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "tags" WHERE "id" = ${input.tagId} FOR UPDATE`)
    await tx.tagSlugHistory.updateMany({ where: { ownerTagId: input.tagId }, data: { redirectToTagId: null } })
    return tx.tag.update({
      where: { id: input.tagId },
      data: {
        status: "archived",
        mergedIntoId: null,
        archivedAt: new Date(),
        archivedByActorId: input.actor.id,
        archivedByRole: input.actor.role
      }
    })
  })
}

export async function mergeTags(
  prisma: TaxonomyClient,
  input: { sourceTagIds: string[]; targetTagId: string; actor: TaxonomyActor; requestId: string }
) {
  requireRole(input.actor, editorialRoles, "tag.merge", input.requestId)
  const sourceTagIds = [...new Set(input.sourceTagIds)]
  if (sourceTagIds.length === 0 || sourceTagIds.includes(input.targetTagId)) {
    throw createApiError("VALIDATION_ERROR", {
      requestId: input.requestId,
      field: "sourceTagIds",
      rule: "non-empty-and-excludes-target"
    })
  }

  return prisma.$transaction(async (tx) => {
    const tagIds = [...sourceTagIds, input.targetTagId]
    const rows = await tx.$queryRaw<Array<{ id: string; status: string }>>(Prisma.sql`
      SELECT "id", "status"::text FROM "tags"
      WHERE "id" IN (${Prisma.join(tagIds)})
      FOR UPDATE
    `)
    if (rows.length !== tagIds.length) {
      throw createApiError("NOT_FOUND", { requestId: input.requestId, entity: "tag" })
    }
    const target = rows.find(({ id }) => id === input.targetTagId)
    if (target?.status !== "active") {
      throw createApiError("CONFLICT", {
        requestId: input.requestId,
        entity: "tag",
        expected: "active merge target",
        actual: target?.status ?? "missing"
      })
    }

    for (const sourceTagId of sourceTagIds) {
      await tx.$executeRaw(Prisma.sql`
        INSERT INTO "_ArticleToTag" ("A", "B")
        SELECT "A", ${input.targetTagId} FROM "_ArticleToTag" WHERE "B" = ${sourceTagId}
        ON CONFLICT DO NOTHING
      `)
      await tx.$executeRaw(Prisma.sql`DELETE FROM "_ArticleToTag" WHERE "B" = ${sourceTagId}`)
    }

    await tx.tagSlugHistory.updateMany({
      where: { ownerTagId: { in: sourceTagIds } },
      data: { redirectToTagId: input.targetTagId }
    })
    await tx.tag.updateMany({
      where: { id: { in: sourceTagIds } },
      data: {
        status: "archived",
        mergedIntoId: input.targetTagId,
        archivedAt: new Date(),
        archivedByActorId: input.actor.id,
        archivedByRole: input.actor.role
      }
    })
    return tx.tag.findUnique({ where: { id: input.targetTagId }, include: { _count: { select: { articles: true } } } })
  })
}

export async function createSection(
  prisma: TaxonomyClient,
  input: {
    input: {
      name: string
      nameEn: string
      slug: string
      order: number
      description?: string | null
      descriptionEn?: string | null
      seoTitle?: string | null
      seoTitleEn?: string | null
      seoDescription?: string | null
      seoDescriptionEn?: string | null
    }
    actor: TaxonomyActor
    requestId: string
  }
) {
  requireRole(input.actor, editorialRoles, "section.create", input.requestId)
  const slug = normalizeSectionSlug(input.input.slug, input.requestId)

  try {
    return await prisma.$transaction(async (tx) => {
      await tx.sectionSlugHistory.create({ data: { slug } })
      const section = await tx.section.create({ data: { ...input.input, slug } })
      await tx.sectionSlugHistory.update({
        where: { slug },
        data: { ownerSectionId: section.id, redirectToSectionId: section.id }
      })
      await tx.auditLog.create({
        data: {
          action: "section.update",
          actorId: input.actor.id,
          actorRole: input.actor.role,
          entityType: "Section",
          entityId: section.id,
          diff: { created: { ...input.input, slug } },
          requestId: input.requestId
        }
      })
      return section
    })
  } catch (error) {
    if (isRegistryConflict(error)) {
      throw createApiError("CONFLICT", {
        requestId: input.requestId,
        entity: "section",
        expected: "unused slug",
        actual: "reserved slug"
      })
    }
    throw error
  }
}

export async function updateSection(
  prisma: TaxonomyClient,
  input: {
    sectionId: string
    input: {
      name?: string
      nameEn?: string
      slug?: string
      order?: number
      description?: string | null
      descriptionEn?: string | null
      seoTitle?: string | null
      seoTitleEn?: string | null
      seoDescription?: string | null
      seoDescriptionEn?: string | null
    }
    actor: TaxonomyActor
    requestId: string
  }
) {
  requireRole(input.actor, editorialRoles, "section.update", input.requestId)
  const slug = input.input.slug ? normalizeSectionSlug(input.input.slug, input.requestId) : undefined

  try {
    return await prisma.$transaction(async (tx) => {
      const current = await tx.section.findUnique({
        where: { id: input.sectionId },
        select: {
          slug: true,
          name: true,
          nameEn: true,
          description: true,
          descriptionEn: true,
          seoTitle: true,
          seoTitleEn: true,
          seoDescription: true,
          seoDescriptionEn: true,
          order: true
        }
      })
      if (!current) throw createApiError("NOT_FOUND", { requestId: input.requestId, entity: "section" })
      if (slug && slug !== current.slug) await tx.sectionSlugHistory.create({ data: { slug } })

      const section = await tx.section.update({
        where: { id: input.sectionId },
        data: { ...input.input, ...(slug ? { slug } : {}) }
      })
      if (slug && slug !== current.slug) {
        await tx.sectionSlugHistory.update({
          where: { slug },
          data: { ownerSectionId: section.id, redirectToSectionId: section.id }
        })
      }
      await tx.auditLog.create({
        data: {
          action: "section.update",
          actorId: input.actor.id,
          actorRole: input.actor.role,
          entityType: "Section",
          entityId: section.id,
          diff: { before: current, after: input.input },
          requestId: input.requestId
        }
      })
      return section
    })
  } catch (error) {
    if (isRegistryConflict(error)) {
      throw createApiError("CONFLICT", {
        requestId: input.requestId,
        entity: "section",
        expected: "unused slug",
        actual: "reserved slug"
      })
    }
    throw error
  }
}

export async function restoreSection(
  prisma: TaxonomyClient,
  input: { sectionId: string; actor: TaxonomyActor; requestId: string }
) {
  requireRole(input.actor, editorialRoles, "section.restore", input.requestId)
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "sections" WHERE "id" = ${input.sectionId} FOR UPDATE`)
    await tx.sectionSlugHistory.updateMany({
      where: { ownerSectionId: input.sectionId },
      data: { redirectToSectionId: input.sectionId }
    })
    const section = await tx.section.update({
      where: { id: input.sectionId },
      data: { status: "active", successorId: null, archivedAt: null, archivedByActorId: null, archivedByRole: null }
    })
    await tx.auditLog.create({
      data: {
        action: "section.restore",
        actorId: input.actor.id,
        actorRole: input.actor.role,
        entityType: "Section",
        entityId: section.id,
        diff: { status: { before: "archived", after: "active" } },
        requestId: input.requestId
      }
    })
    return section
  })
}

export async function updateTag(
  prisma: TaxonomyClient,
  input: {
    tagId: string
    input: { name?: string; nameEn?: string | null; slug?: string; description?: string | null }
    actor: TaxonomyActor
    requestId: string
  }
) {
  requireRole(input.actor, editorialRoles, "tag.update", input.requestId)
  const slug = input.input.slug ? normalizeSlug(input.input.slug, input.requestId) : undefined

  try {
    return await prisma.$transaction(async (tx) => {
      const current = await tx.tag.findUnique({ where: { id: input.tagId }, select: { slug: true } })
      if (!current) throw createApiError("NOT_FOUND", { requestId: input.requestId, entity: "tag" })
      if (slug && slug !== current.slug) await tx.tagSlugHistory.create({ data: { slug } })

      const tag = await tx.tag.update({
        where: { id: input.tagId },
        data: { ...input.input, ...(slug ? { slug } : {}) }
      })
      if (slug && slug !== current.slug) {
        await tx.tagSlugHistory.update({
          where: { slug },
          data: { ownerTagId: tag.id, redirectToTagId: tag.id }
        })
      }
      return tag
    })
  } catch (error) {
    if (isRegistryConflict(error)) {
      throw createApiError("CONFLICT", {
        requestId: input.requestId,
        entity: "tag",
        expected: "unused slug",
        actual: "reserved slug"
      })
    }
    throw error
  }
}

export async function restoreTag(
  prisma: TaxonomyClient,
  input: { tagId: string; actor: TaxonomyActor; requestId: string }
) {
  requireRole(input.actor, editorialRoles, "tag.restore", input.requestId)
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "tags" WHERE "id" = ${input.tagId} FOR UPDATE`)
    await tx.tagSlugHistory.updateMany({ where: { ownerTagId: input.tagId }, data: { redirectToTagId: input.tagId } })
    return tx.tag.update({
      where: { id: input.tagId },
      data: { status: "active", mergedIntoId: null, archivedAt: null, archivedByActorId: null, archivedByRole: null }
    })
  })
}

interface FormatInput {
  name: string
  nameEn?: string | null
  slug: string
  description?: string | null
  descriptionEn?: string | null
}

export async function createFormat(
  prisma: TaxonomyClient,
  input: { input: FormatInput; actor: TaxonomyActor; requestId: string }
) {
  requireRole(input.actor, editorialRoles, "format.create", input.requestId)
  const data = { ...input.input, slug: normalizeSlug(input.input.slug, input.requestId) }

  try {
    return await prisma.$transaction(async (tx) => {
      const format = await tx.format.create({ data })
      await tx.auditLog.create({
        data: {
          action: "format.update",
          actorId: input.actor.id,
          actorRole: input.actor.role,
          entityType: "Format",
          entityId: format.id,
          diff: { created: data },
          requestId: input.requestId
        }
      })
      return format
    })
  } catch (error) {
    if (isRegistryConflict(error)) {
      throw createApiError("CONFLICT", {
        requestId: input.requestId,
        entity: "format",
        expected: "unused slug",
        actual: "existing slug"
      })
    }
    throw error
  }
}

export async function updateFormat(
  prisma: TaxonomyClient,
  input: {
    formatId: string
    input: Partial<FormatInput>
    actor: TaxonomyActor
    requestId: string
  }
) {
  requireRole(input.actor, editorialRoles, "format.update", input.requestId)
  const data = {
    ...input.input,
    ...(input.input.slug ? { slug: normalizeSlug(input.input.slug, input.requestId) } : {})
  }

  try {
    return await prisma.$transaction(async (tx) => {
      const before = await tx.format.findUnique({
        where: { id: input.formatId },
        select: {
          name: true,
          nameEn: true,
          slug: true,
          description: true,
          descriptionEn: true,
          status: true
        }
      })
      if (!before) throw createApiError("NOT_FOUND", { requestId: input.requestId, entity: "format" })
      const format = await tx.format.update({ where: { id: input.formatId }, data })
      await tx.auditLog.create({
        data: {
          action: "format.update",
          actorId: input.actor.id,
          actorRole: input.actor.role,
          entityType: "Format",
          entityId: format.id,
          diff: { before, after: data },
          requestId: input.requestId
        }
      })
      return format
    })
  } catch (error) {
    if (isRegistryConflict(error)) {
      throw createApiError("CONFLICT", {
        requestId: input.requestId,
        entity: "format",
        expected: "unused slug",
        actual: "existing slug"
      })
    }
    throw error
  }
}

export async function archiveFormat(
  prisma: TaxonomyClient,
  input: { formatId: string; actor: TaxonomyActor; requestId: string }
) {
  requireRole(input.actor, editorialRoles, "format.archive", input.requestId)
  return prisma.$transaction(async (tx) => {
    const format = await tx.format.update({
      where: { id: input.formatId },
      data: { status: "archived", archivedAt: new Date() }
    })
    await tx.auditLog.create({
      data: {
        action: "format.update",
        actorId: input.actor.id,
        actorRole: input.actor.role,
        entityType: "Format",
        entityId: format.id,
        diff: { status: { before: "active", after: "archived" } },
        requestId: input.requestId
      }
    })
    return format
  })
}

export async function restoreFormat(
  prisma: TaxonomyClient,
  input: { formatId: string; actor: TaxonomyActor; requestId: string }
) {
  requireRole(input.actor, editorialRoles, "format.restore", input.requestId)
  return prisma.$transaction(async (tx) => {
    const format = await tx.format.update({
      where: { id: input.formatId },
      data: { status: "active", archivedAt: null }
    })
    await tx.auditLog.create({
      data: {
        action: "format.update",
        actorId: input.actor.id,
        actorRole: input.actor.role,
        entityType: "Format",
        entityId: format.id,
        diff: { status: { before: "archived", after: "active" } },
        requestId: input.requestId
      }
    })
    return format
  })
}

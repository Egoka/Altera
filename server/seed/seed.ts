import { ArticleStatus, PlanTier, PrismaClient, Role, TaxonomyStatus } from "../src/generated/prisma"

const prisma = new PrismaClient()

const users = [
  { id: "t007-user-reader", name: "Читатель", handle: "seed-reader", role: Role.reader, planTier: PlanTier.free },
  {
    id: "t007-user-author-standard",
    name: "Автор Standard",
    handle: "seed-author-standard",
    role: Role.author,
    planTier: PlanTier.standard
  },
  {
    id: "t007-user-author-pro",
    name: "Автор Pro",
    handle: "seed-author-pro",
    role: Role.author,
    planTier: PlanTier.pro
  },
  { id: "t007-user-editor", name: "Редактор", handle: "seed-editor", role: Role.editor, planTier: PlanTier.free },
  {
    id: "t007-user-moderator",
    name: "Ревьюер",
    handle: "seed-moderator",
    role: Role.moderator,
    planTier: PlanTier.free
  },
  {
    id: "t007-user-analyst",
    name: "Аналитик",
    handle: "seed-analyst",
    role: Role.analyst,
    planTier: PlanTier.free
  },
  {
    id: "t007-user-admin",
    name: "Администратор",
    handle: "seed-admin",
    role: Role.admin,
    planTier: PlanTier.free
  },
  { id: "t007-user-owner", name: "Владелец", handle: "seed-owner", role: Role.owner, planTier: PlanTier.free }
] as const

const sections = [
  { id: "t007-section-culture", slug: "culture", name: "Культура", nameEn: "Culture" },
  { id: "t007-section-art", slug: "art", name: "Искусство", nameEn: "Art" },
  { id: "t007-section-photography", slug: "photography", name: "Фотография", nameEn: "Photography" },
  { id: "t007-section-music", slug: "music", name: "Музыка", nameEn: "Music" },
  { id: "t007-section-sport", slug: "sport", name: "Спорт", nameEn: "Sport" },
  { id: "t007-section-travel", slug: "travel", name: "Путешествия", nameEn: "Travel" }
] as const

const formats = [
  { id: "t007-format-essay", slug: "essay", name: "Эссе", nameEn: "Essay" },
  { id: "t007-format-review", slug: "review", name: "Обзор", nameEn: "Review" },
  { id: "t007-format-photo-report", slug: "photo-report", name: "Фоторепортаж", nameEn: "Photo report" },
  { id: "t007-format-interview", slug: "interview", name: "Интервью", nameEn: "Interview" },
  { id: "t007-format-column", slug: "column", name: "Колонка", nameEn: "Column" }
] as const

const tags = [
  { id: "t007-tag-history", slug: "history", name: "История", nameEn: "History" },
  { id: "t007-tag-people", slug: "people", name: "Люди", nameEn: "People" },
  { id: "t007-tag-places", slug: "places", name: "Места", nameEn: "Places" }
] as const

const publishedAt = new Date("2026-01-01T12:00:00.000Z")
const archivedAt = new Date("2026-01-02T12:00:00.000Z")

const isServiceRole = (role: Role): boolean => role !== Role.reader && role !== Role.author

export async function seedDatabase(client: PrismaClient): Promise<void> {
  await client.$transaction(
    async (transaction) => {
      for (const user of users) {
        await transaction.handleHistory.upsert({
          where: { handle: user.handle },
          create: { handle: user.handle },
          update: {}
        })
        await transaction.user.upsert({
          where: { id: user.id },
          create: {
            ...user,
            email: `${user.handle}@example.test`,
            isServiceAccount: isServiceRole(user.role)
          },
          update: {
            name: user.name,
            email: `${user.handle}@example.test`,
            handle: user.handle,
            role: user.role,
            planTier: user.planTier,
            planUntil: null,
            isServiceAccount: isServiceRole(user.role),
            archivedAt: null,
            archiveMode: null,
            archivedByActorId: null,
            archivedByRole: null,
            archiveReason: null
          }
        })
        await transaction.handleHistory.update({
          where: { handle: user.handle },
          data: { userId: user.id }
        })
      }

      for (const [order, section] of sections.entries()) {
        await transaction.sectionSlugHistory.upsert({
          where: { slug: section.slug },
          create: { slug: section.slug },
          update: {}
        })
        await transaction.section.upsert({
          where: { id: section.id },
          create: { ...section, order: order + 1 },
          update: {
            slug: section.slug,
            name: section.name,
            nameEn: section.nameEn,
            order: order + 1,
            status: TaxonomyStatus.active,
            successorId: null,
            archivedAt: null,
            archivedByActorId: null,
            archivedByRole: null
          }
        })
        await transaction.sectionSlugHistory.update({
          where: { slug: section.slug },
          data: { ownerSectionId: section.id, redirectToSectionId: null }
        })
      }

      for (const format of formats) {
        await transaction.format.upsert({
          where: { id: format.id },
          create: format,
          update: { ...format, status: TaxonomyStatus.active, archivedAt: null }
        })
      }

      for (const tag of tags) {
        await transaction.tagSlugHistory.upsert({
          where: { slug: tag.slug },
          create: { slug: tag.slug },
          update: {}
        })
        await transaction.tag.upsert({
          where: { id: tag.id },
          create: { ...tag, createdByActorId: "t007-user-author-standard", createdByRole: Role.author },
          update: {
            ...tag,
            status: TaxonomyStatus.active,
            mergedIntoId: null,
            createdByActorId: "t007-user-author-standard",
            createdByRole: Role.author,
            archivedAt: null,
            archivedByActorId: null,
            archivedByRole: null
          }
        })
        await transaction.tagSlugHistory.update({
          where: { slug: tag.slug },
          data: { ownerTagId: tag.id, redirectToTagId: null }
        })
      }

      for (const [index, status] of Object.values(ArticleStatus).entries()) {
        const articleId = `t007-article-${status}`
        const title = `Материал: ${status}`
        const slug = `seed-${status}`
        const body = { type: "root", children: [{ type: "paragraph", text: `Содержимое материала ${status}` }] }
        const isPublished = status === ArticleStatus.published
        const isArchived = status === ArticleStatus.archived
        const articlePublishedAt = isPublished || isArchived ? publishedAt : null

        await transaction.article.upsert({
          where: { id: articleId },
          create: {
            id: articleId,
            title,
            slug,
            body: JSON.stringify(body),
            status,
            publishedAt: articlePublishedAt,
            firstPublishedAt: articlePublishedAt,
            archivedAt: isArchived ? archivedAt : null,
            archivedByActorId: isArchived ? "t007-user-owner" : null,
            archivedByRole: isArchived ? Role.owner : null,
            archiveReason: isArchived ? "Seed fixture" : null,
            authorId: index % 2 === 0 ? "t007-user-author-standard" : "t007-user-author-pro",
            sectionId: sections[index % sections.length].id,
            formatId: formats[index % formats.length].id,
            tags: { connect: [{ id: tags[index % tags.length].id }] }
          },
          update: {
            title,
            slug,
            body: JSON.stringify(body),
            status,
            publishedAt: articlePublishedAt,
            firstPublishedAt: articlePublishedAt,
            archivedAt: isArchived ? archivedAt : null,
            archivedByActorId: isArchived ? "t007-user-owner" : null,
            archivedByRole: isArchived ? Role.owner : null,
            archiveReason: isArchived ? "Seed fixture" : null,
            authorId: index % 2 === 0 ? "t007-user-author-standard" : "t007-user-author-pro",
            sectionId: sections[index % sections.length].id,
            formatId: formats[index % formats.length].id,
            tags: { set: [{ id: tags[index % tags.length].id }] }
          }
        })
      }
    },
    { timeout: 20_000 }
  )
}

async function main(): Promise<void> {
  await seedDatabase(prisma)
  console.log("T-007 seed completed")
}

if (require.main === module) {
  main()
    .catch((error: unknown) => {
      console.error("T-007 seed failed", error)
      process.exitCode = 1
    })
    .finally(async () => {
      await prisma.$disconnect()
    })
}

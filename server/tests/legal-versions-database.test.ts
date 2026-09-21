import { randomUUID } from "node:crypto"
import { beforeAll, describe, expect, it, vi } from "vitest"
import { PrismaClient } from "../src/generated/prisma"
import { publishLegalVersion, readPublicLegalText } from "../src/legal/texts"
import { readConsentStates } from "../src/auth/legal"
import { applyBaselineMigrations } from "./helpers/migration-database"
import { createTestRateLimiter } from "./helpers/rate-limit"

/**
 * T-101: версии юридических текстов и согласия на настоящем PostgreSQL. Двойник не докажет
 * уникальность номера версии, каскад статусов и то, что регистрация пишет строку согласия со
 * ссылкой на конкретную редакцию. Запускается при заданном `T101_TEST_DATABASE_URL`.
 */
const testDatabaseUrl = process.env.T101_TEST_DATABASE_URL
// Все миграции репозитория: имя цели больше любого каталога миграций.
const ALL_MIGRATIONS = "99999999999999_all"

let resolver: typeof import("../src/graphql/auth/resolver").default
let legalResolver: typeof import("../src/graphql/legal/resolver").default

beforeAll(async () => {
  vi.stubEnv("JWT_ACCESS_SECRET", "t101-test-access-secret")
  vi.stubEnv("MAGIC_LINK_BASE_URL", "http://127.0.0.1:4173/auth/verify")
  resolver = (await import("../src/graphql/auth/resolver")).default
  legalResolver = (await import("../src/graphql/legal/resolver")).default
})

const databaseUrl = (name: string): string => {
  const url = new URL(testDatabaseUrl!)
  url.pathname = `/${name}`
  return url.toString()
}

const prismaFor = (url: string): PrismaClient => new PrismaClient({ datasources: { db: { url } } })

const withDatabase = async (run: (database: PrismaClient) => Promise<void>): Promise<void> => {
  const name = `t101_${randomUUID().replaceAll("-", "")}`
  const admin = prismaFor(databaseUrl("postgres"))
  const url = databaseUrl(name)
  try {
    await admin.$executeRawUnsafe(`CREATE DATABASE "${name}"`)
    applyBaselineMigrations(ALL_MIGRATIONS, url)
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

const noopCache = {
  mode: "noop" as const,
  isReady: async () => true,
  get: async () => null,
  set: async () => undefined,
  del: async () => undefined,
  delByTags: async () => undefined,
  close: async () => undefined
}

const contextFor = (prisma: PrismaClient) => {
  const sentMail: string[] = []
  const logger = { log: vi.fn() }
  const ctx = {
    prisma,
    cache: noopCache,
    requestId: "req-t101",
    logger,
    rateLimiter: createTestRateLimiter({ logger: logger as never }),
    piiHasher: { email: (value: string) => `hash(${value})` },
    mail: {
      send: vi.fn(async (input: { content: { text: string } }) => {
        sentMail.push(input.content.text)
        return { mailId: "mail-1", messageId: "<id>" }
      })
    },
    currentUser: null as unknown
  }
  return { ctx, sentMail }
}

const publish = (
  prisma: PrismaClient,
  kind: "terms" | "privacy" | "license",
  options: { material?: boolean; locale?: "ru" | "en"; body?: string } = {}
) =>
  publishLegalVersion(prisma, {
    kind,
    locale: options.locale ?? "ru",
    body: options.body ?? `<h2 id="subject">Предмет</h2><p>${kind}</p>`,
    summaryOfChanges: "Редакция",
    isMaterial: options.material ?? false
  })

const loginLink = async (world: ReturnType<typeof contextFor>, email: string, terms: number, privacy: number) => {
  await resolver.Mutation.requestMagicLink(
    {},
    { email, consentVersion: { termsVersion: terms, privacyVersion: privacy }, locale: "ru" },
    world.ctx as never
  )
  return world.sentMail.at(-1)!.match(/token=([0-9a-f]{64})/)![1]!
}

describe.skipIf(!testDatabaseUrl)("T-101 версии юридических текстов и согласия", () => {
  it("регистрация сохраняет версию согласия; повторное согласие — только после существенной редакции", async () => {
    await withDatabase(async (prisma) => {
      await publish(prisma, "terms")
      await publish(prisma, "privacy")
      const world = contextFor(prisma)

      // Регистрация: аккаунт создаётся первым входом и получает согласие с действующими версиями.
      const registered = await resolver.Mutation.verifyMagicLink(
        {},
        { token: await loginLink(world, "reader@example.test", 1, 1) },
        world.ctx as never
      )
      expect(registered).toMatchObject({ outcome: "authenticated", isNewAccount: true })

      const user = await prisma.user.findUniqueOrThrow({ where: { email: "reader@example.test" } })
      const stored = await prisma.userLegalConsent.findMany({
        where: { userId: user.id },
        select: { acceptedAt: true, legalText: { select: { kind: true, version: true, locale: true } } },
        orderBy: { legalText: { kind: "asc" } }
      })
      expect(stored.map((row) => row.legalText)).toEqual([
        { kind: "terms", version: 1, locale: "ru" },
        { kind: "privacy", version: 1, locale: "ru" }
      ])
      expect(stored.every((row) => row.acceptedAt instanceof Date)).toBe(true)

      // Несущественная редакция действует без нового согласия.
      await publish(prisma, "terms")
      const minor = await resolver.Mutation.verifyMagicLink(
        {},
        { token: await loginLink(world, "reader@example.test", 2, 1) },
        world.ctx as never
      )
      expect(minor.outcome).toBe("authenticated")

      // Существенная — повторное согласие при следующем входе, даже если после неё вышла ещё одна.
      await publish(prisma, "terms", { material: true })
      await publish(prisma, "terms")
      const token = await loginLink(world, "reader@example.test", 4, 1)
      const outdated = await resolver.Mutation.verifyMagicLink({}, { token }, world.ctx as never)
      expect(outdated).toMatchObject({ outcome: "consent_required", termsVersion: 4, privacyVersion: 1 })

      const states = await readConsentStates(prisma, user.id, "ru")
      expect(states).toMatchObject([
        { kind: "terms", currentVersion: 4, acceptedVersion: 1, reconsentRequired: true },
        { kind: "privacy", currentVersion: 1, acceptedVersion: 1, reconsentRequired: false }
      ])

      const accepted = await resolver.Mutation.acceptConsent(
        {},
        { token, termsVersion: 4, privacyVersion: 1 },
        world.ctx as never
      )
      expect(accepted.outcome).toBe("authenticated")

      const consents = await legalResolver.AccountUser.consents({ id: user.id }, {}, {
        ...world.ctx,
        currentUser: user
      } as never)
      expect(consents).toMatchObject([
        { kind: "terms", acceptedVersion: 4, reconsentRequired: false },
        { kind: "privacy", acceptedVersion: 1, reconsentRequired: false }
      ])
      expect(typeof consents[0]!.acceptedAt).toBe("string")
    })
  })

  it("новая редакция переводит прежнюю в архив; версия и локаль читаются по правилам страниц", async () => {
    await withDatabase(async (prisma) => {
      expect(await readPublicLegalText(prisma, { kind: "license", locale: "ru" })).toBeNull()

      await publish(prisma, "license", { body: '<h2 id="ai-training">Обучение ИИ</h2><p>v1</p>' })
      await publish(prisma, "license", { material: true, body: '<h2 id="ai-training">Обучение ИИ</h2><p>v2</p>' })

      const statuses = await prisma.legalText.findMany({
        where: { kind: "license" },
        orderBy: { version: "asc" },
        select: { version: true, status: true, isMaterial: true, publishedAt: true }
      })
      expect(statuses.map(({ version, status, isMaterial }) => ({ version, status, isMaterial }))).toEqual([
        { version: 1, status: "previous", isMaterial: false },
        { version: 2, status: "published", isMaterial: true }
      ])
      expect(statuses.every((row) => row.publishedAt instanceof Date)).toBe(true)

      const current = await readPublicLegalText(prisma, { kind: "license", locale: "ru" })
      expect(current).toMatchObject({
        version: 2,
        isCurrent: true,
        currentVersion: 2,
        isFallbackLocale: false,
        anchors: [{ id: "ai-training", title: "Обучение ИИ" }],
        availableLocales: ["ru"]
      })
      expect(current!.previousVersions.map((item) => item.version)).toEqual([1])

      const previous = await readPublicLegalText(prisma, { kind: "license", locale: "ru", version: 1 })
      expect(previous).toMatchObject({ version: 1, isCurrent: false, currentVersion: 2 })
      expect(previous!.html).toContain("v1")

      // Английский текст не опубликован: страница показывает русский с пометкой.
      expect(await readPublicLegalText(prisma, { kind: "license", locale: "en" })).toMatchObject({
        locale: "ru",
        requestedLocale: "en",
        isFallbackLocale: true
      })

      await expect(readPublicLegalText(prisma, { kind: "license", locale: "ru", version: 7 })).rejects.toThrow(
        "not found"
      )
      await expect(
        legalResolver.Query.legalText({}, { kind: "license", locale: "ru", version: 7 }, {
          prisma,
          cache: noopCache,
          requestId: "req-t101"
        } as never)
      ).rejects.toMatchObject({ extensions: { code: "NOT_FOUND" } })

      // Номер версии уникален в виде и локали: параллельная публикация не создаёт дубль.
      await expect(
        prisma.legalText.create({
          data: { kind: "license", locale: "ru", version: 2, body: "<p>x</p>", summaryOfChanges: "dup" }
        })
      ).rejects.toThrow()
    })
  })
})

import { describe, expect, it, vi } from "vitest"
import resolver from "../src/graphql/support/resolver"
import legalResolver from "../src/graphql/legal/resolver"
import { createCache } from "../src/cache"
import { createRateLimitPlugin } from "../src/rate-limits"
import { SUPPORT_MESSAGE_MAX, SUPPORT_MESSAGE_MIN, supportPath } from "../src/support/requests"
import { createTestRateLimiter } from "./helpers/rate-limit"

/**
 * Письмо в редакцию и «битая ссылка» (`20-public/contact.md`, `not-found.md` §4, матрица #117).
 * Критерий T-059 №1 — обращение сохраняется и несёт `requestId`, если он передан.
 */

interface FakeUser {
  id: string
  email: string
  role: "reader" | "author" | "admin" | "owner"
  locale: "ru" | "en"
  archivedAt: Date | null
  isServiceAccount?: boolean
}

const reader = (overrides: Partial<FakeUser> = {}): FakeUser => ({
  id: "user-1",
  email: "reader@example.test",
  role: "reader",
  locale: "ru",
  archivedAt: null,
  ...overrides
})

const staff: FakeUser[] = [
  { id: "admin-1", email: "admin@example.test", role: "admin", locale: "ru", archivedAt: null },
  { id: "owner-1", email: "owner@example.test", role: "owner", locale: "en", archivedAt: null }
]

const MESSAGE = "Здравствуйте, после оплаты страница показала ошибку, что делать?"

function createWorld(options: { currentUser?: FakeUser | null; mailFails?: boolean } = {}) {
  const saved: Record<string, unknown>[] = []
  const logs: { event: string; data?: Record<string, unknown> }[] = []
  const sentMail: { to: string; template: string; text: string; sanitizedBody: string; objectId?: string }[] = []
  const users = [...staff, ...(options.currentUser ? [options.currentUser] : [])]

  const prisma = {
    supportRequest: {
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        const record = { id: `support-${saved.length + 1}`, ticketNo: 100 + saved.length + 1, ...data }
        saved.push(record)
        return { id: record.id, ticketNo: record.ticketNo }
      })
    },
    user: {
      findMany: vi.fn(async ({ where }: { where: { role: { in: string[] } } }) =>
        users
          .filter((user) => where.role.in.includes(user.role) && !user.archivedAt && !user.isServiceAccount)
          .map(({ email, locale }) => ({ email, locale }))
      )
    }
  }

  const ctx = {
    prisma,
    currentUser: options.currentUser ?? null,
    requestId: "req-t059",
    requestMeta: { ip: "127.0.0.1", userAgent: null },
    logger: { log: (entry: { event: string; data?: Record<string, unknown> }) => logs.push(entry) },
    rateLimiter: createTestRateLimiter(),
    mail: {
      send: vi.fn(async (input: any) => {
        if (options.mailFails) throw new Error("smtp down")
        sentMail.push({
          to: input.to,
          template: input.template,
          text: input.content.text,
          sanitizedBody: input.sanitizedBody,
          objectId: input.objectId
        })
        return { mailId: "mail-1", messageId: "<id>" }
      })
    }
  }

  return { ctx, saved, logs, sentMail }
}

const create = (world: ReturnType<typeof createWorld>, args: Record<string, unknown>) =>
  resolver.Mutation.createSupportRequest({}, args as never, world.ctx as never)

const failure = async (run: () => Promise<unknown>): Promise<Record<string, unknown>> => {
  try {
    await run()
  } catch (error: unknown) {
    return (error as { extensions: Record<string, unknown> }).extensions
  }
  throw new Error("the call was expected to fail")
}

const guestLetter = {
  topic: "general",
  email: " Guest@Example.test ",
  message: MESSAGE,
  acceptPrivacy: true,
  route: "/contact"
}

describe("createSupportRequest — сохранение", () => {
  it("сохраняет обращение гостя с requestId страницы 500 и возвращает номер", async () => {
    const world = createWorld()

    const result = await create(world, { ...guestLetter, requestId: "t058-request-id", path: "/culture/x?utm=1" })

    expect(result).toEqual({ ok: true, ticketNo: 101 })
    expect(world.saved).toHaveLength(1)
    expect(world.saved[0]).toMatchObject({
      topic: "general",
      email: "guest@example.test",
      message: MESSAGE,
      requestId: "t058-request-id",
      path: "/culture/x",
      userId: null,
      locale: "ru",
      createdByRequestId: "req-t059"
    })
  })

  it("без переданного requestId поле остаётся пустым", async () => {
    const world = createWorld()

    await create(world, guestLetter)

    expect(world.saved[0]).toMatchObject({ requestId: null, path: null })
  })

  it("для аккаунта берёт адрес из сессии и игнорирует переданный", async () => {
    const world = createWorld({ currentUser: reader({ locale: "en" }) })

    await create(world, { topic: "refund", email: "someone-else@example.test", message: MESSAGE })

    expect(world.saved[0]).toMatchObject({ email: "reader@example.test", userId: "user-1", locale: "en" })
  })

  it("архивированный аккаунт пишет как гость: адрес из формы и без привязки к записи", async () => {
    const world = createWorld({ currentUser: reader({ archivedAt: new Date("2026-09-01T00:00:00.000Z") }) })

    await create(world, { ...guestLetter, topic: "restore", email: "new-box@example.test" })

    expect(world.saved[0]).toMatchObject({ topic: "restore", email: "new-box@example.test", userId: null })
  })

  it("кнопка 404 создаёт анонимное обращение без адреса и без комментария", async () => {
    const world = createWorld()

    const result = await create(world, { topic: "broken_link", path: "/a/b/c/d?from=mail", message: null })

    expect(result.ok).toBe(true)
    expect(world.saved[0]).toMatchObject({ topic: "broken_link", email: null, message: null, path: "/a/b/c/d" })
  })
})

describe("createSupportRequest — валидация", () => {
  it.each([
    ["короткий текст", { ...guestLetter, message: "Коротко" }, "message"],
    ["слишком длинный текст", { ...guestLetter, message: "я".repeat(SUPPORT_MESSAGE_MAX + 1) }, "message"],
    ["гость без адреса", { ...guestLetter, email: "" }, "email"],
    ["неверный адрес", { ...guestLetter, email: "not-an-address" }, "email"],
    ["гость без согласия", { ...guestLetter, acceptPrivacy: false }, "acceptPrivacy"],
    ["путь не с сайта", { ...guestLetter, path: "https://evil.test/" }, "path"],
    ["requestId неверного вида", { ...guestLetter, requestId: "<script>" }, "requestId"],
    ["неизвестная тема", { ...guestLetter, topic: "privacy" }, "topic"]
  ])("%s → VALIDATION_ERROR", async (_label, args, field) => {
    const world = createWorld()

    const extensions = await failure(() => create(world, args))

    expect(extensions).toMatchObject({ code: "VALIDATION_ERROR", field })
    expect(world.saved).toHaveLength(0)
  })

  it("принимает границы длины текста", async () => {
    const world = createWorld()

    await create(world, { ...guestLetter, message: "я".repeat(SUPPORT_MESSAGE_MIN) })
    await create(world, { ...guestLetter, message: "я".repeat(SUPPORT_MESSAGE_MAX) })

    expect(world.saved).toHaveLength(2)
  })

  it("путь сохраняется без query и фрагмента", () => {
    expect(supportPath(" /culture/essay?utm=mail#top ")).toBe("/culture/essay")
    expect(supportPath("")).toBeNull()
  })
})

describe("createSupportRequest — событие и уведомление", () => {
  it("пишет support.request.created без ПДн отправителя", async () => {
    const world = createWorld()

    await create(world, { ...guestLetter, requestId: "t058-request-id" })

    const event = world.logs.find((entry) => entry.event === "support.request.created")
    expect(event?.data).toEqual({ topic: "general", route: "/contact" })
    expect(JSON.stringify(event)).not.toContain("guest@example.test")
    expect(JSON.stringify(event)).not.toContain(MESSAGE)
  })

  it("произвольный маршрут в лог не попадает", async () => {
    const world = createWorld()

    await create(world, { ...guestLetter, route: "/me/secret?email=a@b.c" })

    expect(world.logs.find((entry) => entry.event === "support.request.created")?.data).toEqual({
      topic: "general",
      route: null
    })
  })

  it("уведомляет admin и owner, копия для истории писем не повторяет адрес и текст", async () => {
    const world = createWorld()

    await create(world, { ...guestLetter, requestId: "t058-request-id" })

    expect(world.sentMail.map((mail) => mail.to).sort()).toEqual(["admin@example.test", "owner@example.test"])
    for (const mail of world.sentMail) {
      expect(mail.template).toBe("support_request_staff")
      expect(mail.objectId).toBe("support-1")
      expect(mail.text).toContain("guest@example.test")
      expect(mail.text).toContain(MESSAGE)
      expect(mail.text).toContain("t058-request-id")
      expect(mail.sanitizedBody).not.toContain("guest@example.test")
      expect(mail.sanitizedBody).not.toContain(MESSAGE)
    }
    expect(world.sentMail.find((mail) => mail.to === "owner@example.test")?.text).toContain("request No. 101")
  })

  it("отказ почты не отменяет сохранённое обращение", async () => {
    const world = createWorld({ mailFails: true })

    const result = await create(world, guestLetter)

    expect(result).toEqual({ ok: true, ticketNo: 101 })
    expect(world.saved).toHaveLength(1)
  })
})

describe("createSupportRequest — лимиты", () => {
  it("аккаунт получает RATE_LIMITED на одиннадцатом обращении за сутки", async () => {
    const world = createWorld({ currentUser: reader() })

    for (let index = 0; index < 10; index += 1) await create(world, { topic: "general", message: MESSAGE })
    const extensions = await failure(() => create(world, { topic: "general", message: MESSAGE }))

    expect(extensions).toMatchObject({ code: "RATE_LIMITED" })
    expect(typeof extensions.retryAfter).toBe("number")
    expect(world.saved).toHaveLength(10)
  })

  it("middleware ограничивает адрес тремя обращениями в час до резолвера", async () => {
    const plugin = createRateLimitPlugin({ forwardedByBff: () => true })
    const rateLimiter = createTestRateLimiter()
    const document = {
      definitions: [
        {
          kind: "OperationDefinition",
          selectionSet: { selections: [{ kind: "Field", name: { value: "createSupportRequest" } }] }
        }
      ]
    }
    const execute = () =>
      (plugin.onExecute as (payload: unknown) => Promise<void>)({
        args: {
          document,
          operationName: null,
          contextValue: { requestId: "req-t059", requestMeta: { ip: "203.0.113.7" }, rateLimiter }
        }
      })

    for (let index = 0; index < 3; index += 1) await execute()
    const extensions = await failure(execute)

    expect(extensions).toMatchObject({ code: "RATE_LIMITED" })
  })
})

describe("staticText — текст «О проекте»", () => {
  const aboutRows = [
    {
      id: "about-ru-1",
      kind: "about",
      locale: "ru",
      version: 1,
      status: "published",
      publishedAt: new Date("2026-09-20T00:00:00.000Z"),
      isMaterial: false,
      summaryOfChanges: "Первая редакция",
      body: '<h2 id="status">Статус</h2><p>Проект развивается.</p>'
    }
  ]

  const legalContext = (rows: typeof aboutRows) => ({
    cache: createCache({}),
    requestId: "req-t059",
    prisma: {
      legalText: {
        findMany: vi.fn(async ({ where }: { where: { kind: string } }) =>
          rows.filter((row) => row.kind === where.kind)
        ),
        findUnique: vi.fn(
          async ({ where }: { where: { id: string } }) => rows.find((row) => row.id === where.id) ?? null
        )
      }
    }
  })

  it("возвращает опубликованный текст и помечает другую локаль", async () => {
    const text = await legalResolver.Query.staticText(
      {},
      { kind: "about", locale: "en" },
      legalContext(aboutRows) as never
    )

    expect(text).toMatchObject({
      kind: "about",
      locale: "ru",
      requestedLocale: "en",
      isFallbackLocale: true,
      version: 1,
      availableLocales: ["ru"]
    })
    expect(text?.html).toContain("Проект развивается.")
  })

  it("без опубликованного текста отвечает null", async () => {
    expect(
      await legalResolver.Query.staticText({}, { kind: "about", locale: "ru" }, legalContext([]) as never)
    ).toBeNull()
  })
})

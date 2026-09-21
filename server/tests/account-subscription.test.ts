import { describe, expect, it } from "vitest"
import { loadFilesSync } from "@graphql-tools/load-files"
import { mergeTypeDefs } from "@graphql-tools/merge"
import { buildASTSchema } from "graphql"
import path from "path"
import resolver from "../src/graphql/account/resolver"

/**
 * T-036: платёжные мутации страниц «Подписка» и «Оплата» на первом запуске
 * (`docs/spec/30-account/reader/subscription.md` §4, §12; журнал §24.1): до включения платности
 * каждая отвечает `FORBIDDEN`, а гость — `UNAUTHENTICATED`.
 */

const MUTATIONS = {
  startCheckout: "checkout.start",
  cancelSubscription: "subscription.cancel",
  resumeSubscription: "subscription.resume",
  requestRefund: "refund.request",
  confirmPriceChange: "subscription.price.confirm"
} as const

type PaymentMutation = keyof typeof MUTATIONS

const ARGS: Record<PaymentMutation, Record<string, unknown>> = {
  startCheckout: { tier: "pro", interval: "year" },
  cancelSubscription: {},
  resumeSubscription: {},
  requestRefund: { paymentId: "payment-1", reason: "не подошёл план" },
  confirmPriceChange: { decision: "confirm" }
}

const context = (currentUser: Record<string, unknown> | null) =>
  ({ currentUser, requestId: "req-t036", prisma: {} }) as never

const reader = { id: "user-1", role: "reader", isServiceAccount: false, archivedAt: null }
const author = { id: "user-2", role: "author", isServiceAccount: false, archivedAt: null }
const staff = { id: "user-3", role: "admin", isServiceAccount: true, archivedAt: null }

const run = (name: PaymentMutation, currentUser: Record<string, unknown> | null) =>
  Promise.resolve().then(() => resolver.Mutation[name](undefined, ARGS[name], context(currentUser)))

describe("payment mutations before payments are enabled", () => {
  const names = Object.keys(MUTATIONS) as PaymentMutation[]

  it.each(names)("%s answers FORBIDDEN to readers, authors and service records", async (name) => {
    for (const user of [reader, author, staff]) {
      await expect(run(name, user)).rejects.toMatchObject({
        extensions: { code: "FORBIDDEN", action: MUTATIONS[name], requestId: "req-t036" }
      })
    }
  })

  it.each(names)("%s answers UNAUTHENTICATED to a guest", async (name) => {
    await expect(run(name, null)).rejects.toMatchObject({ extensions: { code: "UNAUTHENTICATED" } })
  })
})

describe("payment mutations GraphQL contract", () => {
  const schema = buildASTSchema(
    mergeTypeDefs(loadFilesSync(path.resolve(__dirname, "../src/graphql"), { extensions: ["graphql"] }))
  )

  it("declares every payment mutation of subscription.md and checkout.md", () => {
    const fields = schema.getMutationType()?.getFields() ?? {}

    for (const name of Object.keys(MUTATIONS)) expect(fields[name], name).toBeDefined()
    expect(fields.startCheckout?.args.map((arg) => arg.name)).toEqual(["tier", "interval", "promo"])
    expect(fields.requestRefund?.args.map((arg) => arg.name)).toEqual(["paymentId", "reason"])
  })
})

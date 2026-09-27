import { readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { buildSchema, parse, validate } from "graphql"
import { describe, expect, it, vi } from "vitest"
import {
  REFRESH_SESSION_MUTATION,
  createRefreshExchangeStore,
  exchangeRefreshToken,
  isRefreshableRequest,
  isUnauthenticated,
  needsNavigationExchange,
  sendWithSessionRefresh,
  withUpdatedCookies,
  type RefreshOutcome,
  type UpstreamResult
} from "../server/utils/sessionRefresh"

const repositoryRoot = fileURLToPath(new URL("../..", import.meta.url))
const unauthenticated = {
  data: null,
  errors: [{ message: "Authentication required", extensions: { code: "UNAUTHENTICATED" } }]
}
const ok = (body: unknown): UpstreamResult => ({ status: 200, contentType: "application/json", body })
const refreshedPayload = (accessToken: string, refreshToken: string) =>
  ok({ data: { refreshSession: { accessToken, refreshToken } } })

const schemaFiles = (directory: string): string[] =>
  readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) return schemaFiles(path)
    return entry.isFile() && entry.name.endsWith(".graphql") ? [path] : []
  })

describe("мутация обмена", () => {
  it("валидна против схемы API и выбирает только токены", () => {
    const schema = buildSchema(
      schemaFiles(join(repositoryRoot, "server/src/graphql"))
        .sort()
        .map((path) => readFileSync(path, "utf8"))
        .join("\n")
    )

    expect(validate(schema, parse(REFRESH_SESSION_MUTATION))).toEqual([])
    expect(REFRESH_SESSION_MUTATION).toContain("refreshSession(refreshToken: $refreshToken)")
  })
})

describe("isUnauthenticated", () => {
  it("узнаёт отказ API по коду ошибки", () => {
    expect(isUnauthenticated(unauthenticated)).toBe(true)
  })

  it.each([
    ["успешный ответ", { data: { me: { id: "user-1" } } }],
    ["другой код", { data: null, errors: [{ extensions: { code: "FORBIDDEN" } }] }],
    ["ошибку без extensions", { errors: [{ message: "boom" }] }],
    ["не объект", "boom"]
  ])("не принимает за отказ сессии %s", (_name, payload) => {
    expect(isUnauthenticated(payload)).toBe(false)
  })
})

describe("isRefreshableRequest", () => {
  it("обменивает refresh для обычного запроса и мутации", () => {
    expect(isRefreshableRequest([])).toBe(true)
    expect(isRefreshableRequest(["saveArticleDraft"])).toBe(true)
  })

  it.each(["refreshSession", "logout", "logoutAll", "verifyMagicLink", "acceptConsent", "restoreAccountSelf"])(
    "не вмешивается в операцию %s, распоряжающуюся сессией сама",
    (field) => {
      expect(isRefreshableRequest([field])).toBe(false)
    }
  )
})

describe("exchangeRefreshToken", () => {
  it("подставляет предъявленный токен и возвращает новую пару", async () => {
    const send = vi.fn(async () => refreshedPayload("fresh-access", "fresh-refresh"))

    const outcome = await exchangeRefreshToken("cookie-token", send)

    expect(outcome).toEqual({
      status: "refreshed",
      session: { accessToken: "fresh-access", refreshToken: "fresh-refresh" }
    })
    expect(send).toHaveBeenCalledWith({
      query: REFRESH_SESSION_MUTATION,
      variables: { refreshToken: "cookie-token" }
    })
  })

  it("читает отказ API как мёртвую сессию", async () => {
    expect(await exchangeRefreshToken("cookie-token", async () => ok(unauthenticated))).toEqual({ status: "rejected" })
  })

  it.each([
    ["сбой запроса к API", undefined],
    ["ответ без токенов", ok({ data: { refreshSession: { accessToken: "fresh-access", refreshToken: null } } })],
    ["другую ошибку", ok({ data: null, errors: [{ extensions: { code: "INTERNAL_ERROR" } }] })]
  ])("оставляет cookie на месте при %s", async (_name, response) => {
    const send = response
      ? async () => response
      : async () => {
          throw new Error("upstream is unavailable")
        }

    expect(await exchangeRefreshToken("cookie-token", send)).toEqual({ status: "unavailable" })
  })
})

// AC-3: вкладки просыпаются вместе, и без общего обмена вторая предъявила бы уже ротированный
// токен — сервер прочитал бы это как кражу и отозвал все сессии пользователя.
describe("реестр обменов", () => {
  const refreshed: RefreshOutcome = { status: "refreshed", session: { accessToken: "a", refreshToken: "r" } }

  it("делает один обмен на два одновременных запроса с одной cookie", async () => {
    const store = createRefreshExchangeStore()
    const exchange = vi.fn(async () => refreshed)

    const outcomes = await Promise.all([
      store.run("cookie-token", exchange),
      store.run("cookie-token", exchange),
      store.run("cookie-token", exchange)
    ])

    expect(exchange).toHaveBeenCalledOnce()
    expect(outcomes).toEqual([refreshed, refreshed, refreshed])
  })

  it("отдаёт результат победителя запросу, который пришёл со прежней cookie позже", async () => {
    let moment = 1_000
    const store = createRefreshExchangeStore({ ttlMs: 500, now: () => moment })
    const exchange = vi.fn(async () => refreshed)

    expect(await store.run("cookie-token", exchange)).toEqual(refreshed)
    moment += 499
    expect(await store.run("cookie-token", exchange)).toEqual(refreshed)
    expect(exchange).toHaveBeenCalledOnce()

    // Позже результат перестаёт быть общим: следующий запрос идёт к API сам.
    moment += 2
    expect(await store.run("cookie-token", exchange)).toEqual(refreshed)
    expect(exchange).toHaveBeenCalledTimes(2)
  })

  it("разным сессиям делает разные обмены", async () => {
    const store = createRefreshExchangeStore()
    const exchange = vi.fn(async () => refreshed)

    await Promise.all([store.run("first-tab-token", exchange), store.run("second-account-token", exchange)])

    expect(exchange).toHaveBeenCalledTimes(2)
  })

  it("не запоминает недоступный апстрим", async () => {
    const store = createRefreshExchangeStore()
    const exchange = vi.fn(async (): Promise<RefreshOutcome> => ({ status: "unavailable" }))

    await store.run("cookie-token", exchange)
    await store.run("cookie-token", exchange)

    expect(exchange).toHaveBeenCalledTimes(2)
  })

  it("не оставляет сбой обмена общим результатом", async () => {
    const store = createRefreshExchangeStore()
    const exchange = vi.fn(async (): Promise<RefreshOutcome> => {
      throw new Error("boom")
    })

    await expect(store.run("cookie-token", exchange)).rejects.toThrow("boom")
    await expect(store.run("cookie-token", exchange)).rejects.toThrow("boom")
    expect(exchange).toHaveBeenCalledTimes(2)
  })
})

describe("sendWithSessionRefresh", () => {
  const dashboard = ok({ data: { me: { id: "user-1" } } })

  it("обменивает refresh и повторяет запрос один раз", async () => {
    const send = vi
      .fn<(session: { refreshToken: string | null; accessToken: string | null }) => Promise<UpstreamResult>>()
      .mockResolvedValueOnce(ok(unauthenticated))
      .mockResolvedValueOnce(dashboard)
    const refresh = vi.fn(
      async (): Promise<RefreshOutcome> => ({
        status: "refreshed",
        session: { accessToken: "fresh-access", refreshToken: "fresh-refresh" }
      })
    )

    const outcome = await sendWithSessionRefresh({
      fields: [],
      refreshToken: "cookie-token",
      accessToken: null,
      send,
      refresh
    })

    expect(outcome.result).toBe(dashboard)
    expect(outcome.session).toEqual({ accessToken: "fresh-access", refreshToken: "fresh-refresh" })
    expect(outcome.clear).toBe(false)
    expect(refresh).toHaveBeenCalledOnce()
    expect(send).toHaveBeenNthCalledWith(2, { refreshToken: "fresh-refresh", accessToken: "fresh-access" })
  })

  it("больше одного повтора не делает", async () => {
    const send = vi.fn(async () => ok(unauthenticated))

    const outcome = await sendWithSessionRefresh({
      fields: [],
      refreshToken: "cookie-token",
      accessToken: "stale-access",
      send,
      refresh: async () => ({
        status: "refreshed",
        session: { accessToken: "fresh-access", refreshToken: "fresh-refresh" }
      })
    })

    expect(send).toHaveBeenCalledTimes(2)
    expect(isUnauthenticated(outcome.result.body)).toBe(true)
    expect(outcome.clear).toBe(false)
  })

  it("стирает cookie, когда API не признал refresh", async () => {
    const outcome = await sendWithSessionRefresh({
      fields: [],
      refreshToken: "cookie-token",
      accessToken: null,
      send: async () => ok(unauthenticated),
      refresh: async () => ({ status: "rejected" })
    })

    expect(outcome).toMatchObject({ session: null, clear: true })
  })

  it("оставляет cookie, когда обмен не удался по недоступности API", async () => {
    const outcome = await sendWithSessionRefresh({
      fields: [],
      refreshToken: "cookie-token",
      accessToken: null,
      send: async () => ok(unauthenticated),
      refresh: async () => ({ status: "unavailable" })
    })

    expect(outcome).toMatchObject({ session: null, clear: false })
  })

  it.each([
    ["без refresh-cookie", null, [] as string[], ok(unauthenticated)],
    ["для самой мутации обмена", "cookie-token", ["refreshSession"], ok(unauthenticated)],
    ["для выхода", "cookie-token", ["logout"], ok(unauthenticated)],
    ["для успешного ответа", "cookie-token", [], ok({ data: { me: null } })]
  ])("не обменивает refresh %s", async (_name, refreshToken, fields, response) => {
    const refresh = vi.fn(async (): Promise<RefreshOutcome> => ({ status: "rejected" }))
    const send = vi.fn(async () => response)

    const outcome = await sendWithSessionRefresh({ fields, refreshToken, accessToken: null, send, refresh })

    expect(refresh).not.toHaveBeenCalled()
    expect(send).toHaveBeenCalledOnce()
    expect(outcome).toMatchObject({ session: null, clear: false })
  })
})

// AC-1: навигация вошедшего с истёкшей access-cookie обменивает refresh до рендера страницы.
describe("needsNavigationExchange", () => {
  const navigation = {
    method: "GET",
    path: "/me",
    accept: "text/html,application/xhtml+xml",
    accessCookie: undefined,
    refreshCookie: "cookie-token"
  }

  it("обменивает refresh для навигации без access-cookie", () => {
    expect(needsNavigationExchange(navigation)).toBe(true)
    expect(needsNavigationExchange({ ...navigation, method: "HEAD" })).toBe(true)
    expect(needsNavigationExchange({ ...navigation, path: "/me?tab=drafts" })).toBe(true)
  })

  it.each([
    ["гостя без refresh-cookie", { refreshCookie: undefined }],
    ["живую access-cookie", { accessCookie: "fresh-access" }],
    ["мутацию страницы", { method: "POST" }],
    ["внутренний вызов страницы", { path: "/api/graphql" }],
    ["ресурс сборки", { path: "/_nuxt/entry.js" }],
    ["ответ с общим кешем", { path: "/rss.xml" }],
    ["robots.txt", { path: "/robots.txt" }],
    ["запрос не за страницей", { accept: "application/json" }],
    ["запрос без accept", { accept: undefined }]
  ])("не обменивает refresh на %s", (_name, override) => {
    expect(needsNavigationExchange({ ...navigation, ...override })).toBe(false)
  })
})

// AC-1: SSR читает cookie из заголовков запроса, поэтому обновлённая пара подставляется в них.
describe("withUpdatedCookies", () => {
  it("заменяет обе cookie сессии и сохраняет остальные", () => {
    const header = "i18n_redirected=ru; altera_access=stale; altera_refresh=old; nuxt-color-mode=dark"

    expect(withUpdatedCookies(header, { altera_access: "fresh", altera_refresh: "rotated" })).toBe(
      "i18n_redirected=ru; nuxt-color-mode=dark; altera_access=fresh; altera_refresh=rotated"
    )
  })

  it("добавляет cookie, которой в запросе не было", () => {
    expect(withUpdatedCookies(undefined, { altera_access: "fresh" })).toBe("altera_access=fresh")
  })

  it("убирает cookie мёртвой сессии", () => {
    expect(
      withUpdatedCookies("altera_access=stale; altera_refresh=dead", { altera_access: null, altera_refresh: null })
    ).toBe("")
  })
})

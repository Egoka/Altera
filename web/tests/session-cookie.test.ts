import { describe, expect, it } from "vitest"
import {
  REFRESH_COOKIE_MAX_AGE_SECONDS,
  extractSessionCookie,
  isLoginTokenExchange,
  isSameOriginMutation,
  readOperation,
  withRefreshTokenVariable
} from "../server/utils/sessionCookie"

const refreshMutation =
  'mutation RefreshSession($refreshToken: String! = "") { refreshSession(refreshToken: $refreshToken) { accessToken refreshToken } }'
const logoutMutation = "mutation Logout($refreshToken: String) { logout(refreshToken: $refreshToken) }"

describe("readOperation", () => {
  it("reports the mutation fields of the selected operation", () => {
    expect(readOperation({ query: refreshMutation })).toEqual({ isMutation: true, fields: ["refreshSession"] })
  })

  it("picks the operation named by the request", () => {
    const query = `${refreshMutation}\n${logoutMutation}`

    expect(readOperation({ query, operationName: "Logout" })).toEqual({ isMutation: true, fields: ["logout"] })
    expect(readOperation({ query })).toEqual({ isMutation: false, fields: [] })
  })

  it.each([
    ["a query", { query: "{ __typename }" }],
    ["a malformed document", { query: "mutation {" }],
    ["a body without a query", { variables: {} }],
    ["a non-object body", null]
  ])("returns no mutation fields for %s", (_name, body) => {
    expect(readOperation(body)).toEqual({ isMutation: false, fields: [] })
  })
})

describe("withRefreshTokenVariable", () => {
  it("replaces any client-supplied refresh token with the cookie value", () => {
    const body = { query: refreshMutation, variables: { refreshToken: "stolen-token" } }

    expect(withRefreshTokenVariable(body, ["refreshSession"], "cookie-token")).toEqual({
      query: refreshMutation,
      variables: { refreshToken: "cookie-token" }
    })
  })

  it("sends an empty token when the visitor has no cookie", () => {
    expect(withRefreshTokenVariable({ query: logoutMutation }, ["logout"], null)).toEqual({
      query: logoutMutation,
      variables: { refreshToken: "" }
    })
  })

  it("leaves unrelated operations untouched", () => {
    const body = { query: "{ __typename }" }

    expect(withRefreshTokenVariable(body, [], "cookie-token")).toBe(body)
  })
})

describe("extractSessionCookie", () => {
  it("moves the issued refresh token out of the response body", () => {
    const payload = {
      data: { verifyMagicLink: { accessToken: "access", refreshToken: "secret", user: { id: "user-1" } } }
    }

    const outcome = extractSessionCookie(payload, ["verifyMagicLink"])

    expect(outcome.token).toBe("secret")
    expect(outcome.clear).toBe(false)
    expect(outcome.body).toEqual({
      data: { verifyMagicLink: { accessToken: "access", refreshToken: null, user: { id: "user-1" } } }
    })
    expect(JSON.stringify(outcome.body)).not.toContain("secret")
  })

  it("asks to clear the cookie after a successful logout", () => {
    expect(extractSessionCookie({ data: { logout: true } }, ["logout"])).toMatchObject({ token: null, clear: true })
    expect(extractSessionCookie({ data: { logoutAll: true } }, ["logoutAll"])).toMatchObject({ clear: true })
  })

  it("keeps the cookie when logout itself failed", () => {
    const payload = { data: { logout: null }, errors: [{ message: "Authentication required" }] }

    expect(extractSessionCookie(payload, ["logout"])).toMatchObject({ token: null, clear: false })
  })

  it("clears the cookie when the refresh was rejected", () => {
    const payload = { data: null, errors: [{ message: "Authentication required" }] }

    expect(extractSessionCookie(payload, ["refreshSession"])).toMatchObject({ token: null, clear: true })
  })

  it("leaves a response without session fields untouched", () => {
    const payload = { data: { __typename: "Query" } }

    expect(extractSessionCookie(payload, [])).toEqual({
      body: payload,
      token: null,
      accessToken: null,
      clear: false
    })
  })

  // T-035: восстановление аккаунта меняет ограниченную сессию на полную из браузера, без
  // перезагрузки страницы (`30-account/reader/archived-state.md` §4), поэтому маршрут обновляет
  // обе cookie — иначе в браузере остался бы токен уже отозванной сессии.
  it("carries both tokens of the session issued by a self-restore", () => {
    const payload = {
      data: {
        restoreAccountSelf: {
          restored: true,
          session: { accessToken: "fresh-access", refreshToken: "fresh-refresh", user: { id: "user-1" } }
        }
      }
    }

    const outcome = extractSessionCookie(payload, ["restoreAccountSelf"])

    expect(outcome.token).toBe("fresh-refresh")
    expect(outcome.accessToken).toBe("fresh-access")
    expect(outcome.clear).toBe(false)
    expect(JSON.stringify(outcome.body)).not.toContain("fresh-refresh")
  })

  // Подтверждение архива отзывает все сессии в той же транзакции (`session-lifecycle.md` п. 7).
  it("asks to clear the cookie after the account archive is confirmed", () => {
    const payload = { data: { confirmAccountArchive: { archived: true, articlesArchived: 2 } } }

    expect(extractSessionCookie(payload, ["confirmAccountArchive"])).toMatchObject({ token: null, clear: true })
  })

  it("keeps the cookie when the archive confirmation failed", () => {
    const payload = { data: null, errors: [{ message: "Entity not found" }] }

    expect(extractSessionCookie(payload, ["confirmAccountArchive"])).toMatchObject({ token: null, clear: false })
  })
})

describe("isSameOriginMutation", () => {
  it.each([
    [
      "a same-origin browser request",
      { origin: "https://altera.test", secFetchSite: "same-origin", host: "altera.test" }
    ],
    ["a typed-in address", { secFetchSite: "none", host: "altera.test" }],
    ["an internal SSR call", { host: "altera.test" }]
  ])("accepts %s", (_name, headers) => {
    expect(isSameOriginMutation(headers)).toBe(true)
  })

  it.each([
    ["a cross-site fetch", { origin: "https://evil.test", secFetchSite: "cross-site", host: "altera.test" }],
    ["a foreign origin without the fetch metadata", { origin: "https://evil.test", host: "altera.test" }],
    ["a sibling site", { origin: "https://other.altera.test", secFetchSite: "same-site", host: "altera.test" }],
    ["a malformed origin", { origin: "not-a-url", host: "altera.test" }]
  ])("rejects %s", (_name, headers) => {
    expect(isSameOriginMutation(headers)).toBe(false)
  })
})

// T-123 AC-2: ссылка из веб-почты открывается как межсайтовый переход, поэтому обмен токена —
// единственное исключение из проверки происхождения, и оно не должно прикрывать чужую мутацию.
describe("isLoginTokenExchange", () => {
  const navigation = { secFetchMode: "navigate", contentType: "application/json; charset=utf-8" }

  it.each([["verifyMagicLink"], ["acceptConsent"]])("допускает межсайтовый обмен %s", (field) => {
    expect(isLoginTokenExchange([field], navigation)).toBe(true)
  })

  it("допускает серверный вызов без заголовков перехода", () => {
    expect(isLoginTokenExchange(["verifyMagicLink"], {})).toBe(true)
  })

  it.each([
    ["мутацию без обмена токена", ["logoutAll"], navigation],
    ["батч обмена с чужой мутацией", ["verifyMagicLink", "logoutAll"], navigation],
    ["операцию без корневых полей", [], navigation],
    ["простую форму со чужого сайта", ["verifyMagicLink"], { ...navigation, contentType: "text/plain" }],
    [
      "форму с кодированным телом",
      ["verifyMagicLink"],
      { ...navigation, contentType: "application/x-www-form-urlencoded" }
    ],
    ["фоновый запрос со чужой страницы", ["verifyMagicLink"], { ...navigation, secFetchMode: "cors" }],
    ["подзапрос со чужой страницы", ["verifyMagicLink"], { ...navigation, secFetchMode: "no-cors" }]
  ])("не допускает %s", (_name, fields, headers) => {
    expect(isLoginTokenExchange(fields, headers)).toBe(false)
  })
})

describe("refresh cookie lifetime", () => {
  it("matches the thirty-day session window of the API", () => {
    expect(REFRESH_COOKIE_MAX_AGE_SECONDS).toBe(60 * 60 * 24 * 30)
  })
})

/**
 * Ветка пароля (T-115): вход, подтверждение адреса и сброс выдают сессию так же, как
 * подтверждение ссылки, поэтому refresh из их ответа обязан уходить в httpOnly-cookie, а не в
 * браузерный JS (ADR-0023 п. 2).
 */
describe("password branch session handling", () => {
  const passwordLogin = {
    data: {
      loginWithPassword: {
        outcome: "authenticated",
        session: { accessToken: "access-token", refreshToken: "refresh-token" }
      }
    }
  }

  it.each(["loginWithPassword", "confirmEmail", "resetPassword"])(
    "moves the refresh of %s into the cookie",
    (field) => {
      const payload = {
        data: {
          [field]: {
            outcome: "authenticated",
            session: { accessToken: "access-token", refreshToken: "refresh-token" }
          }
        }
      }

      const outcome = extractSessionCookie(payload, [field])

      expect(outcome.token).toBe("refresh-token")
      expect(outcome.accessToken).toBe("access-token")
      expect(JSON.stringify(outcome.body)).not.toContain("refresh-token")
    }
  )

  it("keeps the browser without the refresh token of a password login", () => {
    const outcome = extractSessionCookie(passwordLogin, ["loginWithPassword"])

    expect(
      (outcome.body as { data: { loginWithPassword: { session: { refreshToken: string | null } } } }).data
        .loginWithPassword.session.refreshToken
    ).toBeNull()
  })

  it("lets the confirmation link from the letter through the origin check, but not other mutations", () => {
    expect(isLoginTokenExchange(["confirmEmail"], { secFetchMode: "navigate", contentType: "application/json" })).toBe(
      true
    )
    expect(isLoginTokenExchange(["resetPassword"], { secFetchMode: "navigate", contentType: "application/json" })).toBe(
      false
    )
    expect(
      isLoginTokenExchange(["confirmEmail", "setPassword"], {
        secFetchMode: "navigate",
        contentType: "application/json"
      })
    ).toBe(false)
  })
})

import { expect, test } from "@playwright/test"

const apiUrl = "http://127.0.0.1:4000/"
const nuxtOrigin = "http://127.0.0.1:4173"

test("browser receives Yoga __typename through the same-origin BFF", async ({ page }) => {
  await page.goto("/", { waitUntil: "networkidle" })
  const externalRequestId = "44444444-4444-4444-8444-444444444444"

  const result = await page.evaluate(async (externalId) => {
    const response = await fetch("/api/graphql", {
      method: "POST",
      headers: { "content-type": "application/json", "x-request-id": externalId },
      body: JSON.stringify({ query: "{ __typename }" })
    })

    const text = await response.text()
    let body: unknown = text
    try {
      body = JSON.parse(text)
    } catch {
      // Missing routes return Nuxt HTML during the RED phase.
    }

    return { status: response.status, body, requestId: response.headers.get("x-request-id") }
  }, externalRequestId)

  expect(result).toEqual({
    status: 200,
    body: { data: { __typename: "Query" } },
    requestId: expect.stringMatching(/^[0-9a-f-]{36}$/i)
  })
  expect(result.requestId).not.toBe(externalRequestId)
})

test("BFF rejects a malformed body without exposing its upstream URL", async ({ page }) => {
  await page.goto("/", { waitUntil: "networkidle" })

  const result = await page.evaluate(async () => {
    const response = await fetch("/api/graphql", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ variables: {} })
    })

    return { status: response.status, body: await response.text() }
  })

  expect(result.status).toBe(400)
  expect(result.body).toContain("Invalid GraphQL request body")
  expect(result.body).not.toContain("requestId")
  expect(result.body).not.toContain("127.0.0.1:4000")
})

test("Yoga CORS allows Nuxt and does not reflect an unrelated origin", async ({ request }) => {
  const allowed = await request.post(apiUrl, {
    headers: { origin: nuxtOrigin, "content-type": "application/json" },
    data: { query: "{ __typename }" }
  })
  const unrelated = await request.post(apiUrl, {
    headers: { origin: "https://unrelated.example.test", "content-type": "application/json" },
    data: { query: "{ __typename }" }
  })

  expect(allowed.headers()["access-control-allow-origin"]).toBe(nuxtOrigin)
  expect(unrelated.headers()["access-control-allow-origin"]).not.toBe("https://unrelated.example.test")
  expect(unrelated.headers()["access-control-allow-origin"]).not.toBe("*")
})

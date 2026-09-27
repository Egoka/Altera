import { expect, test } from "./helpers/test"
import { resetRateLimitCounters } from "./helpers/auth-fixtures"

/**
 * T-125: лимит по адресу нельзя снять ни подставленным `X-Forwarded-For`, ни алиасами одного поля
 * в документе (`docs/spec/50-access/rate-limits.md` §2 п. 2, 13). Проверка идёт на настоящем
 * сервере: именно связка BFF → API решала, какому адресу верить, и именно её обходили.
 */
const VERIFY = `mutation ($token: String!) { verifyMagicLink(token: $token) { outcome } }`

const aliasDocument = (count: number) =>
  `mutation { ${Array.from({ length: count }, (_, index) => `a${index}: verifyMagicLink(token: "t125-${index}") { outcome }`).join(" ")} }`

interface GraphQLEnvelope {
  data?: Record<string, unknown> | null
  errors?: { message: string; extensions?: { code?: string; retryAfter?: number } }[]
}

// `rate-limits.md` §2 п. 3: подтверждение ссылки — 10 попыток в час на адрес `[ДОПУЩЕНИЕ]`.
const VERIFY_LIMIT = 10

test.beforeEach(resetRateLimitCounters)

// Тег `@real-rate-limit`: тест исчерпывает настоящую корзину, поэтому идёт отдельным проектом
// после всех остальных — их очистка счётчиков посреди исчерпания пропускала лимит.
test("подставленный X-Forwarded-For не снимает лимит по адресу", { tag: "@real-rate-limit" }, async ({ request }) => {
  const call = async () =>
    (
      await request.post("/api/graphql", {
        // Так обходили лимит: петлевой адрес объявлялся системным вызовом исключений §3.
        headers: { "content-type": "application/json", "x-forwarded-for": "127.0.0.1" },
        data: { query: VERIFY, variables: { token: "t125-spoofed" } }
      })
    ).json() as Promise<GraphQLEnvelope>

  for (let attempt = 0; attempt < VERIFY_LIMIT; attempt += 1) {
    const envelope = await call()
    expect(envelope.errors?.[0]?.extensions?.code, `попытка ${attempt + 1} не должна быть лимитирована`).not.toBe(
      "RATE_LIMITED"
    )
  }

  const limited = await call()

  expect(limited.errors?.[0]?.extensions?.code).toBe("RATE_LIMITED")
  expect(limited.errors?.[0]?.extensions?.retryAfter).toBeGreaterThan(0)
})

// Тоже `@real-rate-limit`: корзина набирается записями по одной на вхождение внутри запроса.
test("алиасы одного поля расходуют корзину по числу вхождений", { tag: "@real-rate-limit" }, async ({ request }) => {
  const response = await request.post("/api/graphql", {
    headers: { "content-type": "application/json" },
    data: { query: aliasDocument(VERIFY_LIMIT + 1) }
  })
  const envelope = (await response.json()) as GraphQLEnvelope

  // Превышение отклоняет весь документ, а не отдельное его поле.
  expect(envelope.errors?.[0]?.extensions?.code).toBe("RATE_LIMITED")
  expect(envelope.data ?? null).toBeNull()
})

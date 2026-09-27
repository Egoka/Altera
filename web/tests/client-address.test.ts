import { describe, expect, it } from "vitest"
import config from "../nuxt.config"
import { DEFAULT_TRUSTED_PROXY_HOPS, resolveTrustedClientAddress } from "../server/utils/clientAddress"

/**
 * Лимиты частоты по адресу (`docs/spec/50-access/rate-limits.md` §2 п. 2) держатся на том, что
 * адрес нельзя подставить заголовком. Самый левый элемент `X-Forwarded-For` присылает клиент:
 * пока BFF брал его, `X-Forwarded-For: 127.0.0.1` снимал лимит целиком.
 */
describe("доверенный адрес клиента", () => {
  const socketAddress = "10.0.0.7"

  it("берёт адрес, добавленный доверенным прокси, а не присланный клиентом", () => {
    expect(resolveTrustedClientAddress({ forwardedFor: "127.0.0.1, 203.0.113.10", socketAddress })).toBe("203.0.113.10")
    expect(resolveTrustedClientAddress({ forwardedFor: "198.51.100.7, 203.0.113.10", socketAddress })).toBe(
      "203.0.113.10"
    )
  })

  it("пропускает элементы доверенных прокси между собой при нескольких прокси", () => {
    // Клиент → Cloudflare → Gateway → BFF: Gateway дописал адрес Cloudflare, Cloudflare — клиента.
    expect(
      resolveTrustedClientAddress({
        forwardedFor: "127.0.0.1, 203.0.113.10, 198.51.100.7",
        socketAddress,
        trustedProxyHops: 2
      })
    ).toBe("203.0.113.10")
  })

  it("без заголовка и при слишком коротком списке остаётся адрес соединения", () => {
    expect(resolveTrustedClientAddress({ forwardedFor: null, socketAddress })).toBe(socketAddress)
    expect(resolveTrustedClientAddress({ forwardedFor: "   ", socketAddress })).toBe(socketAddress)
    expect(resolveTrustedClientAddress({ forwardedFor: "203.0.113.10", socketAddress, trustedProxyHops: 3 })).toBe(
      socketAddress
    )
  })

  it("не передаёт значение, которое не является адресом", () => {
    expect(resolveTrustedClientAddress({ forwardedFor: "not-an-address", socketAddress: null })).toBeUndefined()
    expect(resolveTrustedClientAddress({ forwardedFor: "", socketAddress: "localhost" })).toBeUndefined()
  })

  it("не доверяет клиентскому заголовку при испорченном числе прокси", () => {
    for (const hops of [0, -5, 0.5, Number.NaN, null]) {
      expect(resolveTrustedClientAddress({ forwardedFor: "127.0.0.1, 203.0.113.10", trustedProxyHops: hops })).toBe(
        "203.0.113.10"
      )
    }
  })

  it("держит число доверенных прокси в приватном runtime config", () => {
    expect(config.runtimeConfig?.trustedProxyHops).toBe(DEFAULT_TRUSTED_PROXY_HOPS)
    expect(config.runtimeConfig?.public ?? {}).not.toHaveProperty("trustedProxyHops")
  })
})

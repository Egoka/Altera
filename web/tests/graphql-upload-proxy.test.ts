import { createHmac } from "node:crypto"
import { describe, expect, it, vi } from "vitest"
import { MAX_UPLOAD_ENVELOPE_BYTES, isMultipartRequest, proxyGraphQLUpload } from "../server/utils/graphqlProxy"

/**
 * T-040: загрузка обложки из редактора идёт multipart-запросом GraphQL (`uploadMedia`, T-063).
 *
 * Маршрут `/api/graphql` читал только JSON, поэтому обложку из браузера загрузить было нельзя
 * (это отметил план T-066). Конверт пропускается наверх байт в байт: граница формы лежит в
 * `content-type`, и повторная сборка тела ломала бы разбор файла.
 */

const requestId = "11111111-1111-4111-8111-111111111111"
const requestIdForwardSecret = "request-forward-secret"
const envelope = Buffer.from('--boundary\r\nContent-Disposition: form-data; name="operations"\r\n\r\n{}\r\n')
const contentType = "multipart/form-data; boundary=boundary"

const okFetch = () =>
  vi.fn(async () => ({
    status: 200,
    headers: new Headers({ "content-type": "application/json" }),
    _data: { data: { uploadMedia: { id: "asset-1" } } }
  }))

describe("isMultipartRequest", () => {
  it.each([
    ["multipart/form-data; boundary=x", true],
    ["Multipart/Form-Data; boundary=x", true],
    ["application/json", false],
    [undefined, false]
  ])("%s — %s", (value, expected) => {
    expect(isMultipartRequest(value as string | undefined)).toBe(expected)
  })
})

describe("proxyGraphQLUpload", () => {
  it("отправляет тело как есть и сохраняет границу конверта", async () => {
    const fetchRaw = okFetch()

    const result = await proxyGraphQLUpload({
      graphqlApiUrl: "http://127.0.0.1:4000/",
      body: envelope,
      contentType,
      authorization: "Bearer test-token",
      requestId,
      requestIdForwardSecret,
      fetchRaw
    })

    expect(result.status).toBe(200)
    const [, options] = fetchRaw.mock.calls[0]!
    expect(options.body).toBe(envelope)
    expect(options.headers).toEqual({
      accept: "application/graphql-response+json, application/json",
      "content-type": contentType,
      "x-graphql-yoga-csrf": "bff",
      authorization: "Bearer test-token",
      "x-request-id": requestId,
      "x-request-id-signature": createHmac("sha256", requestIdForwardSecret).update(requestId).digest("hex")
    })
  })

  it("не-multipart тело отклоняется без обращения к API", async () => {
    const fetchRaw = okFetch()

    await expect(
      proxyGraphQLUpload({
        graphqlApiUrl: "http://127.0.0.1:4000/",
        body: envelope,
        contentType: "application/json",
        requestId,
        requestIdForwardSecret,
        fetchRaw
      })
    ).rejects.toMatchObject({ statusCode: 400 })
    expect(fetchRaw).not.toHaveBeenCalled()
  })

  it("конверт больше порога не буферизуется дальше: API всё равно откажет", async () => {
    const fetchRaw = okFetch()

    await expect(
      proxyGraphQLUpload({
        graphqlApiUrl: "http://127.0.0.1:4000/",
        body: Buffer.alloc(MAX_UPLOAD_ENVELOPE_BYTES + 1),
        contentType,
        requestId,
        requestIdForwardSecret,
        fetchRaw
      })
    ).rejects.toMatchObject({ statusCode: 413 })
    expect(fetchRaw).not.toHaveBeenCalled()
  })

  it("недоступный API отвечает 502, а не пустым успехом", async () => {
    await expect(
      proxyGraphQLUpload({
        graphqlApiUrl: "http://127.0.0.1:4000/",
        body: envelope,
        contentType,
        requestId,
        requestIdForwardSecret,
        fetchRaw: vi.fn(async () => {
          throw new Error("connection refused")
        })
      })
    ).rejects.toMatchObject({ statusCode: 502 })
  })

  it("без секрета трассировки запрос наверх не уходит", async () => {
    const fetchRaw = okFetch()

    await expect(
      proxyGraphQLUpload({
        graphqlApiUrl: "http://127.0.0.1:4000/",
        body: envelope,
        contentType,
        requestId,
        requestIdForwardSecret: "",
        fetchRaw
      })
    ).rejects.toMatchObject({ statusCode: 500 })
    expect(fetchRaw).not.toHaveBeenCalled()
  })
})

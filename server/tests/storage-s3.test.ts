import { createHash } from "node:crypto"
import { describe, expect, it, vi } from "vitest"
import { createS3Storage, createSigner } from "../src/storage/s3"
import { StorageUnavailableError } from "../src/storage/types"

// Эталонные значения — примеры AWS «Signature Version 4: Authenticating Requests» для S3
// (ключи-образцы из документации, не секреты).
const exampleCredentials = {
  accessKeyId: "AKIAIOSFODNN7EXAMPLE",
  secretAccessKey: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
  region: "us-east-1"
}
const exampleDate = new Date("2013-05-24T00:00:00.000Z")
const emptyHash = createHash("sha256").update("").digest("hex")

const assetId = "0b7e4c1a-3f2d-4c8e-9a1b-2c3d4e5f6a7b"
const key = `2026/01/${assetId}.jpg`

describe("подпись SigV4", () => {
  it("совпадает с эталоном AWS для presigned GET", () => {
    const query = createSigner(exampleCredentials).presignedQuery({
      host: "examplebucket.s3.amazonaws.com",
      path: "/test.txt",
      now: exampleDate,
      expiresInSeconds: 86400
    })
    expect(query).toContain("X-Amz-Credential=AKIAIOSFODNN7EXAMPLE%2F20130524%2Fus-east-1%2Fs3%2Faws4_request")
    expect(query).toMatch(/X-Amz-Signature=aeeed9bbccd4d02ee5c0109b86d86835f995330da4c265957d157751f604d404$/)
  })

  it("совпадает с эталоном AWS для заголовка Authorization (GET с Range)", () => {
    const authorization = createSigner(exampleCredentials).authorization({
      method: "GET",
      host: "examplebucket.s3.amazonaws.com",
      path: "/test.txt",
      headers: { range: "bytes=0-9", "x-amz-content-sha256": emptyHash, "x-amz-date": "20130524T000000Z" },
      payloadHash: emptyHash,
      now: exampleDate
    })
    expect(authorization).toBe(
      "AWS4-HMAC-SHA256 Credential=AKIAIOSFODNN7EXAMPLE/20130524/us-east-1/s3/aws4_request, " +
        "SignedHeaders=host;range;x-amz-content-sha256;x-amz-date, " +
        "Signature=f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41"
    )
  })
})

function storageWith(fetchImpl: typeof fetch, forcePathStyle = false) {
  return createS3Storage({
    endpoint: "https://s3.provider.test",
    region: "ru-1",
    bucket: "altera-media",
    accessKeyId: "test-access",
    secretAccessKey: "test-secret",
    forcePathStyle,
    fetch: fetchImpl,
    now: () => exampleDate
  })
}

describe("S3-совместимое хранилище", () => {
  it("кладёт объект подписанным PUT по virtual-host адресу", async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 200 }))
    await storageWith(fetchMock as unknown as typeof fetch).put(key, Buffer.from("bytes"), {
      contentType: "image/jpeg"
    })

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe(`https://altera-media.s3.provider.test/${key}`)
    expect(init.method).toBe("PUT")
    const headers = init.headers as Record<string, string>
    expect(headers["content-type"]).toBe("image/jpeg")
    expect(headers["x-amz-content-sha256"]).toBe(createHash("sha256").update("bytes").digest("hex"))
    expect(headers.authorization).toMatch(
      /^AWS4-HMAC-SHA256 Credential=test-access\/20130524\/ru-1\/s3\/aws4_request, SignedHeaders=content-type;host;x-amz-content-sha256;x-amz-date, Signature=[0-9a-f]{64}$/
    )
  })

  it("path-style: бакет в пути, 404 на чтении — null и false, на удалении — не ошибка", async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 404 }))
    const storage = storageWith(fetchMock as unknown as typeof fetch, true)
    await expect(storage.get(key)).resolves.toBeNull()
    await expect(storage.exists(key)).resolves.toBe(false)
    await expect(storage.delete(key)).resolves.toBeUndefined()
    expect(fetchMock.mock.calls[0][0]).toBe(`https://s3.provider.test/altera-media/${key}`)
  })

  it("читает тело и тип объекта", async () => {
    const fetchMock = vi.fn(
      async () => new Response(Buffer.from("img"), { status: 200, headers: { "content-type": "image/jpeg" } })
    )
    const object = await storageWith(fetchMock as unknown as typeof fetch).get(key)
    expect(object?.contentType).toBe("image/jpeg")
    expect(object?.body.toString()).toBe("img")
  })

  it("сбой сети и 5xx — StorageUnavailableError без ключа и подписи в сообщении", async () => {
    const down = storageWith((async () => {
      throw new TypeError("fetch failed")
    }) as unknown as typeof fetch)
    await expect(down.put(key, Buffer.from("x"), { contentType: "image/jpeg" })).rejects.toBeInstanceOf(
      StorageUnavailableError
    )

    const failing = storageWith((async () => new Response(null, { status: 503 })) as unknown as typeof fetch)
    const error = await failing.get(key).catch((caught: unknown) => caught)
    expect(error).toBeInstanceOf(StorageUnavailableError)
    expect((error as Error).message).toBe("S3 GET answered 503")
    expect((error as Error).message).not.toContain(assetId)
  })

  it("выдаёт presigned GET с ограниченным сроком и не подписывает чужие ключи", () => {
    const storage = storageWith(vi.fn() as unknown as typeof fetch)
    const url = new URL(storage.signedGetUrl(key, { expiresInSeconds: 300 }))
    expect(url.origin).toBe("https://altera-media.s3.provider.test")
    expect(url.pathname).toBe(`/${key}`)
    expect(url.searchParams.get("X-Amz-Expires")).toBe("300")
    expect(url.searchParams.get("X-Amz-Signature")).toMatch(/^[0-9a-f]{64}$/)
    expect(() => storage.signedGetUrl("2026/01/photo.jpg", { expiresInSeconds: 300 })).toThrow("Invalid storage key")
    expect(() => storage.signedGetUrl(key, { expiresInSeconds: 604801 })).toThrow("expiresInSeconds")
  })
})

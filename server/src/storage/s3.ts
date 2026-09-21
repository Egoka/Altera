import { createHash, createHmac } from "node:crypto"
import { assertStorageKey, signedUrlExpiry, StorageUnavailableError, type ObjectStorage } from "./types"

// S3-совместимый провайдер без SDK: подпись AWS Signature Version 4 (заголовки для запросов,
// query-строка для ссылок). Провайдер не выбран (Q-01) — адаптер знает только S3 API.

export interface S3StorageOptions {
  endpoint: string
  region: string
  bucket: string
  accessKeyId: string
  secretAccessKey: string
  /** `https://endpoint/bucket/key` вместо `https://bucket.endpoint/key`. */
  forcePathStyle?: boolean
  fetch?: typeof fetch
  now?: () => Date
}

export interface SigningInput {
  method: string
  host: string
  path: string
  headers: Record<string, string>
  payloadHash: string
  now: Date
}

const ALGORITHM = "AWS4-HMAC-SHA256"
const UNSIGNED_PAYLOAD = "UNSIGNED-PAYLOAD"

const sha256Hex = (value: string | Buffer) => createHash("sha256").update(value).digest("hex")
const hmac = (key: string | Buffer, value: string) => createHmac("sha256", key).update(value).digest()

// RFC 3986: SigV4 кодирует всё, кроме A–Z, a–z, 0–9, `-._~`.
const encodeRfc3986 = (value: string) =>
  encodeURIComponent(value).replace(/[!'()*]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`)

export const encodeKeyPath = (key: string) => key.split("/").map(encodeRfc3986).join("/")

function amzDate(now: Date): { dateTime: string; date: string } {
  const dateTime = now
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}/, "")
  return { dateTime, date: dateTime.slice(0, 8) }
}

function signingKey(secret: string, date: string, region: string): Buffer {
  return hmac(hmac(hmac(hmac(`AWS4${secret}`, date), region), "s3"), "aws4_request")
}

function canonicalQuery(params: Record<string, string>): string {
  return Object.keys(params)
    .sort()
    .map((name) => `${encodeRfc3986(name)}=${encodeRfc3986(params[name])}`)
    .join("&")
}

export function createSigner(credentials: { accessKeyId: string; secretAccessKey: string; region: string }) {
  const scopeFor = (date: string) => `${date}/${credentials.region}/s3/aws4_request`
  const signature = (date: string, stringToSign: string) =>
    createHmac("sha256", signingKey(credentials.secretAccessKey, date, credentials.region))
      .update(stringToSign)
      .digest("hex")

  return {
    /** Заголовок `Authorization` для запроса; `headers` должны включать `x-amz-date` и `x-amz-content-sha256`. */
    authorization(input: SigningInput): string {
      const { dateTime, date } = amzDate(input.now)
      const headers: Record<string, string> = { host: input.host }
      for (const [name, value] of Object.entries(input.headers)) headers[name.toLowerCase()] = value.trim()
      const names = Object.keys(headers).sort()
      const signedHeaders = names.join(";")
      const canonicalRequest = [
        input.method,
        input.path,
        "",
        names.map((name) => `${name}:${headers[name]}\n`).join(""),
        signedHeaders,
        input.payloadHash
      ].join("\n")
      const stringToSign = [ALGORITHM, dateTime, scopeFor(date), sha256Hex(canonicalRequest)].join("\n")
      return `${ALGORITHM} Credential=${credentials.accessKeyId}/${scopeFor(date)}, SignedHeaders=${signedHeaders}, Signature=${signature(date, stringToSign)}`
    },

    /** Query-подпись ссылки GET (presigned URL). */
    presignedQuery(input: { host: string; path: string; now: Date; expiresInSeconds: number }): string {
      const { dateTime, date } = amzDate(input.now)
      const params: Record<string, string> = {
        "X-Amz-Algorithm": ALGORITHM,
        "X-Amz-Credential": `${credentials.accessKeyId}/${scopeFor(date)}`,
        "X-Amz-Date": dateTime,
        "X-Amz-Expires": String(input.expiresInSeconds),
        "X-Amz-SignedHeaders": "host"
      }
      const query = canonicalQuery(params)
      const canonicalRequest = ["GET", input.path, query, `host:${input.host}\n`, "host", UNSIGNED_PAYLOAD].join("\n")
      const stringToSign = [ALGORITHM, dateTime, scopeFor(date), sha256Hex(canonicalRequest)].join("\n")
      return `${query}&X-Amz-Signature=${signature(date, stringToSign)}`
    }
  }
}

export function createS3Storage(options: S3StorageOptions): ObjectStorage {
  const endpoint = new URL(options.endpoint)
  const host = options.forcePathStyle ? endpoint.host : `${options.bucket}.${endpoint.host}`
  const basePath = options.forcePathStyle ? `/${encodeRfc3986(options.bucket)}` : ""
  const doFetch = options.fetch ?? fetch
  const now = options.now ?? (() => new Date())
  const signer = createSigner(options)

  const pathFor = (key: string) => {
    assertStorageKey(key)
    return `${basePath}/${encodeKeyPath(key)}`
  }

  async function send(method: string, key: string, body?: Buffer, contentType?: string): Promise<Response> {
    const path = pathFor(key)
    const date = now()
    const payloadHash = sha256Hex(body ?? "")
    const headers: Record<string, string> = {
      "x-amz-content-sha256": payloadHash,
      "x-amz-date": amzDate(date).dateTime
    }
    if (contentType) headers["content-type"] = contentType
    const authorization = signer.authorization({ method, host, path, headers, payloadHash, now: date })
    try {
      return await doFetch(`${endpoint.protocol}//${host}${path}`, {
        method,
        headers: { ...headers, authorization },
        body: body ? new Uint8Array(body) : undefined
      })
    } catch (error) {
      throw new StorageUnavailableError(`S3 ${method} failed`, error)
    }
  }

  // Ошибка содержит только метод и статус: ключ и подпись в сообщение не попадают.
  const failed = (method: string, response: Response) =>
    new StorageUnavailableError(`S3 ${method} answered ${response.status}`)

  return {
    name: "s3",

    async put(key, body, { contentType }) {
      const response = await send("PUT", key, body, contentType)
      if (!response.ok) throw failed("PUT", response)
    },

    async get(key) {
      const response = await send("GET", key)
      if (response.status === 404) return null
      if (!response.ok) throw failed("GET", response)
      return {
        body: Buffer.from(await response.arrayBuffer()),
        contentType: response.headers.get("content-type") ?? "application/octet-stream"
      }
    },

    async exists(key) {
      const response = await send("HEAD", key)
      if (response.status === 404) return false
      if (!response.ok) throw failed("HEAD", response)
      return true
    },

    async delete(key) {
      const response = await send("DELETE", key)
      if (!response.ok && response.status !== 404) throw failed("DELETE", response)
    },

    signedGetUrl(key, urlOptions) {
      const path = pathFor(key)
      const { now: signedAt, expiresInSeconds } = signedUrlExpiry({ ...urlOptions, now: urlOptions.now ?? now() })
      const query = signer.presignedQuery({ host, path, now: signedAt, expiresInSeconds })
      return `${endpoint.protocol}//${host}${path}?${query}`
    }
  }
}

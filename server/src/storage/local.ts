import { createHmac, timingSafeEqual } from "node:crypto"
import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises"
import { dirname, join, resolve } from "node:path"
import { assertStorageKey, signedUrlExpiry, StorageUnavailableError, type ObjectStorage } from "./types"

export type SignatureCheck = "valid" | "invalid" | "expired"

export interface LocalStorage extends ObjectStorage {
  readonly name: "local"
  verifySignature(key: string, expires: string | null, signature: string | null, now?: Date): SignatureCheck
}

export interface LocalStorageOptions {
  /** Каталог с объектами; для разработки и CI, без ПДн (`storage-layout.md` п. 1). */
  root: string
  /** Префикс раздачи ключей этим сервером (`…/media`) — замена CDN-домена в разработке. */
  mediaBaseUrl: string
  signingSecret: string
}

const META_SUFFIX = ".meta.json"

function isMissing(error: unknown): boolean {
  return (error as NodeJS.ErrnoException | null)?.code === "ENOENT"
}

function unavailable(error: unknown): StorageUnavailableError {
  return new StorageUnavailableError("Local storage operation failed", error)
}

/** Файловая реализация хранилища и подпись ссылок HMAC-SHA256 для раздачи `/media/*`. */
export function createLocalStorage(options: LocalStorageOptions): LocalStorage {
  if (!options.signingSecret) throw new Error("Local storage requires a signing secret")
  const root = resolve(options.root)
  const baseUrl = options.mediaBaseUrl.replace(/\/+$/, "")

  const pathFor = (key: string) => {
    assertStorageKey(key)
    return join(root, key)
  }
  const sign = (key: string, expires: number) =>
    createHmac("sha256", options.signingSecret).update(`GET\n${key}\n${expires}`).digest("hex")

  return {
    name: "local",

    async put(key, body, { contentType }) {
      const path = pathFor(key)
      try {
        await mkdir(dirname(path), { recursive: true })
        await writeFile(path, body)
        await writeFile(`${path}${META_SUFFIX}`, JSON.stringify({ contentType }))
      } catch (error) {
        throw unavailable(error)
      }
    },

    async get(key) {
      const path = pathFor(key)
      try {
        const [body, meta] = await Promise.all([readFile(path), readFile(`${path}${META_SUFFIX}`, "utf8")])
        const { contentType } = JSON.parse(meta) as { contentType: string }
        return { body, contentType }
      } catch (error) {
        if (isMissing(error)) return null
        throw unavailable(error)
      }
    },

    async exists(key) {
      try {
        return (await stat(pathFor(key))).isFile()
      } catch (error) {
        if (isMissing(error)) return false
        throw unavailable(error)
      }
    },

    async delete(key) {
      const path = pathFor(key)
      try {
        await rm(path, { force: true })
        await rm(`${path}${META_SUFFIX}`, { force: true })
      } catch (error) {
        throw unavailable(error)
      }
    },

    signedGetUrl(key, urlOptions) {
      assertStorageKey(key)
      const { now, expiresInSeconds } = signedUrlExpiry(urlOptions)
      const expires = Math.floor(now.getTime() / 1000) + expiresInSeconds
      return `${baseUrl}/${key}?expires=${expires}&signature=${sign(key, expires)}`
    },

    verifySignature(key, expires, signature, now = new Date()) {
      if (!expires || !signature || !/^\d{1,12}$/.test(expires) || !/^[0-9a-f]{64}$/.test(signature)) return "invalid"
      const expected = Buffer.from(sign(key, Number(expires)), "hex")
      if (!timingSafeEqual(expected, Buffer.from(signature, "hex"))) return "invalid"
      return Number(expires) * 1000 <= now.getTime() ? "expired" : "valid"
    }
  }
}

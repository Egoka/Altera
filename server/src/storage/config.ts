import { randomBytes } from "node:crypto"
import { createLocalStorage, type LocalStorage } from "./local"
import { createS3Storage } from "./s3"
import { StorageUnavailableError, type ObjectStorage } from "./types"

export interface StorageConfig {
  storage: ObjectStorage
  /** Префикс публичных ссылок: CDN-домен провайдера или раздача `/media` этим сервером. */
  mediaBaseUrl: string
  /** Локальная реализация, если выбрана: сервер раздаёт её объекты сам (`gateway.ts`). */
  local: LocalStorage | null
}

type StorageEnv = Readonly<Record<string, string | undefined>>

/** Production без явного STORAGE_DRIVER: операции падают как недоступный провайдер, а не пишут на диск. */
export function createUnconfiguredStorage(): ObjectStorage {
  const fail = (): never => {
    throw new StorageUnavailableError("STORAGE_DRIVER is not configured")
  }
  return {
    name: "unconfigured",
    put: async () => fail(),
    get: async () => fail(),
    exists: async () => fail(),
    delete: async () => fail(),
    signedGetUrl: fail
  }
}

function required(env: StorageEnv, name: string): string {
  const value = env[name]
  if (!value) throw new Error(`${name} is required for STORAGE_DRIVER=s3`)
  return value
}

function createLocalFromEnv(env: StorageEnv): StorageConfig {
  const mediaBaseUrl = env.STORAGE_MEDIA_BASE_URL || `http://localhost:${env.PORT || 4000}/media`
  // Без секрета ссылки живут до перезапуска процесса — для разработки и CI этого достаточно.
  const signingSecret = env.STORAGE_SIGNING_SECRET || randomBytes(32).toString("hex")
  const local = createLocalStorage({ root: env.STORAGE_LOCAL_DIR || ".storage", mediaBaseUrl, signingSecret })
  return { storage: local, mediaBaseUrl, local }
}

function createS3FromEnv(env: StorageEnv): StorageConfig {
  const storage = createS3Storage({
    endpoint: required(env, "S3_ENDPOINT"),
    region: required(env, "S3_REGION"),
    bucket: required(env, "S3_BUCKET"),
    accessKeyId: required(env, "S3_ACCESS_KEY_ID"),
    secretAccessKey: required(env, "S3_SECRET_ACCESS_KEY"),
    forcePathStyle: env.S3_FORCE_PATH_STYLE === "true"
  })
  return { storage, mediaBaseUrl: required(env, "STORAGE_MEDIA_BASE_URL"), local: null }
}

export function createStorageConfigFromEnv(env: StorageEnv): StorageConfig {
  const production = env.NODE_ENV === "production"
  switch (env.STORAGE_DRIVER) {
    case undefined:
    case "":
      if (production)
        return { storage: createUnconfiguredStorage(), mediaBaseUrl: env.STORAGE_MEDIA_BASE_URL || "", local: null }
      return createLocalFromEnv(env)
    case "local":
      if (production) throw new Error("STORAGE_DRIVER=local is not allowed in production")
      return createLocalFromEnv(env)
    case "s3":
      return createS3FromEnv(env)
    default:
      throw new Error("Unknown STORAGE_DRIVER")
  }
}

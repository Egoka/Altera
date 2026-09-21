import { createApiError } from "../errors/graphql-error"
import { isStorageKey } from "./keys"

export interface StoredObject {
  body: Buffer
  contentType: string
}

export interface SignedUrlOptions {
  /** Срок ссылки задаёт вызывающий: журнал чисел не фиксирует (`access-and-signed-urls.md` п. 2). */
  expiresInSeconds: number
  now?: Date
}

/**
 * Объектное хранилище медиа (ADR-0008). Реализации не пишут в логи ключи с подписью и тела
 * объектов; сбой провайдера — `StorageUnavailableError`.
 */
export interface ObjectStorage {
  readonly name: string
  put(key: string, body: Buffer, options: { contentType: string }): Promise<void>
  get(key: string): Promise<StoredObject | null>
  exists(key: string): Promise<boolean>
  delete(key: string): Promise<void>
  /** Ссылка на закрытый объект; права проверяет вызывающий до выдачи (`access-and-signed-urls.md` п. 2). */
  signedGetUrl(key: string, options: SignedUrlOptions): string
}

/** Технический предел срока подписи SigV4 — 7 суток; тот же предел держит локальная реализация. */
export const MAX_SIGNED_URL_SECONDS = 7 * 24 * 60 * 60

export class StorageUnavailableError extends Error {
  override name = "StorageUnavailableError"
  readonly cause: unknown

  constructor(message: string, cause?: unknown) {
    super(message)
    this.cause = cause
  }
}

export function assertStorageKey(key: string): void {
  if (!isStorageKey(key)) throw new Error("Invalid storage key")
}

export function signedUrlExpiry(options: SignedUrlOptions): { now: Date; expiresInSeconds: number } {
  const { expiresInSeconds } = options
  if (!Number.isInteger(expiresInSeconds) || expiresInSeconds < 1 || expiresInSeconds > MAX_SIGNED_URL_SECONDS) {
    throw new Error("expiresInSeconds must be an integer between 1 and 604800")
  }
  return { now: options.now ?? new Date(), expiresInSeconds }
}

/** Сбой хранилища в ответе API — `PROVIDER_UNAVAILABLE: storage` (журнал §29.3). */
export function storageUnavailableError(requestId: string) {
  return createApiError("PROVIDER_UNAVAILABLE", { requestId, provider: "storage" })
}

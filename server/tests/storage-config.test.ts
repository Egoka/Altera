import { describe, expect, it } from "vitest"
import { readSystemSettings } from "../src/admin/settings"
import { createStorageConfigFromEnv } from "../src/storage/config"
import { StorageUnavailableError } from "../src/storage/types"

const key = "2026/01/0b7e4c1a-3f2d-4c8e-9a1b-2c3d4e5f6a7b.jpg"
const s3Env = {
  STORAGE_DRIVER: "s3",
  S3_ENDPOINT: "https://s3.provider.test",
  S3_REGION: "ru-1",
  S3_BUCKET: "altera-media",
  S3_ACCESS_KEY_ID: "id",
  S3_SECRET_ACCESS_KEY: "s3-secret-value",
  STORAGE_MEDIA_BASE_URL: "https://cdn.altera.test"
}

describe("выбор реализации хранилища", () => {
  it("вне production без STORAGE_DRIVER выбирает local и раздачу /media этим сервером", () => {
    const config = createStorageConfigFromEnv({ NODE_ENV: "development", PORT: "24000" })
    expect(config.storage.name).toBe("local")
    expect(config.local).toBe(config.storage)
    expect(config.mediaBaseUrl).toBe("http://localhost:24000/media")
  })

  it("в production не пишет на диск неявно: операции падают как недоступный провайдер", async () => {
    const config = createStorageConfigFromEnv({ NODE_ENV: "production" })
    expect(config.storage.name).toBe("unconfigured")
    expect(config.local).toBeNull()
    await expect(config.storage.get(key)).rejects.toBeInstanceOf(StorageUnavailableError)
    expect(() => config.storage.signedGetUrl(key, { expiresInSeconds: 60 })).toThrow(StorageUnavailableError)
  })

  it("запрещает local в production и неизвестный драйвер", () => {
    expect(() => createStorageConfigFromEnv({ NODE_ENV: "production", STORAGE_DRIVER: "local" })).toThrow(
      "STORAGE_DRIVER=local is not allowed in production"
    )
    expect(() => createStorageConfigFromEnv({ STORAGE_DRIVER: "disk" })).toThrow("Unknown STORAGE_DRIVER")
  })

  it("s3 требует всех параметров и CDN-префикса", () => {
    const config = createStorageConfigFromEnv({ NODE_ENV: "production", ...s3Env })
    expect(config.storage.name).toBe("s3")
    expect(config.mediaBaseUrl).toBe("https://cdn.altera.test")
    expect(() => createStorageConfigFromEnv({ ...s3Env, S3_BUCKET: "" })).toThrow("S3_BUCKET is required")
    expect(() => createStorageConfigFromEnv({ ...s3Env, STORAGE_MEDIA_BASE_URL: undefined })).toThrow(
      "STORAGE_MEDIA_BASE_URL is required"
    )
  })

  it("системные настройки показывают активный адаптер и маскируют ключи S3", () => {
    const settings = readSystemSettings("storage", { NODE_ENV: "production", ...s3Env })
    expect(settings.adapter).toBe("s3")
    const secret = settings.settings.find((setting) => setting.key === "S3_SECRET_ACCESS_KEY")
    expect(secret).toMatchObject({ secret: true, configured: true, value: null })
    expect(JSON.stringify(settings)).not.toContain("s3-secret-value")
    expect(readSystemSettings("storage", { NODE_ENV: "production" }).adapter).toBe("unconfigured")
  })
})

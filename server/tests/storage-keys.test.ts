import { describe, expect, it } from "vitest"
import { exportKey, masterKey, parseStorageKey, variantKey } from "../src/storage/keys"

const assetId = "0b7e4c1a-3f2d-4c8e-9a1b-2c3d4e5f6a7b"
const userId = "5d6e7f80-1a2b-4c3d-8e9f-a0b1c2d3e4f5"
const createdAt = new Date("2026-01-31T23:30:00.000Z")

describe("раскладка ключей хранилища", () => {
  it("мастер — {yyyy}/{mm}/{id}.{ext} по дате создания в UTC", () => {
    expect(masterKey({ assetId, createdAt, extension: "jpg" })).toBe(`2026/01/${assetId}.jpg`)
  })

  it("вариант — {yyyy}/{mm}/{id}/w{width}.{format}", () => {
    expect(variantKey({ assetId, createdAt, width: 640, format: "avif" })).toBe(`2026/01/${assetId}/w640.avif`)
  })

  it("выгрузка — exports/{userId}/{exportId}.zip", () => {
    expect(exportKey({ userId, exportId: assetId, extension: "zip" })).toBe(`exports/${userId}/${assetId}.zip`)
  })

  it("не принимает в ключ имя файла пользователя и неизвестные расширения", () => {
    expect(() => masterKey({ assetId: "Отпуск на море", createdAt, extension: "jpg" })).toThrow("assetId")
    expect(() => masterKey({ assetId: "../etc/passwd", createdAt, extension: "jpg" })).toThrow("assetId")
    expect(() => masterKey({ assetId, createdAt, extension: "exe" as never })).toThrow("Unsupported")
    expect(() => variantKey({ assetId, createdAt, width: 0, format: "webp" })).toThrow("width")
    expect(() => variantKey({ assetId, createdAt, width: 640, format: "jpg" as never })).toThrow("Unsupported")
  })

  it("разбирает ключи обратно и отклоняет всё вне раскладки", () => {
    expect(parseStorageKey(`2026/01/${assetId}.png`)).toEqual({ kind: "master", assetId, extension: "png" })
    expect(parseStorageKey(`2026/01/${assetId}/w1280.webp`)).toEqual({
      kind: "variant",
      assetId,
      width: 1280,
      format: "webp"
    })
    expect(parseStorageKey(`exports/${userId}/${assetId}.zip`)).toEqual({
      kind: "export",
      userId,
      exportId: assetId,
      extension: "zip"
    })
    for (const bad of [
      `2026/13/${assetId}.png`,
      `2026/01/${assetId}.png/../x`,
      `../2026/01/${assetId}.png`,
      `2026/01/${assetId}/w0640.webp`,
      `2026/01/${assetId}/w640.png`,
      `2026/01/photo.png`,
      `2026/01/${assetId.toUpperCase()}.png`,
      ""
    ]) {
      expect(parseStorageKey(bad), bad).toBeNull()
    }
  })
})

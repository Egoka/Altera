import { describe, expect, it } from "vitest"
import {
  fallbackVariant,
  pictureSources,
  readMediaVariants,
  thumbnailVariant,
  variantSrcset
} from "../app/utils/mediaVariants"

// T-064: веб строит `<picture>` из вариантов, сделанных при загрузке (ADR-0030 п. 2).

const base = "https://cdn.altera.test/2026/09/8f1d2b0c-0000-4000-8000-000000000001"

const set = {
  version: 1,
  placeholder: "data:image/webp;base64,UExBQ0VIT0xERVI=",
  thumbnailWidth: 480,
  items: [
    { format: "webp", width: 960, height: 640, url: `${base}/w960.webp` },
    { format: "avif", width: 480, height: 320, url: `${base}/w480.avif` },
    { format: "webp", width: 480, height: 320, url: `${base}/w480.webp` },
    { format: "avif", width: 960, height: 640, url: `${base}/w960.avif` }
  ]
}

describe("варианты изображения", () => {
  it("читает набор и упорядочивает варианты по ширине", () => {
    const parsed = readMediaVariants(set)

    expect(parsed.placeholder).toBe(set.placeholder)
    expect(parsed.thumbnailWidth).toBe(480)
    expect(parsed.variants.map((variant) => `${variant.format}:${variant.width}`)).toEqual([
      "avif:480",
      "webp:480",
      "webp:960",
      "avif:960"
    ])
  })

  it("пустое и незнакомое значение читаются как «вариантов нет»", () => {
    // Значение колонки по умолчанию — `[]`: обработка ещё не дошла до вариантов.
    expect(readMediaVariants([]).variants).toEqual([])
    expect(readMediaVariants(null).variants).toEqual([])
    expect(readMediaVariants({ items: "нет" }).variants).toEqual([])
    expect(readMediaVariants({ items: [{ format: "gif", width: 480, height: 320, url: "/g.gif" }] }).variants).toEqual(
      []
    )
    expect(readMediaVariants({ items: [{ format: "webp", width: 0, height: 0, url: "" }] }).variants).toEqual([])
  })

  it("собирает srcset каждого формата по возрастанию ширины", () => {
    const parsed = readMediaVariants(set)

    expect(variantSrcset(parsed, "avif")).toBe(`${base}/w480.avif 480w, ${base}/w960.avif 960w`)
    expect(variantSrcset(parsed, "webp")).toBe(`${base}/w480.webp 480w, ${base}/w960.webp 960w`)
  })

  it("источники идут AVIF, затем WebP запасным", () => {
    const picture = pictureSources(set)

    expect(picture.sources.map((source) => source.type)).toEqual(["image/avif", "image/webp"])
    expect(picture.fallback?.url).toBe(`${base}/w960.webp`)
    expect(picture.placeholder).toBe(set.placeholder)
  })

  it("формат без вариантов источником не становится", () => {
    const onlyWebp = pictureSources({ ...set, items: set.items.filter((item) => item.format === "webp") })

    expect(onlyWebp.sources.map((source) => source.type)).toEqual(["image/webp"])
    expect(onlyWebp.fallback?.width).toBe(960)
  })

  it("без вариантов показывать нечего", () => {
    const empty = pictureSources({ version: 1, placeholder: null, thumbnailWidth: null, items: [] })

    expect(empty.sources).toEqual([])
    expect(empty.fallback).toBeNull()
    expect(empty.fallbackSrcset).toBe("")
  })

  it("запасной вариант — самый широкий WebP, а без WebP — самый широкий из оставшихся", () => {
    const parsed = readMediaVariants(set)
    expect(fallbackVariant(parsed)?.url).toBe(`${base}/w960.webp`)

    const avifOnly = readMediaVariants({ ...set, items: set.items.filter((item) => item.format === "avif") })
    expect(fallbackVariant(avifOnly)?.url).toBe(`${base}/w960.avif`)
  })

  it("thumbnail берётся по ширине из набора, а без неё — самый узкий", () => {
    expect(thumbnailVariant(readMediaVariants(set))?.width).toBe(480)
    expect(thumbnailVariant(readMediaVariants({ ...set, thumbnailWidth: null }))?.width).toBe(480)
    expect(thumbnailVariant(readMediaVariants(set), "avif")?.url).toBe(`${base}/w480.avif`)
  })

  it("ни один адрес варианта не ведёт в /_ipx/", () => {
    // ADR-0030 п. 1: обработки на лету нет, адреса приходят из хранилища как есть.
    const picture = pictureSources(set)
    const urls = [...picture.sources.map((source) => source.srcset), picture.fallback?.url ?? ""]

    expect(urls.some((url) => url.includes("/_ipx/"))).toBe(false)
  })
})

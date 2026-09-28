// @vitest-environment happy-dom

import { mount } from "@vue/test-utils"
import { describe, expect, it } from "vitest"
import MediaPicture from "../app/components/media/Picture.vue"

// T-064: компонент вывода пользовательских изображений. `<picture>` с AVIF и WebP, `srcset`,
// `sizes` от места использования и единый `alt` медиафайла; `/_ipx/` в разметке не появляется.

const base = "https://cdn.altera.test/2026/09/8f1d2b0c-0000-4000-8000-000000000001"

const variants = {
  version: 1,
  placeholder: "data:image/webp;base64,UExBQ0VIT0xERVI=",
  thumbnailWidth: 480,
  items: [
    { format: "avif", width: 480, height: 320, url: `${base}/w480.avif` },
    { format: "avif", width: 960, height: 640, url: `${base}/w960.avif` },
    { format: "webp", width: 480, height: 320, url: `${base}/w480.webp` },
    { format: "webp", width: 960, height: 640, url: `${base}/w960.webp` }
  ]
}

const alt = "Порт на рассвете, у причала стоит рыболовное судно"

describe("MediaPicture", () => {
  it("строит picture с источником AVIF и запасным WebP", () => {
    const wrapper = mount(MediaPicture, { props: { variants, alt, sizes: "(min-width: 1024px) 50vw, 100vw" } })

    const sources = wrapper.findAll("source")
    expect(sources).toHaveLength(2)
    expect(sources[0]!.attributes("type")).toBe("image/avif")
    expect(sources[0]!.attributes("srcset")).toBe(`${base}/w480.avif 480w, ${base}/w960.avif 960w`)
    expect(sources[1]!.attributes("type")).toBe("image/webp")
    expect(sources.every((source) => source.attributes("sizes") === "(min-width: 1024px) 50vw, 100vw")).toBe(true)
  })

  it("у img есть запасной адрес, srcset, размеры и единый alt", () => {
    const wrapper = mount(MediaPicture, { props: { variants, alt } })
    const img = wrapper.get("img")

    expect(img.attributes("src")).toBe(`${base}/w960.webp`)
    expect(img.attributes("srcset")).toBe(`${base}/w480.webp 480w, ${base}/w960.webp 960w`)
    expect(img.attributes("alt")).toBe(alt)
    // Размеры резервируют место до загрузки: иначе страница прыгает.
    expect(img.attributes("width")).toBe("960")
    expect(img.attributes("height")).toBe("640")
    expect(img.attributes("decoding")).toBe("async")
    expect(img.attributes("loading")).toBe("lazy")
  })

  it("показывает размытый заполнитель фоном до загрузки варианта", () => {
    const wrapper = mount(MediaPicture, { props: { variants, alt } })

    expect(wrapper.get("img").attributes("style")).toContain(variants.placeholder)
  })

  it("декоративное изображение остаётся с пустым alt", () => {
    const wrapper = mount(MediaPicture, { props: { variants, alt: "" } })

    expect(wrapper.get("img").attributes("alt")).toBe("")
  })

  it("обложка первого экрана грузится сразу", () => {
    const wrapper = mount(MediaPicture, { props: { variants, alt, loading: "eager", fetchpriority: "high" } })

    expect(wrapper.get("img").attributes("loading")).toBe("eager")
    expect(wrapper.get("img").attributes("fetchpriority")).toBe("high")
  })

  it("без вариантов ничего не выводится", () => {
    // Обработка не дошла до вариантов: место использования показывает своё запасное состояние.
    const wrapper = mount(MediaPicture, { props: { variants: [], alt } })

    expect(wrapper.find("picture").exists()).toBe(false)
    expect(wrapper.find("img").exists()).toBe(false)
  })

  it("в разметке нет обращений к /_ipx/", () => {
    const wrapper = mount(MediaPicture, { props: { variants, alt } })

    expect(wrapper.html()).not.toContain("/_ipx/")
    expect(wrapper.html()).not.toContain("nuxt-img")
  })
})

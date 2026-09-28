import { describe, expect, it } from "vitest"
import config from "../nuxt.config"

/**
 * ADR-0030: изображения не обрабатываются на лету. С провайдером по умолчанию (`ipx`) `NuxtImg`
 * переписывал локальный `src` в `/_ipx/...`, а этот маршрут отвечал 500: `sharp` 0.32 без
 * платформенного бинарника не загружается. Варианты и `srcset` пользовательских изображений
 * строит `MediaPicture` из набора, сделанного при загрузке (T-064).
 */
describe("провайдер изображений", () => {
  it("отдаёт src как есть и не подключает IPX", () => {
    expect(config.image).toEqual({ provider: "none" })
  })
})

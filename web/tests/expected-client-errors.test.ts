import type { H3Error } from "h3"
import type { NitroConfig } from "nitropack/types"
import { describe, expect, it } from "vitest"
import config from "../nuxt.config"
import expectedClientErrors from "../server/error"

const createError = (fields: Partial<H3Error>) => Object.assign(new Error(fields.statusMessage), fields) as H3Error

const handle = (error: H3Error) => expectedClientErrors(error, {} as never, { defaultHandler: () => ({}) as never })

/**
 * Страницы ставят `fatal: true` на 404 ради клиентского перехода, а Nitro печатал такой ответ
 * как сбой сервера: `[request error] [fatal]` со стеком в каждом прогоне браузерных тестов.
 */
describe("ожидаемые ответы 4xx не журналируются как сбой сервера", () => {
  it("снимает fatal с 4xx и не трогает 5xx", async () => {
    const notFound = createError({ statusCode: 404, statusMessage: "NOT_FOUND", fatal: true })
    const forbidden = createError({ statusCode: 403, fatal: true })
    const failure = createError({ statusCode: 500, statusMessage: "INTERNAL_ERROR", fatal: true })

    for (const error of [notFound, forbidden, failure]) await handle(error)

    expect(notFound.fatal).toBe(false)
    expect(forbidden.fatal).toBe(false)
    expect(failure.fatal).toBe(true)
  })

  it("стоит в цепочке Nitro перед обработчиком Nuxt, а не вместо него", async () => {
    const nitroConfig: NitroConfig = { errorHandler: "/nuxt/core/runtime/nitro/handlers/error" }

    await config.hooks?.["nitro:config"]?.(nitroConfig)

    expect(nitroConfig.errorHandler).toEqual([
      expect.stringMatching(/\/web\/server\/error$/),
      "/nuxt/core/runtime/nitro/handlers/error"
    ])
  })
})

import { expect, test } from "./helpers/test"

/**
 * Критерий 2 задачи T-064: в прод-сборке нет запросов к `/_ipx/`.
 *
 * Оптимизатор изображений на лету отключён (`nuxt.config.ts`, `image: { provider: "none" }`):
 * варианты делаются при загрузке в API (ADR-0030 п. 1–2). Проверка идёт по фактическим запросам
 * собранного сервера, а не по конфигурации: `NuxtImg` переписывал бы `src` в `/_ipx/...` молча,
 * а этот маршрут отвечал 500 (`docs/vision/00-reality-check.md` §5.6).
 *
 * Playwright в этом проекте поднимает именно прод-сборку (`playwright.config.ts`, webServer
 * «Nitro»: `pnpm run build && node .output/server/index.mjs`).
 */
const PAGES = ["/", "/sections", "/pricing", "/about", "/en"]

test("прод-сборка не обращается к /_ipx/ и не отдаёт такие адреса в разметке", async ({ page }) => {
  const ipxRequests: string[] = []
  page.on("request", (request) => {
    if (request.url().includes("/_ipx/")) ipxRequests.push(request.url())
  })

  for (const path of PAGES) {
    const response = await page.goto(path)
    expect(response?.status(), `страница ${path}`).toBeLessThan(400)
    // Разметка не должна содержать адрес даже в `srcset` картинки, которую браузер не выбрал.
    expect(await page.content(), `разметка ${path}`).not.toContain("/_ipx/")
  }

  expect(ipxRequests).toEqual([])
})

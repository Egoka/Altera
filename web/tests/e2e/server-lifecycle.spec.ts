import { connect } from "node:net"
import { expect, test } from "@playwright/test"

test("built test server keeps serving after clients close their response pipes", async ({ page, request, baseURL }) => {
  await page.goto("/", { waitUntil: "networkidle" })
  // Приёмочные браузерные проверки запускают собранный сервер, без dev/HMR-прокси.
  await expect(page.locator('script[src*="@vite/client"]')).toHaveCount(0)
  const target = new URL(baseURL!)

  await Promise.all(
    Array.from(
      { length: 4 },
      () =>
        new Promise<void>((resolve, reject) => {
          const socket = connect({ port: Number(target.port), host: target.hostname })
          let receivedResponse = false
          socket.once("error", reject)
          socket.once("close", () =>
            receivedResponse ? resolve() : reject(new Error("server closed before responding"))
          )
          socket.setTimeout(5000, () => socket.destroy(new Error("server did not respond")))
          socket.once("connect", () => {
            socket.write(`GET / HTTP/1.1\r\nHost: ${target.host}\r\nConnection: close\r\n\r\n`)
          })
          socket.once("data", () => {
            receivedResponse = true
            // Закрывается настоящий TCP pipe во время ответа, а не mock транспорта.
            socket.resetAndDestroy()
          })
        })
    )
  )

  const response = await request.get("/en")
  expect(response.status()).toBe(200)
  expect(await response.text()).toContain('aria-label="Switch language to Русский"')
  await expect(page).toHaveTitle(/Altera/)
})

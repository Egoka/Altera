import { expect, test } from "@playwright/test"

test("serves Russian at root, English under /en, and redirects /ru permanently", async ({ page, request }) => {
  const rootResponse = await request.get("/", { maxRedirects: 0 })
  const englishResponse = await request.get("/en", { maxRedirects: 0 })
  const redirectResponse = await request.get("/ru", { maxRedirects: 0 })

  expect(rootResponse.status()).toBe(200)
  expect(englishResponse.status()).toBe(200)
  expect(redirectResponse.status()).toBe(301)
  expect(redirectResponse.headers().location).toBe("/")

  await page.goto("/")
  await expect(page.getByRole("link", { name: "Switch language to English" })).toHaveAttribute("href", "/en")

  await page.goto("/en")
  await expect(page.getByRole("link", { name: "Switch language to Русский" })).toHaveAttribute("href", "/")
})

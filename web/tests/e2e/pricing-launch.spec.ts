import { expect, test } from "@playwright/test"

// Критерий T-060: на собранной странице «Цены и планы» первого запуска нет числовых цен
// и кнопок оплаты, и она ведёт в создание материала (`docs/spec/20-public/pricing.md`, журнал §24.1).

// Цена в тексте — это число рядом со знаком валюты или названием периода.
const PRICE_PATTERNS = [
  /\d[\d\s.,]*\s*(?:₽|руб|р\.|\$|€|RUB|USD|EUR)/i,
  /(?:₽|\$|€)\s*\d/,
  /\d+\s*(?:₽|руб)[^\p{L}]*(?:мес|год|month|year)/iu
]

const PAYMENT_ACTION = /оформить|купить|оплат|checkout|pay now|subscribe now|продлить/i

test("страница планов не показывает ни цен, ни кнопок оплаты", async ({ page }) => {
  await page.goto("/pricing")

  await expect(page.getByRole("heading", { level: 1 })).toBeVisible()

  const body = (await page.locator("body").innerText()).trim()

  for (const pattern of PRICE_PATTERNS) {
    expect(body).not.toMatch(pattern)
  }

  // Кнопок на странице запуска нет вовсе — ни одной, кроме служебных элементов шапки.
  const actions = page.locator("main button, main a").filter({ hasText: PAYMENT_ACTION })
  await expect(actions).toHaveCount(0)
})

test("страница показывает три плана и метки доступности", async ({ page }) => {
  await page.goto("/pricing")

  await expect(page.locator("[data-plan]")).toHaveCount(3)
  await expect(page.locator("[data-plan='free'][data-availability='now']")).toHaveCount(1)
  await expect(page.locator("[data-plan='standard'][data-availability='later']")).toHaveCount(1)
  await expect(page.locator("[data-plan='pro'][data-availability='later']")).toHaveCount(1)
})

test("главное действие ведёт в создание материала", async ({ page }) => {
  await page.goto("/pricing")

  await expect(page.locator("a[href='/me/articles/new']").first()).toBeVisible()
})

test("ссылка с промокодом закрыта от индексации, обычная — открыта", async ({ page }) => {
  await page.goto("/pricing?promo=launch")
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", /noindex/)

  await page.goto("/pricing")
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", /^index/)
})

test("канонический адрес не содержит query", async ({ page }) => {
  await page.goto("/pricing?plan=pro&promo=launch")

  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute("href", /\/pricing$/)
})

test("старые адреса подписки ведут на страницу планов", async ({ page }) => {
  await page.goto("/plans")
  await expect(page).toHaveURL(/\/pricing$/)

  await page.goto("/subscribe")
  await expect(page).toHaveURL(/\/pricing$/)
})

test("английская версия страницы открывается по своему адресу", async ({ page }) => {
  await page.goto("/en/pricing")

  await expect(page.locator("[data-plan]")).toHaveCount(3)
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute("href", /\/en\/pricing$/)
})

import { test as base } from "@playwright/test"
import { PrismaClient } from "../../../../server/src/generated/prisma/index.js"
import { waitForHydration } from "./hydration"

export * from "@playwright/test"

const databaseUrl = process.env.T069_TEST_DATABASE_URL ?? "postgresql://test:test@127.0.0.1:5432/test"

interface WorkerFixtures {
  database: PrismaClient
}

interface TestFixtures {
  freshRateLimits: void
}

/**
 * `test` браузерных сценариев Altera. Спеки импортируют `test` и `expect` отсюда; прямой импорт
 * `@playwright/test` запрещён линтером.
 *
 * `page.goto` и `page.reload` возвращаются после гидратации Nuxt, а не по событию `load`. Иначе
 * следующий за переходом клик срабатывает на серверной разметке — кнопка молчит, ссылка уходит
 * в SSR мимо моков, — и тест падает от скорости машины. `waitUntil: "commit"` оставлен без
 * ожидания: так тест нарочно смотрит на ответ до загрузки.
 *
 * Перед каждым тестом очищаются счётчики лимитов частоты (`rate_limit_counters`). Все сценарии
 * ходят с одного адреса 127.0.0.1, и корзины по адресу (`auth.verify.ip` — 10 подтверждений в
 * час) иначе копятся через весь прогон: очередной вход по ссылке в новом файле ронял бы чужие
 * тесты в зависимости от порядка. Строки «Ограничение» проверяются подстановкой ответа, а не
 * исчерпанием настоящей корзины, поэтому очистка посреди соседнего теста его не ломает. Счётчики
 * в Redis не очищаются: браузерная проверка работает на счётчиках PostgreSQL.
 */
export const test = base.extend<TestFixtures, WorkerFixtures>({
  database: [
    // Playwright требует деструктуризацию первого аргумента фикстуры, даже пустую.
    async ({}, use) => {
      const prisma = new PrismaClient({ datasourceUrl: databaseUrl })
      await use(prisma)
      await prisma.$disconnect()
    },
    { scope: "worker" }
  ],

  freshRateLimits: [
    async ({ database }, use) => {
      await database.rateLimitCounter.deleteMany()
      await use()
    },
    { auto: true }
  ],

  page: async ({ page }, use) => {
    const goto = page.goto.bind(page)
    const reload = page.reload.bind(page)

    page.goto = async (url, options) => {
      const response = await goto(url, options)
      if (options?.waitUntil !== "commit") await waitForHydration(page)
      return response
    }
    page.reload = async (options) => {
      const response = await reload(options)
      if (options?.waitUntil !== "commit") await waitForHydration(page)
      return response
    }

    await use(page)
  }
})

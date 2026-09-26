import type { Page } from "@playwright/test"

interface NuxtRoot {
  __vue_app__?: {
    config: {
      globalProperties: {
        $nuxt?: { isHydrating?: boolean }
        $router?: { push: (to: string) => Promise<unknown> }
      }
    }
  }
}

/**
 * Ждёт конца гидратации Nuxt. До него страница ещё серверная: клик по кнопке ничего не делает,
 * клик по ссылке — полная загрузка, запросы которой идут через SSR мимо моков `page.route`, а
 * клиентский переход отменяется начальной навигацией роутера (`router.replace` на адрес,
 * отрисованный сервером). Признак — `isHydrating === false`: Nuxt снимает его на
 * `app:suspense:resolve`, после монтирования. Документ без корня Nuxt (XML, JSON, текст
 * ответа API) ждать нечего.
 */
export const waitForHydration = async (page: Page) => {
  await page.waitForFunction(() => {
    const root = document.querySelector("#__nuxt") as NuxtRoot | null
    if (!root) return document.readyState === "complete"
    return root.__vue_app__?.config.globalProperties.$nuxt?.isHydrating === false
  })
}

/**
 * Клиентский переход роутером приложения: моки `page.route` ловят только браузерные запросы,
 * поэтому полная загрузка не подходит. Переход выполняется после гидратации один раз: отменить
 * его больше некому, поэтому повторять его, пока адрес не «закрепится», не нужно.
 *
 * Возвращается, когда роутер завершил переход. Адрес здесь не проверяется, а отказ `push` не
 * считается ошибкой: если middleware страницы падает (сценарии «Ошибка данных»), Nuxt
 * показывает страницу ошибки, оставляя прежний адрес, — такие тесты проверяют её саму.
 */
export const navigateOnClient = async (page: Page, path: string) => {
  await waitForHydration(page)
  await page.evaluate(async (target) => {
    const root = document.querySelector("#__nuxt") as NuxtRoot | null
    const router = root?.__vue_app__?.config.globalProperties.$router
    if (!router) throw new Error("Nuxt router is not mounted")
    await router.push(target).catch(() => undefined)
  }, path)
}

import type { NitroErrorHandler } from "nitropack/types"

/**
 * Первый обработчик ошибок Nitro, до обработчика Nuxt (хук `nitro:config` в `nuxt.config.ts`).
 *
 * Nuxt и Nitro понимают `fatal` по-разному. Страницы ставят `fatal: true` на 404, чтобы клиентский
 * переход показал страницу ошибки: без флага читатель остаётся на прежней странице. Nitro считает
 * такую ошибку сбоем сервера: печатает `[request error] [fatal]` со стеком и заменяет сообщение на
 * «Server Error». Ответ 4xx — ожидаемый итог запроса, поэтому флаг здесь снимается. Страница ошибки
 * рисуется как прежде, а 5xx и необработанные исключения по-прежнему попадают в журнал.
 */
const expectedClientErrors: NitroErrorHandler = (error) => {
  if (error.statusCode < 500) error.fatal = false
}

export default expectedClientErrors

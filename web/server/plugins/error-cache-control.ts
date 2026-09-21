/**
 * Ответ 500 не должен осесть ни в CDN, ни в браузере (`docs/spec/20-public/error.md` §10,
 * ADR-0019): иначе читатель будет получать сохранённую ошибку и после починки.
 *
 * Страница ошибки рендерится отдельным внутренним запросом `/__nuxt_error`, и его заголовки
 * переносятся на настоящий ответ. Поэтому `no-store` ставится здесь: `setup` страницы для
 * этого не годится — обработчик ошибок Nitro пишет `Cache-Control: no-cache` позже.
 */
export default defineNitroPlugin((nitroApp) => {
  nitroApp.hooks.hook("render:response", (response, { event }) => {
    const requested = Number(getQuery(event).statusCode)
    const status = Number.isFinite(requested) && requested > 0 ? requested : (response.statusCode ?? 200)
    if (status < 500) return

    response.headers = { ...response.headers, "cache-control": "no-store" }
  })
})

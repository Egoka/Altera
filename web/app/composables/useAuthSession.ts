import { deleteCookie, setCookie } from "h3"
import { SESSION_ACCESS_COOKIE, SESSION_COOKIE_PATH, SESSION_REFRESH_COOKIE } from "#shared/session"

// Access живёт 15 минут, refresh — 30 дней без активности (session-lifecycle.md п. 5).
// Здесь cookie только записывается и читается; ротация, выход и отзыв — T-023.
const ACCESS_MAX_AGE_SECONDS = 15 * 60
const REFRESH_MAX_AGE_SECONDS = 30 * 24 * 60 * 60

interface SessionTokens {
  accessToken: string
  // Через BFF refresh приходит как `null`: маршрут уже положил его в httpOnly-cookie
  // (ADR-0023 п. 2). Значение появляется только у прямых серверных и тестовых вызовов.
  refreshToken?: string | null
}

const cookieOptions = (maxAge: number) => ({
  httpOnly: true,
  sameSite: "lax" as const,
  secure: !import.meta.dev,
  path: SESSION_COOKIE_PATH,
  maxAge
})

export const useAuthSession = () => {
  // Событие запроса захватывается в setup: внутри обработчика загрузки его уже не достать.
  const event = import.meta.server ? useRequestEvent() : null
  const access = useCookie(SESSION_ACCESS_COOKIE, cookieOptions(ACCESS_MAX_AGE_SECONDS))
  const refresh = useCookie(SESSION_REFRESH_COOKIE, cookieOptions(REFRESH_MAX_AGE_SECONDS))

  return {
    hasSession: computed(() => Boolean(access.value)),
    /**
     * Обмен токена выполняется на SSR и заканчивается редиректом, поэтому cookie пишется
     * прямо в ответ: после редиректа хук отрисовки страницы уже не срабатывает.
     */
    start(tokens: SessionTokens) {
      if (event) {
        setCookie(event, SESSION_ACCESS_COOKIE, tokens.accessToken, cookieOptions(ACCESS_MAX_AGE_SECONDS))
        if (tokens.refreshToken) {
          setCookie(event, SESSION_REFRESH_COOKIE, tokens.refreshToken, cookieOptions(REFRESH_MAX_AGE_SECONDS))
        }
        return
      }

      access.value = tokens.accessToken
      if (tokens.refreshToken) refresh.value = tokens.refreshToken
    },
    /**
     * API не признал сессию (`UNAUTHENTICATED`): cookie остались от отозванной или истёкшей
     * сессии. Без очистки страница входа по-прежнему видит cookie и возвращает на закрытую
     * страницу, а та снова уводит на вход — серверный рендер зацикливается на редиректах.
     */
    clear() {
      if (event) {
        deleteCookie(event, SESSION_ACCESS_COOKIE, cookieOptions(0))
        deleteCookie(event, SESSION_REFRESH_COOKIE, cookieOptions(0))
        return
      }

      access.value = null
      refresh.value = null
    }
  }
}

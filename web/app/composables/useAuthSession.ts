import { setCookie } from "h3"
import { SESSION_ACCESS_COOKIE, SESSION_COOKIE_PATH, SESSION_REFRESH_COOKIE } from "#shared/session"

// Access живёт 15 минут, refresh — 30 дней без активности (session-lifecycle.md п. 5).
// Здесь cookie только записывается и читается; ротация, выход и отзыв — T-023.
const ACCESS_MAX_AGE_SECONDS = 15 * 60
const REFRESH_MAX_AGE_SECONDS = 30 * 24 * 60 * 60

interface SessionTokens {
  accessToken: string
  refreshToken: string
}

const cookieOptions = (maxAge: number) => ({
  httpOnly: true,
  sameSite: "lax" as const,
  secure: !import.meta.dev,
  path: SESSION_COOKIE_PATH,
  maxAge
})

export const useAuthSession = () => {
  const access = useCookie(SESSION_ACCESS_COOKIE, cookieOptions(ACCESS_MAX_AGE_SECONDS))
  const refresh = useCookie(SESSION_REFRESH_COOKIE, cookieOptions(REFRESH_MAX_AGE_SECONDS))

  return {
    hasSession: computed(() => Boolean(access.value)),
    /**
     * Обмен токена выполняется на SSR и заканчивается редиректом, поэтому cookie пишется
     * прямо в ответ: после редиректа хук отрисовки страницы уже не срабатывает.
     */
    start(tokens: SessionTokens) {
      const event = import.meta.server ? useRequestEvent() : null
      if (event) {
        setCookie(event, SESSION_ACCESS_COOKIE, tokens.accessToken, cookieOptions(ACCESS_MAX_AGE_SECONDS))
        setCookie(event, SESSION_REFRESH_COOKIE, tokens.refreshToken, cookieOptions(REFRESH_MAX_AGE_SECONDS))
        return
      }

      access.value = tokens.accessToken
      refresh.value = tokens.refreshToken
    }
  }
}

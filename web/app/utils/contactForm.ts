import type { SupportTopic } from "~/graphql/generated/graphql"

/**
 * Письмо в редакцию (`docs/spec/20-public/contact.md`): чистые правила страницы — разбор
 * query-параметров, проверка полей до отправки и разбор ответа API. Разметка —
 * `components/contact/ContactForm.vue`, загрузка и отправка — `pages/contact.vue`.
 */

/** Справочник тем (§3). `broken_link` приходит со страницы 404, `refund` ведёт в кабинет. */
export const CONTACT_TOPICS: readonly SupportTopic[] = [
  "general",
  "broken_link",
  "refund",
  "copyright",
  "restore",
  "other"
]

/** Границы текста письма — те же, что проверяет сервер (§4 `[ДОПУЩЕНИЕ]`). */
export const CONTACT_MESSAGE_MIN = 20
export const CONTACT_MESSAGE_MAX = 4000

const first = (value: unknown): string | undefined => {
  const raw = Array.isArray(value) ? value[0] : value
  return typeof raw === "string" ? raw : undefined
}

/** Без `?topic=` — общий вопрос; неизвестная тема — «другое» (строка «Не найдено» §8). */
export const parseContactTopic = (value: unknown): SupportTopic => {
  const raw = first(value)
  if (!raw) return "general"
  return CONTACT_TOPICS.find((topic) => topic === raw) ?? "other"
}

/** `?path=` — путь сайта без query-параметров (§3); чужой адрес в поле не подставляется. */
export const parseContactPath = (value: unknown): string => {
  const path = first(value)?.trim().split(/[?#]/)[0] ?? ""
  return path.startsWith("/") && !path.startsWith("//") ? path.slice(0, 1000) : ""
}

const REQUEST_ID_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/

/** `?requestId=` со страницы 500 (§3): поле скрыто и уходит в обращение как есть. */
export const parseContactRequestId = (value: unknown): string => {
  const requestId = first(value)?.trim() ?? ""
  return REQUEST_ID_PATTERN.test(requestId) ? requestId : ""
}

/** Параметры адреса не индексируются, канонический адрес — `/contact` без них (§10). */
export const hasContactQuery = (query: Readonly<Record<string, unknown>>): boolean => Object.keys(query).length > 0

export interface ContactDraft {
  topic: SupportTopic
  email: string
  message: string
  acceptPrivacy: boolean
}

export type ContactField = "email" | "message" | "acceptPrivacy"
export type ContactFieldError = "required" | "email" | "tooShort" | "tooLong"

const EMAIL_PATTERN = /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/

/**
 * Ошибки полей до отправки. Гость указывает адрес и соглашается с политикой ПД; у аккаунта
 * адрес берётся из сессии, поэтому ни того, ни другого форма не спрашивает (§5 зона 3).
 */
export const validateContactDraft = (
  draft: ContactDraft,
  viewer: "guest" | "account"
): Partial<Record<ContactField, ContactFieldError>> => {
  const errors: Partial<Record<ContactField, ContactFieldError>> = {}
  const message = draft.message.trim()
  if (!message) errors.message = "required"
  else if (message.length < CONTACT_MESSAGE_MIN) errors.message = "tooShort"
  else if (message.length > CONTACT_MESSAGE_MAX) errors.message = "tooLong"

  if (viewer === "guest") {
    const email = draft.email.trim()
    if (!email) errors.email = "required"
    else if (!EMAIL_PATTERN.test(email)) errors.email = "email"
    if (!draft.acceptPrivacy) errors.acceptPrivacy = "required"
  }
  return errors
}

/**
 * Отказ API в терминах строк §8: лимит показывается с таймером, ошибка поля — у поля, прочее —
 * `ErrorState` с кодом запроса (журнал §28.4: код — только при техническом сбое).
 */
export type ContactFailure =
  | { kind: "rateLimited"; retryAfter: number | null }
  | { kind: "field"; field: ContactField }
  | { kind: "failed"; requestId: string | null }

interface ErrorLike {
  extensions?: Readonly<Record<string, unknown>> | null
}

export const contactFailure = (errors: readonly ErrorLike[] | undefined): ContactFailure => {
  const extensions = errors?.[0]?.extensions ?? {}
  const code = extensions.code
  if (code === "RATE_LIMITED") {
    const retryAfter = extensions.retryAfter
    return { kind: "rateLimited", retryAfter: typeof retryAfter === "number" ? retryAfter : null }
  }
  if (code === "VALIDATION_ERROR") {
    const field = extensions.field
    if (field === "email" || field === "message" || field === "acceptPrivacy") return { kind: "field", field }
  }
  const requestId = extensions.requestId
  return { kind: "failed", requestId: typeof requestId === "string" ? requestId : null }
}

/** Таймер строки лимита: оставшееся время `мм:сс`, не меньше нуля. */
export const formatRetryAfter = (seconds: number): string => {
  const safe = Math.max(0, Math.floor(seconds))
  const minutes = Math.floor(safe / 60)
  return `${minutes}:${String(safe % 60).padStart(2, "0")}`
}

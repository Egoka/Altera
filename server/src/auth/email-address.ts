/**
 * Общая работа с адресом входа: e-mail — единственный способ входа (ADR-0022), поэтому его
 * нормализация и проверка формата обязаны совпадать у входа и у смены адреса. Иначе один и тот
 * же адрес мог бы существовать в базе дважды в разном регистре.
 */

// Прагматичная проверка формата: адрес всё равно подтверждается письмом на него.
const EMAIL_PATTERN = /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/

export const normalizeEmail = (email: string): string => email.trim().toLowerCase()

export const isEmailAddress = (email: string): boolean => EMAIL_PATTERN.test(email)

/**
 * [ДОПУЩЕНИЕ] Маскирование адреса (`30-account/reader/email-change.md` §12): спецификация
 * требует показывать адрес скрытым, но правила не задаёт. Домен остаётся видимым — по нему
 * пользователь узнаёт свой ящик, а полный адрес открывается кнопкой «показать» (§5 зона 2).
 */
export function maskEmail(email: string): string {
  const separator = email.lastIndexOf("@")
  if (separator <= 0) return "•••"

  const local = email.slice(0, separator)
  const domain = email.slice(separator)

  return `${local.slice(0, 1)}•••${domain}`
}

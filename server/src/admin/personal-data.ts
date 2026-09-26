/**
 * Персональные данные на служебных страницах админки. Журнал §28.7: открытие любой служебной
 * страницы, где показан полный e-mail, считается чтением ПДн и записывается в аудит. Списки
 * поэтому показывают маску, а полный адрес открывает только карточка — с записью аудита.
 */

/** `a***e@example.com`: домен виден, локальная часть скрыта (§28.7). */
export function maskEmail(email: string): string {
  const separator = email.lastIndexOf("@")
  if (separator <= 0) return "***"
  const local = email.slice(0, separator)
  const domain = email.slice(separator)
  if (local.length <= 2) return `${local.slice(0, 1)}***${domain}`
  return `${local.slice(0, 1)}***${local.slice(-1)}${domain}`
}

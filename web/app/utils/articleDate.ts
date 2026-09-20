import { format, isValid, parseISO } from "date-fns"
import { enUS, ru } from "date-fns/locale"

/** Шаблон даты по локали страницы: ключи те же, что у @nuxtjs/i18n. */
const LOCALES: Record<string, { locale: typeof ru; pattern: string }> = {
  ru: { locale: ru, pattern: "d MMMM yyyy" },
  en: { locale: enUS, pattern: "MMMM d, yyyy" }
}

/**
 * Дата материала для служебной строки карточки: только календарная дата, по
 * локали страницы. Пустая или битая дата даёт пустую строку — атом тогда не
 * рендерится, а не показывает «Invalid Date».
 */
export const formatArticleDate = (iso: string, locale: string): string => {
  if (!iso) return ""
  const date = parseISO(iso)
  if (!isValid(date)) return ""
  const { locale: dateLocale, pattern } = LOCALES[locale] ?? LOCALES.en!
  return format(date, pattern, { locale: dateLocale })
}

/** Ключ месяца публикации `yyyy-MM` в том же поясе, что и дата карточки; битая дата — пустая строка. */
export const monthKeyOf = (iso: string): string => {
  if (!iso) return ""
  const date = parseISO(iso)
  return isValid(date) ? format(date, "yyyy-MM") : ""
}

/**
 * Подпись месяца для хроники автора: «Сентябрь 2026» / «September 2026».
 * В русской локали date-fns пишет месяц строчными — первая буква поднимается.
 */
export const formatArticleMonth = (key: string, locale: string): string => {
  const match = /^(\d{4})-(\d{2})$/.exec(key)
  if (!match) return ""
  const date = new Date(Number(match[1]), Number(match[2]) - 1, 1)
  if (!isValid(date) || date.getMonth() !== Number(match[2]) - 1) return ""
  const { locale: dateLocale } = LOCALES[locale] ?? LOCALES.en!
  const label = format(date, "LLLL yyyy", { locale: dateLocale })
  return label.charAt(0).toUpperCase() + label.slice(1)
}

/**
 * Месяц первой публикации для строки «публикуется с {месяц год}» (`author.md` §5 зона 2).
 * Здесь месяц стоит внутри фразы, поэтому в русской локали он остаётся строчным и в
 * родительном падеже — «с марта 2026», а не «с Март 2026»; заголовок месяца в хронике
 * (`formatArticleMonth`), наоборот, именительный и с прописной.
 */
export const formatPublishingSince = (iso: string, locale: string): string => {
  if (!iso) return ""
  const date = parseISO(iso)
  if (!isValid(date)) return ""
  const { locale: dateLocale } = LOCALES[locale] ?? LOCALES.en!
  return format(date, "MMMM yyyy", { locale: dateLocale })
}

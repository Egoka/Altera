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

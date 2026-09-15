export type LocaleCode = "ru" | "en"
export type PublishedSiblingPath = string | null | undefined

export const localeHome = (locale: LocaleCode) => (locale === "ru" ? "/" : "/en")

const isInternalAbsolutePath = (path: string) => path.startsWith("/") && !path.startsWith("//") && !path.includes("\\")

export const resolveLocaleSwitchPath = ({
  targetLocale,
  publishedSiblingPath,
  staticLocalePath
}: {
  targetLocale: LocaleCode
  publishedSiblingPath: PublishedSiblingPath
  staticLocalePath: string
}) => {
  if (publishedSiblingPath === undefined) return staticLocalePath

  return typeof publishedSiblingPath === "string" && isInternalAbsolutePath(publishedSiblingPath)
    ? publishedSiblingPath
    : localeHome(targetLocale)
}

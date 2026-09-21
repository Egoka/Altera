/**
 * Страницы юридических текстов `/legal/*` (`docs/spec/20-public/legal-*.md`, T-101).
 * Здесь чистые правила страниц: адреса, связанные документы, разбор `?version=` и строка о
 * принятой редакции. Загрузка и разметка — `components/legal/Page.vue`.
 */

export type LegalKind = "terms" | "privacy" | "content_rules" | "license"

export const LEGAL_PATHS: Record<LegalKind, string> = {
  terms: "/legal/terms",
  privacy: "/legal/privacy",
  content_rules: "/legal/content-rules",
  license: "/legal/license"
}

export interface LegalLink {
  labelKey: string
  to: string
}

/**
 * Зона «Связанные документы» (§5 каждой спецификации). Условия платных услуг и возвраты
 * существуют как адреса (F-01) и перечислены там, где их называет спецификация.
 */
export const LEGAL_RELATED: Record<LegalKind, readonly LegalLink[]> = {
  terms: [
    { labelKey: "legal.titles.privacy", to: LEGAL_PATHS.privacy },
    { labelKey: "legal.titles.content_rules", to: LEGAL_PATHS.content_rules },
    { labelKey: "legal.titles.license", to: LEGAL_PATHS.license },
    { labelKey: "legal.related.paidServices", to: "/legal/paid-services" },
    { labelKey: "legal.related.refunds", to: "/legal/refunds" }
  ],
  privacy: [
    { labelKey: "legal.titles.terms", to: LEGAL_PATHS.terms },
    { labelKey: "legal.titles.content_rules", to: LEGAL_PATHS.content_rules },
    { labelKey: "legal.titles.license", to: LEGAL_PATHS.license },
    { labelKey: "legal.related.privacyContact", to: "/contact?topic=privacy" }
  ],
  content_rules: [
    { labelKey: "legal.titles.license", to: LEGAL_PATHS.license },
    { labelKey: "legal.titles.privacy", to: LEGAL_PATHS.privacy },
    { labelKey: "legal.titles.terms", to: LEGAL_PATHS.terms },
    { labelKey: "legal.related.writeEditorial", to: "/contact?topic=copyright" }
  ],
  license: [
    { labelKey: "legal.titles.content_rules", to: LEGAL_PATHS.content_rules },
    { labelKey: "legal.titles.terms", to: LEGAL_PATHS.terms },
    { labelKey: "legal.titles.privacy", to: LEGAL_PATHS.privacy }
  ]
}

/**
 * Номер редакции из адреса. `undefined` — действующая редакция; всё, что не целое число от
 * единицы, — `null`: такой адрес ни к какой редакции не ведёт и отвечает 404 (§8).
 */
export const legalVersionParam = (value: unknown): number | null | undefined => {
  const raw = Array.isArray(value) ? value[0] : value
  if (raw === undefined || raw === null || raw === "") return undefined
  const parsed = Number(raw)
  return Number.isInteger(parsed) && parsed >= 1 ? parsed : null
}

/** Дата публикации редакции: день, месяц словом и год, без времени. */
export const formatLegalDate = (iso: string, locale: string): string => {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ""
  return new Intl.DateTimeFormat(locale === "en" ? "en-GB" : "ru-RU", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC"
  }).format(date)
}

export interface LegalConsentView {
  kind: string
  currentVersion?: number | null
  acceptedVersion?: number | null
  acceptedAt?: string | null
  reconsentRequired: boolean
}

/** Согласие показывается только у оферты и политики ПД: с ними соглашаются при регистрации. */
export const consentFor = (
  kind: LegalKind,
  consents: readonly LegalConsentView[] | null | undefined
): LegalConsentView | null => {
  if (kind !== "terms" && kind !== "privacy") return null
  const consent = consents?.find((item) => item.kind === kind)
  return consent && consent.acceptedVersion ? consent : null
}

/** Роль читателя страницы: зоны аккаунта видны только активному аккаунту (§2, строка «Заблокирован» §8). */
export type LegalViewer = "guest" | "account" | "archived"

export const legalViewerFromCode = (code: string | undefined): LegalViewer =>
  code === "FORBIDDEN" ? "archived" : "guest"

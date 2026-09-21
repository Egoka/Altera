import type { LegalTextKind, LegalTextStatus, Locale } from "~/graphql/generated/graphql"

// Раздел `/admin/legal` (`docs/spec/40-admin/legal-texts.md`): виды, фильтры и сравнение версий.

export const LEGAL_TEXT_KINDS: readonly LegalTextKind[] = [
  "terms",
  "privacy",
  "content_rules",
  "license",
  "paid_services",
  "refunds",
  "about"
]
export const LEGAL_TEXT_LOCALES: readonly Locale[] = ["ru", "en"]
export const LEGAL_TEXT_STATUSES: readonly LegalTextStatus[] = ["draft", "published", "previous"]

/** Условия платных услуг и возвраты публикуются до включения платности с плашкой (§5). */
export const PAID_LEGAL_KINDS: readonly LegalTextKind[] = ["paid_services", "refunds"]

export const parseLegalKind = (value: unknown): LegalTextKind | null =>
  LEGAL_TEXT_KINDS.find((kind) => kind === value) ?? null

/** Локаль по умолчанию — русская: официальная версия текста (§3, §4). */
export const parseLegalLocale = (value: unknown): Locale => LEGAL_TEXT_LOCALES.find((l) => l === value) ?? "ru"

export const parseLegalStatus = (value: unknown): LegalTextStatus | null =>
  LEGAL_TEXT_STATUSES.find((status) => status === value) ?? null

export const parseLegalVersion = (value: unknown): number | null => {
  const text = String(value ?? "")
  return /^[1-9]\d{0,5}$/.test(text) ? Number(text) : null
}

export interface LegalDiffLine {
  kind: "same" | "added" | "removed"
  text: string
}

/** Строки текста для сравнения: переносы и границы блочных элементов HTML. */
export const splitLegalLines = (html: string): string[] =>
  html
    .replace(/(<\/(?:p|h[1-6]|li|ul|ol|blockquote|table|tr)>)/gi, "$1\n")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)

/**
 * Построчное сравнение с действующей версией (§5 «Предпросмотр и сравнение»): наибольшая общая
 * подпоследовательность строк. Версии юридических текстов короткие, квадратичный алгоритм достаточен.
 */
export const diffLegalLines = (before: string, after: string): LegalDiffLine[] => {
  const a = splitLegalLines(before)
  const b = splitLegalLines(after)
  const table = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0))
  for (let i = a.length - 1; i >= 0; i -= 1) {
    for (let j = b.length - 1; j >= 0; j -= 1) {
      table[i]![j] = a[i] === b[j] ? table[i + 1]![j + 1]! + 1 : Math.max(table[i + 1]![j]!, table[i]![j + 1]!)
    }
  }

  const lines: LegalDiffLine[] = []
  let i = 0
  let j = 0
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      lines.push({ kind: "same", text: a[i]! })
      i += 1
      j += 1
    } else if (table[i + 1]![j]! >= table[i]![j + 1]!) {
      lines.push({ kind: "removed", text: a[i]! })
      i += 1
    } else {
      lines.push({ kind: "added", text: b[j]! })
      j += 1
    }
  }
  while (i < a.length) lines.push({ kind: "removed", text: a[i++]! })
  while (j < b.length) lines.push({ kind: "added", text: b[j++]! })
  return lines
}

export const adminLegalPath = (kind: LegalTextKind, version?: number): string =>
  version === undefined ? `/admin/legal/${kind}` : `/admin/legal/${kind}/${version}`

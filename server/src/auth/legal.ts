import type { Locale, PrismaClient } from "../generated/prisma"

// Страницы действующих юридических текстов (docs/spec/00-registries/routes.md #16, #17).
// Механизм версий и сами страницы — T-101; здесь нужен только действующий номер версии,
// который записывается вместе с согласием при регистрации (ADR-0028, матрица #54).
export const LEGAL_TERMS_PATH = "/legal/terms"
export const LEGAL_PRIVACY_PATH = "/legal/privacy"

export interface LegalVersions {
  termsVersion: number | null
  privacyVersion: number | null
  termsPath: string
  privacyPath: string
}

type LegalTextClient = Pick<PrismaClient, "legalText">

async function publishedVersion(
  prisma: LegalTextClient,
  kind: "terms" | "privacy",
  locale: Locale
): Promise<number | null> {
  const published = await prisma.legalText.findFirst({
    where: { kind, locale, status: "published" },
    orderBy: { version: "desc" },
    select: { version: true }
  })

  return published?.version ?? null
}

export async function readLegalVersions(prisma: LegalTextClient, locale: Locale): Promise<LegalVersions> {
  const [termsVersion, privacyVersion] = await Promise.all([
    publishedVersion(prisma, "terms", locale),
    publishedVersion(prisma, "privacy", locale)
  ])

  return { termsVersion, privacyVersion, termsPath: LEGAL_TERMS_PATH, privacyPath: LEGAL_PRIVACY_PATH }
}

export interface ConsentVersions {
  termsVersion: number
  privacyVersion: number
}

/// Согласие актуально, когда пользователь принял действующие версии обоих текстов
/// (docs/spec/50-access/session-lifecycle.md п. 9). Пока действующих текстов нет,
/// сверять нечего и повторное согласие не запрашивается.
export async function findOutdatedConsent(
  prisma: Pick<PrismaClient, "legalText" | "userLegalConsent">,
  userId: string,
  locale: Locale
): Promise<LegalVersions | null> {
  const current = await readLegalVersions(prisma, locale)
  if (current.termsVersion === null && current.privacyVersion === null) return null

  const accepted = await prisma.userLegalConsent.findMany({
    where: { userId, legalText: { locale, kind: { in: ["terms", "privacy"] } } },
    select: { legalText: { select: { kind: true, version: true } } }
  })

  const acceptedVersion = (kind: "terms" | "privacy") =>
    accepted
      .filter((consent) => consent.legalText.kind === kind)
      .reduce<number | null>((best, consent) => Math.max(best ?? 0, consent.legalText.version), null)

  const termsOutdated = current.termsVersion !== null && acceptedVersion("terms") !== current.termsVersion
  const privacyOutdated = current.privacyVersion !== null && acceptedVersion("privacy") !== current.privacyVersion

  return termsOutdated || privacyOutdated ? current : null
}

/// Запись согласия с указанными версиями. Повторное принятие той же версии не дублируется.
export async function recordConsent(
  prisma: Pick<PrismaClient, "legalText" | "userLegalConsent">,
  input: { userId: string; locale: Locale; termsVersion: number | null; privacyVersion: number | null }
): Promise<void> {
  const wanted: { kind: "terms" | "privacy"; version: number }[] = []
  if (input.termsVersion !== null) wanted.push({ kind: "terms", version: input.termsVersion })
  if (input.privacyVersion !== null) wanted.push({ kind: "privacy", version: input.privacyVersion })
  if (wanted.length === 0) return

  const texts = await prisma.legalText.findMany({
    where: { locale: input.locale, OR: wanted },
    select: { id: true }
  })

  for (const text of texts) {
    await prisma.userLegalConsent.upsert({
      where: { userId_legalTextId: { userId: input.userId, legalTextId: text.id } },
      update: {},
      create: { userId: input.userId, legalTextId: text.id }
    })
  }
}

import type { Locale, PrismaClient } from "../generated/prisma"

// Страницы действующих юридических текстов (docs/spec/00-registries/routes.md #16, #17).
// Версии и страницы — `src/legal/texts.ts`; здесь действующий номер версии, который
// записывается вместе с согласием при регистрации (ADR-0028, матрица #54).
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

type ConsentKind = "terms" | "privacy"
const CONSENT_KINDS: readonly ConsentKind[] = ["terms", "privacy"]

export interface ConsentState {
  kind: ConsentKind
  locale: Locale
  currentVersion: number | null
  acceptedVersion: number | null
  acceptedAt: Date | null
  reconsentRequired: boolean
}

type ConsentClient = Pick<PrismaClient, "legalText" | "userLegalConsent">

/**
 * Состояние согласия по оферте и политике ПД в локали аккаунта.
 *
 * Повторное согласие требуется, только если после принятой редакции вышла существенная
 * (`isMaterial`): несущественная правка действует без нового согласия (ADR-0028 п. 2;
 * `docs/spec/40-admin/legal-texts.md` §5). Аккаунт, не принявший ни одной редакции при
 * опубликованном тексте, соглашается с действующей.
 */
export async function readConsentStates(
  prisma: ConsentClient,
  userId: string,
  locale: Locale
): Promise<ConsentState[]> {
  const current = await readLegalVersions(prisma, locale)

  const accepted = await prisma.userLegalConsent.findMany({
    where: { userId, legalText: { locale, kind: { in: [...CONSENT_KINDS] } } },
    select: { acceptedAt: true, legalText: { select: { kind: true, version: true } } }
  })

  return Promise.all(
    CONSENT_KINDS.map(async (kind) => {
      const currentVersion = kind === "terms" ? current.termsVersion : current.privacyVersion
      const latest = accepted
        .filter((consent) => consent.legalText.kind === kind)
        .reduce<
          (typeof accepted)[number] | null
        >((best, consent) => (best === null || consent.legalText.version > best.legalText.version ? consent : best), null)
      const acceptedVersion = latest?.legalText.version ?? null

      let reconsentRequired = false
      if (currentVersion !== null) {
        if (acceptedVersion === null) {
          reconsentRequired = true
        } else if (acceptedVersion < currentVersion) {
          const materialSince = await prisma.legalText.count({
            where: {
              kind,
              locale,
              isMaterial: true,
              status: { in: ["published", "previous"] },
              version: { gt: acceptedVersion, lte: currentVersion }
            }
          })
          reconsentRequired = materialSince > 0
        }
      }

      return {
        kind,
        locale,
        currentVersion,
        acceptedVersion,
        acceptedAt: latest?.acceptedAt ?? null,
        reconsentRequired
      }
    })
  )
}

/// Повторное согласие при входе (docs/spec/50-access/session-lifecycle.md п. 9): нужно, когда
/// хотя бы по одному из текстов вышла существенная редакция после принятой. Пока действующих
/// текстов нет, сверять нечего и повторное согласие не запрашивается.
export async function findOutdatedConsent(
  prisma: ConsentClient,
  userId: string,
  locale: Locale
): Promise<LegalVersions | null> {
  const states = await readConsentStates(prisma, userId, locale)
  if (!states.some((state) => state.reconsentRequired)) return null

  const versionOf = (kind: ConsentKind) => states.find((state) => state.kind === kind)?.currentVersion ?? null
  return {
    termsVersion: versionOf("terms"),
    privacyVersion: versionOf("privacy"),
    termsPath: LEGAL_TERMS_PATH,
    privacyPath: LEGAL_PRIVACY_PATH
  }
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

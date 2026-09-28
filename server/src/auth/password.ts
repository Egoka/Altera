import crypto, { randomBytes, timingSafeEqual } from "node:crypto"
import { createApiError } from "../errors/graphql-error"
import { isBlockedPassword, type PasswordOwnerHints } from "./password-blocklist"

/**
 * Требования к паролю и его хранение — утверждены владельцем целиком (журнал §44 п. 1) по
 * предложению `docs/reports/2026-09-27-t116-rate-limit-thresholds-proposal.md`:
 *
 * - длина 15…128 code points после нормализации NFC, пароль не обрезается и не дополняется;
 * - обязательных классов символов нет, разрешены печатные ASCII, пробел и Unicode;
 * - новый пароль сверяется целиком с локальным blocklist (`password-blocklist.ts`);
 * - хранение — Argon2id с уникальной солью и PHC-строкой, профиль OWASP `m=19 MiB, t=2, p=1`.
 *
 * Пароль, его нормализованное значение и результат сверки со списком не логируются: наружу
 * уходит только код ошибки и имя нарушенного правила.
 */

export const PASSWORD_MIN_LENGTH = 15
export const PASSWORD_MAX_LENGTH = 128

export interface Argon2Profile {
  /** Память в килобайтах: `m=19456` — минимальный профиль OWASP `19 MiB`. */
  memory: number
  passes: number
  parallelism: number
  tagLength: number
}

/** Минимальный профиль OWASP из утверждённого предложения; повышается измерением среды. */
export const ARGON2_PROFILE: Argon2Profile = Object.freeze({
  memory: 19456,
  passes: 2,
  parallelism: 1,
  tagLength: 32
})

const ARGON2_VERSION = 19
const SALT_BYTES = 16

interface Argon2Parameters {
  message: Buffer
  nonce: Buffer
  parallelism: number
  tagLength: number
  memory: number
  passes: number
}

type Argon2Binding = (
  algorithm: "argon2id",
  parameters: Argon2Parameters,
  callback: (error: Error | null, tag: Buffer) => void
) => void

/*
 * Argon2id взят из `node:crypto` Node 24 (`engines.node` = 24.12.0): отдельная нативная
 * зависимость ради того же алгоритма только добавила бы сборку под каждую платформу. Типов
 * функции в `@types/node` 24.0.15 ещё нет, поэтому её форма объявлена здесь, а отсутствие
 * проверяется явно — иначе пароль молча не проверялся бы на слишком старой среде.
 */
const argon2Binding = (crypto as unknown as { argon2?: Argon2Binding }).argon2

const derive = (password: string, salt: Buffer, profile: Argon2Profile): Promise<Buffer> => {
  if (typeof argon2Binding !== "function") {
    throw new Error("node:crypto argon2 is unavailable: Node.js 24 or newer is required")
  }

  return new Promise((resolve, reject) => {
    argon2Binding(
      "argon2id",
      {
        message: Buffer.from(password, "utf8"),
        nonce: salt,
        parallelism: profile.parallelism,
        tagLength: profile.tagLength,
        memory: profile.memory,
        passes: profile.passes
      },
      (error, tag) => (error ? reject(error) : resolve(Buffer.from(tag)))
    )
  })
}

/** Нормализация NFC — та же форма, что при регистрации: иначе один пароль даёт два хэша. */
export const normalizePassword = (password: string): string => password.normalize("NFC")

/** Длина считается в code points, а не в единицах UTF-16: эмодзи — один символ, а не два. */
export const passwordLength = (password: string): number => [...password].length

export type PasswordRuleViolation = "length" | "blocklist"

/**
 * Что именно нарушено; `null` — пароль принимается. Проверка выполняется до хэширования:
 * длиннее максимума пароль не должен доходить до Argon2 вовсе.
 */
export function checkPassword(password: string, hints: PasswordOwnerHints = {}): PasswordRuleViolation | null {
  const normalized = normalizePassword(password)
  const length = passwordLength(normalized)
  if (length < PASSWORD_MIN_LENGTH || length > PASSWORD_MAX_LENGTH) return "length"
  if (isBlockedPassword(normalized, hints)) return "blocklist"

  return null
}

/** Отказ словаря ошибок с именем правила; само значение пароля в ошибку не попадает. */
export function assertPasswordAcceptable(
  password: string,
  options: { requestId: string; field?: string; hints?: PasswordOwnerHints }
): string {
  const violation = checkPassword(password, options.hints ?? {})
  if (violation) {
    throw createApiError("VALIDATION_ERROR", {
      requestId: options.requestId,
      field: options.field ?? "password",
      rule: violation === "length" ? `${PASSWORD_MIN_LENGTH}..${PASSWORD_MAX_LENGTH} characters` : "known password"
    })
  }

  return normalizePassword(password)
}

const encodeBase64 = (value: Buffer): string => value.toString("base64").replace(/=+$/, "")

/** PHC-строка: `$argon2id$v=19$m=…,t=…,p=…$соль$хэш`. Параметры лежат рядом с самим хэшем. */
export async function hashPassword(password: string, profile = ARGON2_PROFILE): Promise<string> {
  const salt = randomBytes(SALT_BYTES)
  const tag = await derive(normalizePassword(password), salt, profile)
  const parameters = `m=${profile.memory},t=${profile.passes},p=${profile.parallelism}`

  return `$argon2id$v=${ARGON2_VERSION}$${parameters}$${encodeBase64(salt)}$${encodeBase64(tag)}`
}

interface ParsedPasswordHash {
  profile: Argon2Profile
  salt: Buffer
  tag: Buffer
}

/** Неизвестная форма строки — не исключение, а «не совпало»: сравнение обязано ответить false. */
export function parsePasswordHash(value: string): ParsedPasswordHash | null {
  const parts = value.split("$")
  if (parts.length !== 6 || parts[0] !== "" || parts[1] !== "argon2id") return null
  if (parts[2] !== `v=${ARGON2_VERSION}`) return null

  const parameters = new Map(
    (parts[3] ?? "").split(",").map((pair) => {
      const [key, raw] = pair.split("=")
      return [key ?? "", Number.parseInt(raw ?? "", 10)] as const
    })
  )
  const memory = parameters.get("m")
  const passes = parameters.get("t")
  const parallelism = parameters.get("p")
  if (!Number.isInteger(memory) || !Number.isInteger(passes) || !Number.isInteger(parallelism)) return null

  const salt = Buffer.from(parts[4] ?? "", "base64")
  const tag = Buffer.from(parts[5] ?? "", "base64")
  if (salt.length === 0 || tag.length === 0) return null

  return {
    profile: {
      memory: memory as number,
      passes: passes as number,
      parallelism: parallelism as number,
      tagLength: tag.length
    },
    salt,
    tag
  }
}

export async function verifyPassword(storedHash: string, password: string): Promise<boolean> {
  const parsed = parsePasswordHash(storedHash)
  if (!parsed) return false

  const tag = await derive(normalizePassword(password), parsed.salt, parsed.profile)
  return tag.length === parsed.tag.length && timingSafeEqual(tag, parsed.tag)
}

/**
 * Параметры хранения могли вырасти после измерения среды: при следующем успешном входе хэш
 * пересчитывается, а не остаётся на прежнем профиле навсегда.
 */
export function needsRehash(storedHash: string, profile = ARGON2_PROFILE): boolean {
  const parsed = parsePasswordHash(storedHash)
  if (!parsed) return true

  return (
    parsed.profile.memory < profile.memory ||
    parsed.profile.passes < profile.passes ||
    parsed.tag.length < profile.tagLength
  )
}

/*
 * Проверка несуществующего адреса выполняет эквивалентную по стоимости проверку фиктивного
 * хэша (утверждённое предложение T-116): иначе «нет такого аккаунта» отвечал бы за миллисекунды,
 * а «неверный пароль» — за десятки, и существование аккаунта читалось бы по времени ответа.
 */
let dummyHash: Promise<string> | null = null

export async function verifyAgainstDummyPassword(password: string): Promise<false> {
  dummyHash ??= hashPassword(`dummy:${randomBytes(16).toString("hex")}`)
  await verifyPassword(await dummyHash, password)

  return false
}

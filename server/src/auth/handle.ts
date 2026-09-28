import crypto from "node:crypto"
import type { Locale, Prisma, PrismaClient, Role, User } from "../generated/prisma"
import { createApiError } from "../errors/graphql-error"
import { authorCacheTag } from "../cache"
import type { Cache } from "../cache"

interface PrismaUniqueError {
  code?: unknown
  meta?: {
    modelName?: unknown
    target?: unknown
  }
}

export const isPrismaUniqueConstraint = (error: unknown, field: string): boolean => {
  if (typeof error !== "object" || error === null) return false

  const candidate = error as PrismaUniqueError
  if (candidate.code !== "P2002") return false

  const target = candidate.meta?.target
  if (Array.isArray(target)) return target.includes(field)
  return typeof target === "string" && target.includes(field)
}

const isHandleReservationConflict = (error: unknown): boolean => {
  if (!isPrismaUniqueConstraint(error, "handle")) return false
  const modelName = (error as PrismaUniqueError).meta?.modelName
  return modelName === undefined || modelName === "HandleHistory"
}

export function generateRandomHandle(): string {
  return `u-${crypto.randomBytes(4).toString("hex")}`
}

const HANDLE_PATTERN = /^[a-z0-9-]{3,32}$/

/**
 * Смена хэндла в профиле. Новый адрес страницы автора должен отвечать сразу, а прежний —
 * уйти на него 301, поэтому кеш профиля (`author:{handle}`, `author.md` §4) сбрасывается по
 * обоим хэндлам: старая запись иначе прожила бы до конца TTL под чужим именем.
 */
export async function changeUserHandle(
  prisma: PrismaClient,
  input: { userId: string; handle: string; requestId: string; cache?: Cache }
): Promise<User> {
  const handle = input.handle.trim().toLowerCase()
  if (!HANDLE_PATTERN.test(handle)) {
    throw createApiError("VALIDATION_ERROR", {
      requestId: input.requestId,
      field: "handle",
      rule: "lowercase letters, digits, and hyphens; 3-32 characters"
    })
  }

  try {
    const { user, previousHandle } = await prisma.$transaction(async (transaction: Prisma.TransactionClient) => {
      const before = await transaction.user.findUnique({
        where: { id: input.userId },
        select: { handle: true }
      })
      await transaction.handleHistory.create({ data: { handle, userId: input.userId } })
      const updated = await transaction.user.update({ where: { id: input.userId }, data: { handle } })
      return { user: updated, previousHandle: before?.handle ?? null }
    })

    const tags = [authorCacheTag(handle)]
    if (previousHandle && previousHandle !== handle) tags.push(authorCacheTag(previousHandle))
    await input.cache?.delByTags(tags)

    return user
  } catch (error: unknown) {
    if (!isHandleReservationConflict(error)) throw error
    throw createApiError("CONFLICT", {
      requestId: input.requestId,
      entity: "handle",
      expected: "available",
      actual: "reserved"
    })
  }
}

export interface ReservedHandleUserInput {
  email: string
  name: string
  locale: Locale
  /** Служебная запись создаётся сразу с целевой ролью: вторым шагом её пришлось бы досоздавать. */
  role?: Role
  isServiceAccount?: boolean
  /** Пароль задаёт только регистрация с паролем; вход по ссылке заводит запись без него. */
  passwordHash?: string | null
  passwordUpdatedAt?: Date | null
  /**
   * Подтверждение адреса: вход по ссылке подтверждает его самим переходом, регистрация с
   * паролем — отдельным письмом до первого входа (журнал §34 п. 7).
   */
  emailVerifiedAt?: Date | null
}

/**
 * Создаёт аккаунт вместе с вечной записью его хэндла. `withinTransaction` выполняется в той же
 * транзакции: всё, без чего аккаунт не имеет смысла (роль служебной записи, её аудит), обязано
 * откатиться вместе с ним — иначе сбой второго шага оставил бы занятый адрес у аккаунта читателя.
 * Повтор при занятом хэндле остаётся снаружи: неуникальность отменяет транзакцию PostgreSQL
 * целиком, и новую попытку можно делать только новой транзакцией.
 */
export async function createUserWithReservedHandle(
  prisma: PrismaClient,
  input: ReservedHandleUserInput,
  withinTransaction?: (transaction: Prisma.TransactionClient, user: User) => Promise<void>
): Promise<User> {
  for (;;) {
    const handle = generateRandomHandle()

    try {
      return await prisma.$transaction(async (transaction: Prisma.TransactionClient) => {
        await transaction.handleHistory.create({ data: { handle } })
        const user = await transaction.user.create({ data: { ...input, handle } })
        await transaction.handleHistory.update({ where: { handle }, data: { userId: user.id } })
        await withinTransaction?.(transaction, user)
        return user
      })
    } catch (error: unknown) {
      if (isHandleReservationConflict(error)) continue
      throw error
    }
  }
}

import crypto from "node:crypto"
import type { Locale, Prisma, PrismaClient, User } from "../generated/prisma"
import { createApiError } from "../errors/graphql-error"

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

export async function changeUserHandle(
  prisma: PrismaClient,
  input: { userId: string; handle: string; requestId: string }
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
    return await prisma.$transaction(async (transaction: Prisma.TransactionClient) => {
      await transaction.handleHistory.create({ data: { handle, userId: input.userId } })
      return transaction.user.update({ where: { id: input.userId }, data: { handle } })
    })
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

export async function createUserWithReservedHandle(
  prisma: PrismaClient,
  input: { email: string; name: string; locale: Locale }
): Promise<User> {
  for (;;) {
    const handle = generateRandomHandle()

    try {
      return await prisma.$transaction(async (transaction: Prisma.TransactionClient) => {
        await transaction.handleHistory.create({ data: { handle } })
        const user = await transaction.user.create({ data: { ...input, handle } })
        await transaction.handleHistory.update({ where: { handle }, data: { userId: user.id } })
        return user
      })
    } catch (error: unknown) {
      if (isHandleReservationConflict(error)) continue
      throw error
    }
  }
}

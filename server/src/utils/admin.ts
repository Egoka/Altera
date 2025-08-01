import { GraphQLError } from "graphql"
import { GraphQLContext } from "../prisma"
import crypto from "crypto"

// Константы для админ кеширования
export const ADMIN_CACHE_PREFIX = "admin:"
export const ADMIN_CACHE_TTL = 21600 // 360 минуты

// Типы для админ функций
export interface PaginationInput {
  page: number
  limit: number
  maxLimit?: number
}

export interface SortInput {
  field: string
  direction: "ASC" | "DESC"
}

export interface DateRangeInput {
  from?: string
  to?: string
}

export interface SearchInput {
  query: string
  fields: string[]
}

export interface BaseFilters {
  status?: string[]
  createdAt?: DateRangeInput
  updatedAt?: DateRangeInput
}

export interface PaginationInfo {
  currentPage: number
  totalPages: number
  totalItems: number
  itemsPerPage: number
  hasNextPage: boolean
  hasPreviousPage: boolean
}

// Утилиты для валидации
export const validatePagination = (pagination: PaginationInput) => {
  if (pagination.page < 1) {
    throw new GraphQLError("Page must be >= 1", { extensions: { code: "VALIDATION_ERROR" } })
  }
  if (pagination.limit < 1) {
    throw new GraphQLError("Limit must be >= 1", { extensions: { code: "VALIDATION_ERROR" } })
  }
  if (pagination.limit > 100) {
    throw new GraphQLError("Limit cannot exceed 100", { extensions: { code: "VALIDATION_ERROR" } })
  }
}

export const validateSort = (sort: SortInput, allowedFields: string[]) => {
  if (!allowedFields.includes(sort.field)) {
    throw new GraphQLError(`Invalid sort field: ${sort.field}`, {
      extensions: { code: "VALIDATION_ERROR" }
    })
  }
  if (!["ASC", "DESC"].includes(sort.direction)) {
    throw new GraphQLError(`Invalid sort direction: ${sort.direction}`, {
      extensions: { code: "VALIDATION_ERROR" }
    })
  }
}

// Утилиты для построения WHERE условий
export const buildBaseWhereClause = (filters: BaseFilters, search?: SearchInput) => {
  const where: any = {}

  if (filters.status?.length) {
    where.status = { in: filters.status }
  }

  if (filters.createdAt) {
    where.createdAt = {}
    if (filters.createdAt.from) {
      where.createdAt.gte = new Date(filters.createdAt.from)
    }
    if (filters.createdAt.to) {
      where.createdAt.lte = new Date(filters.createdAt.to)
    }
  }

  if (filters.updatedAt) {
    where.updatedAt = {}
    if (filters.updatedAt.from) {
      where.updatedAt.gte = new Date(filters.updatedAt.from)
    }
    if (filters.updatedAt.to) {
      where.updatedAt.lte = new Date(filters.updatedAt.to)
    }
  }

  if (search) {
    where.OR = search.fields.map((field) => ({
      [field]: { contains: search.query, mode: "insensitive" }
    }))
  }

  return where
}

export const buildOrderBy = (sort: SortInput) => {
  return { [sort.field]: sort.direction.toLowerCase() }
}

// Утилиты для пагинации
export const calculatePagination = (page: number, limit: number, total: number) => {
  const maxLimit = 100
  const actualLimit = Math.min(limit, maxLimit)
  const skip = (page - 1) * actualLimit
  const totalPages = Math.ceil(total / actualLimit)

  return {
    skip,
    take: actualLimit,
    pagination: {
      currentPage: page,
      totalPages,
      totalItems: total,
      itemsPerPage: actualLimit,
      hasNextPage: page < totalPages,
      hasPreviousPage: page > 1
    }
  }
}

// Утилиты для кеширования
export const getCacheKey = (operation: string, params: any) => {
  const hash = crypto.createHash("md5").update(JSON.stringify(params)).digest("hex")
  return `${ADMIN_CACHE_PREFIX}${operation}:${hash}`
}

export const getCachedOrFetch = async (ctx: GraphQLContext, cacheKey: string, fetchFunction: () => Promise<any>) => {
  const cached = await ctx.redis.get(cacheKey)
  if (cached) {
    console.log("CACHE: Returning admin data from cache")
    return JSON.parse(cached)
  }

  console.log("DATABASE: Admin data not in cache, fetching from database")
  const data = await fetchFunction()
  await ctx.redis.setex(cacheKey, ADMIN_CACHE_TTL, JSON.stringify(data))

  return data
}

// Утилиты для обработки ошибок
export const handleAdminError = (error: any) => {
  if (error.code === "P2002") {
    throw new GraphQLError("Duplicate entry", { extensions: { code: "DUPLICATE" } })
  }
  if (error.code === "P2025") {
    throw new GraphQLError("Record not found", { extensions: { code: "NOT_FOUND" } })
  }
  if (error.code === "P2003") {
    throw new GraphQLError("Foreign key constraint failed", { extensions: { code: "FOREIGN_KEY_ERROR" } })
  }
  throw new GraphQLError("Internal server error", { extensions: { code: "INTERNAL_ERROR" } })
}

// Утилиты для валидации дат
export const validateDateRange = (dateRange: DateRangeInput) => {
  if (dateRange.from && dateRange.to) {
    const fromDate = new Date(dateRange.from)
    const toDate = new Date(dateRange.to)

    if (isNaN(fromDate.getTime()) || isNaN(toDate.getTime())) {
      throw new GraphQLError("Invalid date format", { extensions: { code: "VALIDATION_ERROR" } })
    }

    if (fromDate > toDate) {
      throw new GraphQLError("From date cannot be after to date", { extensions: { code: "VALIDATION_ERROR" } })
    }
  }
}

// Утилиты для поиска
export const validateSearchInput = (search: SearchInput, allowedFields: string[]) => {
  if (!search.query.trim()) {
    throw new GraphQLError("Search query cannot be empty", { extensions: { code: "VALIDATION_ERROR" } })
  }

  if (search.query.length < 2) {
    throw new GraphQLError("Search query must be at least 2 characters", { extensions: { code: "VALIDATION_ERROR" } })
  }

  const invalidFields = search.fields.filter((field) => !allowedFields.includes(field))
  if (invalidFields.length > 0) {
    throw new GraphQLError(`Invalid search fields: ${invalidFields.join(", ")}`, {
      extensions: { code: "VALIDATION_ERROR" }
    })
  }
}

// Утилиты для массовых операций
export const validateBulkOperation = (ids: string[], maxItems: number = 100) => {
  if (!ids.length) {
    throw new GraphQLError("No items selected", { extensions: { code: "VALIDATION_ERROR" } })
  }

  if (ids.length > maxItems) {
    throw new GraphQLError(`Cannot process more than ${maxItems} items at once`, {
      extensions: { code: "VALIDATION_ERROR" }
    })
  }

  // Проверяем, что все ID являются валидными UUID
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
  const invalidIds = ids.filter((id) => !uuidRegex.test(id))

  if (invalidIds.length > 0) {
    throw new GraphQLError(`Invalid IDs: ${invalidIds.join(", ")}`, { extensions: { code: "VALIDATION_ERROR" } })
  }
}

// Утилиты для логирования админ операций
export const logAdminOperation = (operation: string, userId: string, details: any) => {
  console.log(`ADMIN OPERATION: ${operation}`, {
    userId,
    timestamp: new Date().toISOString(),
    details
  })
}

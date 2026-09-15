import { createApiError } from "../errors/graphql-error"

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
export const validatePagination = (pagination: PaginationInput, requestId: string) => {
  if (pagination.page < 1) {
    throw createApiError("VALIDATION_ERROR", { requestId, field: "page", rule: "min:1" })
  }
  if (pagination.limit < 1) {
    throw createApiError("VALIDATION_ERROR", { requestId, field: "limit", rule: "min:1" })
  }
  if (pagination.limit > 100) {
    throw createApiError("VALIDATION_ERROR", { requestId, field: "limit", rule: "max:100" })
  }
}

export const validateSort = (sort: SortInput, allowedFields: string[], requestId: string) => {
  if (!allowedFields.includes(sort.field)) {
    throw createApiError("VALIDATION_ERROR", { requestId, field: "sort.field", rule: "allowed" })
  }
  if (!["ASC", "DESC"].includes(sort.direction)) {
    throw createApiError("VALIDATION_ERROR", { requestId, field: "sort.direction", rule: "enum:ASC,DESC" })
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

// Утилиты для обработки ошибок
function getPrismaError(error: unknown): { code?: unknown; meta?: unknown } | null {
  if (typeof error !== "object" || error === null) return null
  return {
    code: "code" in error ? error.code : undefined,
    meta: "meta" in error ? error.meta : undefined
  }
}

function getDuplicateField(meta: unknown): string {
  if (typeof meta !== "object" || meta === null || !("target" in meta)) return "unknown"
  const { target } = meta
  return Array.isArray(target) && typeof target[0] === "string" ? target[0] : "unknown"
}

export const handleAdminError = (error: unknown, requestId: string, entity: string): never => {
  const prismaError = getPrismaError(error)
  if (prismaError?.code === "P2002") {
    throw createApiError("DUPLICATE", { requestId, entity, field: getDuplicateField(prismaError.meta) })
  }
  if (prismaError?.code === "P2025") {
    throw createApiError("NOT_FOUND", { requestId, entity })
  }
  if (prismaError?.code === "P2003") {
    throw createApiError("CONFLICT", { requestId, entity, expected: "unreferenced", actual: "referenced" })
  }
  throw error
}

// Утилиты для валидации дат
export const validateDateRange = (dateRange: DateRangeInput, requestId: string) => {
  if (dateRange.from && dateRange.to) {
    const fromDate = new Date(dateRange.from)
    const toDate = new Date(dateRange.to)

    if (isNaN(fromDate.getTime()) || isNaN(toDate.getTime())) {
      throw createApiError("VALIDATION_ERROR", { requestId, field: "dateRange", rule: "iso-date" })
    }

    if (fromDate > toDate) {
      throw createApiError("VALIDATION_ERROR", { requestId, field: "dateRange", rule: "from-before-to" })
    }
  }
}

// Утилиты для поиска
export const validateSearchInput = (search: SearchInput, allowedFields: string[], requestId: string) => {
  if (!search.query.trim()) {
    throw createApiError("VALIDATION_ERROR", { requestId, field: "search.query", rule: "required" })
  }

  if (search.query.length < 2) {
    throw createApiError("VALIDATION_ERROR", { requestId, field: "search.query", rule: "minLength:2" })
  }

  const invalidFields = search.fields.filter((field) => !allowedFields.includes(field))
  if (invalidFields.length > 0) {
    throw createApiError("VALIDATION_ERROR", { requestId, field: "search.fields", rule: "allowed" })
  }
}

// Утилиты для массовых операций
export const validateBulkOperation = (ids: string[], requestId: string, maxItems: number = 100) => {
  if (!ids.length) {
    throw createApiError("VALIDATION_ERROR", { requestId, field: "ids", rule: "required" })
  }

  if (ids.length > maxItems) {
    throw createApiError("VALIDATION_ERROR", { requestId, field: "ids", rule: `maxItems:${maxItems}` })
  }

  // Проверяем, что все ID являются валидными UUID
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
  const invalidIds = ids.filter((id) => !uuidRegex.test(id))

  if (invalidIds.length > 0) {
    throw createApiError("VALIDATION_ERROR", { requestId, field: "ids", rule: "uuid" })
  }
}

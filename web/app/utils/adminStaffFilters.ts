import type {
  AdminStaffExceptionTerm,
  AdminStaffFiltersInput,
  AdminStaffStatus,
  Role
} from "~/graphql/generated/graphql"

// Фильтры раздела «Администраторы» живут в адресе страницы (`docs/spec/40-admin/admins.md` п. 4).

const staffRoles: readonly Role[] = ["editor", "moderator", "analyst", "admin", "owner"]
const terms: readonly AdminStaffExceptionTerm[] = ["indefinite", "expiring"]

export const readStaffFilters = (query: Record<string, unknown>): AdminStaffFiltersInput => {
  const role = typeof query.role === "string" ? query.role : null
  const term = typeof query.term === "string" ? query.term : null
  const search = typeof query.q === "string" ? query.q.trim() : ""

  return {
    role: role && staffRoles.includes(role as Role) ? (role as Role) : null,
    status: (query.status === "archived" ? "archived" : "active") satisfies AdminStaffStatus,
    hasExceptions: query.exceptions === "1" ? true : null,
    term: term && terms.includes(term as AdminStaffExceptionTerm) ? (term as AdminStaffExceptionTerm) : null,
    search: search || null
  }
}

export const staffFiltersToQuery = (filters: AdminStaffFiltersInput): Record<string, string> => {
  const query: Record<string, string> = {}
  if (filters.role) query.role = filters.role
  if (filters.status === "archived") query.status = filters.status
  if (filters.hasExceptions) query.exceptions = "1"
  if (filters.term) query.term = filters.term
  if (filters.search) query.q = filters.search
  return query
}

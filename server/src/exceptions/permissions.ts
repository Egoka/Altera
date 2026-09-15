import { User, Role } from "../generated/prisma"
import { createApiError } from "../errors/graphql-error"

/**
 * Ensures that a user is authenticated.
 * Throws a GraphQLError if the user is not logged in.
 * @param currentUser - The user object from the GraphQL context.
 */
export function ensureAuthenticated(currentUser: User | null, requestId: string): User {
  if (!currentUser) {
    throw createApiError("UNAUTHENTICATED", { requestId })
  }
  return currentUser
}

/**
 * Ensures that an authenticated user has a specific role.
 * Throws a GraphQLError if the user is not logged in or does not have the required role.
 * @param currentUser - The user object from the GraphQL context.
 * @param requiredRole - The role or array of roles required to pass the check.
 */
export function ensureHasRole(
  currentUser: User | null,
  requiredRole: Role | Role[],
  action: string,
  requestId: string
): void {
  const user = ensureAuthenticated(currentUser, requestId)

  const roles = Array.isArray(requiredRole) ? requiredRole : [requiredRole]

  if (!roles.includes(user.role)) {
    throw createApiError("FORBIDDEN", { requestId, action })
  }
}

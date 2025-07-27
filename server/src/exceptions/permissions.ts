import { GraphQLError } from "graphql"
import { User, Role } from "../generated/prisma"

/**
 * Ensures that a user is authenticated.
 * Throws a GraphQLError if the user is not logged in.
 * @param currentUser - The user object from the GraphQL context.
 */
export function ensureAuthenticated(currentUser: User | null): void {
  if (!currentUser) {
    throw new GraphQLError("Authentication required. Please log in.")
  }
}

/**
 * Ensures that an authenticated user has a specific role.
 * Throws a GraphQLError if the user is not logged in or does not have the required role.
 * @param currentUser - The user object from the GraphQL context.
 * @param requiredRole - The role or array of roles required to pass the check.
 */
export function ensureHasRole(currentUser: User | null, requiredRole: Role | Role[]): void {
  ensureAuthenticated(currentUser)

  const roles = Array.isArray(requiredRole) ? requiredRole : [requiredRole]

  if (!roles.includes(currentUser!.role)) {
    throw new GraphQLError("Permission denied. You don't have the required permissions.")
  }
}

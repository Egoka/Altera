type Role = "user" | "admin"

export default interface User {
  id: string
  name: string
  email: string
  bio?: string
  photoUrl?: string
  role: Role
  slug: string
  socialLinks?: Record<string, string>
  createdAt: string
  updatedAt: string
}

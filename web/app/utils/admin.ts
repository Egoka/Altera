import type { GetAdminSummaryQuery, Role } from "~/graphql/generated/graphql"

export interface AdminNavigationItem {
  id: string
  icon: string
  to: string
}

const sections: Record<string, AdminNavigationItem> = {
  dashboard: { id: "dashboard", icon: "lucide:layout-dashboard", to: "/admin" },
  categories: { id: "categories", icon: "lucide:layers", to: "/admin/categories" },
  tags: { id: "tags", icon: "lucide:tag", to: "/admin/tags" },
  articles: { id: "articles", icon: "lucide:file-text", to: "/admin/articles" },
  review: { id: "review", icon: "lucide:clipboard-check", to: "/admin/review" },
  users: { id: "users", icon: "lucide:users", to: "/admin/users" },
  admins: { id: "admins", icon: "lucide:shield-check", to: "/admin/admins" },
  subscriptions: { id: "subscriptions", icon: "lucide:badge-check", to: "/admin/subscriptions" },
  payments: { id: "payments", icon: "lucide:credit-card", to: "/admin/payments" },
  grants: { id: "grants", icon: "lucide:ticket-check", to: "/admin/grants" },
  statistics: { id: "statistics", icon: "lucide:chart-no-axes-combined", to: "/admin/statistics" },
  jobs: { id: "jobs", icon: "lucide:list-checks", to: "/admin/jobs" },
  ai: { id: "ai", icon: "lucide:sparkles", to: "/admin/ai" },
  ranking: { id: "ranking", icon: "lucide:chart-spline", to: "/admin/ranking" },
  audit: { id: "audit", icon: "lucide:notebook-tabs", to: "/admin/audit" },
  mail: { id: "mail", icon: "lucide:mail", to: "/admin/mail" },
  errors: { id: "errors", icon: "lucide:circle-alert", to: "/admin/errors" },
  legal: { id: "legal", icon: "lucide:scale", to: "/admin/legal" },
  settings: { id: "settings", icon: "lucide:settings", to: "/admin/settings" }
}

const roleSectionIds: Partial<Record<Role, readonly string[]>> = {
  editor: ["dashboard", "articles", "mail", "audit"],
  moderator: ["dashboard", "review", "ai", "audit", "mail"],
  analyst: ["dashboard", "users", "subscriptions", "payments", "grants", "statistics", "ai", "audit", "mail"],
  admin: [
    "dashboard",
    "categories",
    "tags",
    "users",
    "admins",
    "subscriptions",
    "payments",
    "grants",
    "statistics",
    "jobs",
    "ai",
    "audit",
    "mail",
    "errors",
    "legal",
    "settings"
  ],
  owner: [
    "dashboard",
    "categories",
    "tags",
    "articles",
    "review",
    "users",
    "admins",
    "subscriptions",
    "payments",
    "grants",
    "statistics",
    "jobs",
    "ai",
    "ranking",
    "audit",
    "mail",
    "errors",
    "legal",
    "settings"
  ]
}

export const getAdminNavigation = (role: Role): AdminNavigationItem[] =>
  (roleSectionIds[role] ?? []).flatMap((id) => (sections[id] ? [sections[id]] : []))

export const parseAdminPeriod = (value: unknown): 7 | 30 => (value === "30d" ? 30 : 7)

interface GraphQLErrorLike {
  extensions?: Record<string, unknown> | null
}

interface AdminSummaryEnvelope {
  data?: { adminSummary?: GetAdminSummaryQuery["adminSummary"] | null } | null
  errors?: readonly GraphQLErrorLike[]
}

export type AdminAccessDecision =
  | { kind: "allow"; summary: GetAdminSummaryQuery["adminSummary"] }
  | { kind: "redirect"; to: string }
  | { kind: "forbidden" }
  | { kind: "error"; requestId: string | null }

export const getAdminAccessDecision = (envelope: AdminSummaryEnvelope, target: string): AdminAccessDecision => {
  if (envelope.data?.adminSummary) return { kind: "allow", summary: envelope.data.adminSummary }

  const extensions = envelope.errors?.[0]?.extensions
  if (extensions?.code === "UNAUTHENTICATED") {
    return { kind: "redirect", to: `/login?next=${encodeURIComponent(target)}` }
  }
  if (extensions?.code === "FORBIDDEN") return { kind: "forbidden" }

  return { kind: "error", requestId: typeof extensions?.requestId === "string" ? extensions.requestId : null }
}

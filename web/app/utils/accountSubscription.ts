import type { GetAccountSubscriptionQuery } from "~/graphql/generated/graphql"

export type SubscriptionAccount = NonNullable<GetAccountSubscriptionQuery["me"]>

interface GraphQLEnvelope {
  data?: GetAccountSubscriptionQuery | null
  errors?: readonly { extensions?: Record<string, unknown> | null }[]
}

/**
 * Итог чтения страницы «Подписка» (`docs/spec/30-account/reader/subscription.md` §3, §8):
 * `archived` — ограниченная сессия уходит на `/me/archived`, `signIn` — API сессию не признал,
 * `error` — «Ошибка данных» с кодом запроса.
 */
export type SubscriptionOutcome =
  | { kind: "ready"; account: SubscriptionAccount }
  | { kind: "archived" }
  | { kind: "signIn" }
  | { kind: "error"; requestId: string | null }

// Подписка есть только у личных ролей: служебная запись планы не приобретает (журнал §8.17).
const personalRoles = new Set(["reader", "author"])

export function resolveSubscriptionOutcome(envelope: GraphQLEnvelope): SubscriptionOutcome {
  const account = envelope.data?.me
  const extensions = envelope.errors?.[0]?.extensions
  if (!account) {
    if (extensions?.code === "FORBIDDEN") return { kind: "archived" }
    if (extensions?.code === "UNAUTHENTICATED") return { kind: "signIn" }
  }

  const personal = account ? personalRoles.has(account.role) : false
  if (!account || envelope.errors?.length || (personal && !account.subscription)) {
    return { kind: "error", requestId: typeof extensions?.requestId === "string" ? extensions.requestId : null }
  }

  return { kind: "ready", account }
}

/**
 * Вариант зоны 2 на первом запуске (§5 п. 2, §8): `base` — базовый план без оплаты (журнал
 * §24.1), в том числе у аккаунта без выдач; `active` — выдача со сроком; `expired` — выдача
 * закончилась («Ограничение плана»); `service` — служебная запись (§8.17). Вариантов «оплачен»,
 * «отменён с конца периода» и «серия списаний» нет: платежей до включения платности не бывает.
 */
export type SubscriptionView = "base" | "active" | "expired" | "service"

export function subscriptionView(account: SubscriptionAccount): SubscriptionView {
  if (!personalRoles.has(account.role) || !account.subscription) return "service"
  const { state } = account.subscription
  if (state === "active" || state === "expired") return state
  return "base"
}

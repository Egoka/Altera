// Каркас страницы «Цены и планы» в режиме первого запуска.
//
// Первый запуск идёт без платности (журнал §24.1, `docs/spec/20-public/pricing.md` §1):
// страница показывает планы и их будущие возможности, но ни цен, ни кнопок оплаты на ней нет,
// промокод здесь не проверяется. Поэтому каталог не ходит в `plans(locale)` — этот запрос
// существует ради цен и появится вместе с платностью. Состав карточек, сравнения и FAQ берётся
// из словаря локали (`pricing.md` §12: «Состав FAQ и тексты возможностей — из словаря локали»),
// а здесь описан только его каркас: порядок планов, доступность на запуске и ключи строк.

export type PricingPlanTier = "free" | "standard" | "pro"

/** `now` — план работает на первом запуске; `later` — «платные планы появятся позже». */
export type PricingLaunchAvailability = "now" | "later"

export interface PricingLaunchPlan {
  tier: PricingPlanTier
  availability: PricingLaunchAvailability
  /** Суффиксы ключей `pricing.plans.<tier>.features.<key>` в порядке показа. */
  features: readonly string[]
}

/**
 * Возможности планов по `pricing.md` §5 и журналу #31, #33: без чисел, позиций в выдаче и
 * описания формулы рейтинга — про `pro` сказано только про усиление видимости и статуса автора
 * (журнал §20.13). Полный перечень условий каждого плана проектируется отдельно (§20.14).
 */
export const PRICING_LAUNCH_PLANS: readonly PricingLaunchPlan[] = [
  { tier: "free", availability: "now", features: ["read", "bookmarks", "follow"] },
  { tier: "standard", availability: "later", features: ["write", "editor", "media", "translation"] },
  { tier: "pro", availability: "later", features: ["standard", "visibility", "aiTranslation", "stats", "tools"] }
]

export interface PricingCompareRow {
  /** Суффикс ключа `pricing.compare.rows.<key>`. */
  key: string
  included: Readonly<Record<PricingPlanTier, boolean>>
}

/**
 * Сравнение (`pricing.md` §5 зона 4) на запуске показывает только состав возможностей.
 * Лимиты плана (очередь, медиа) — гипотезы `plans.md` с числами и относятся к платному этапу,
 * поэтому в таблицу запуска они не попадают.
 */
export const PRICING_COMPARE_ROWS: readonly PricingCompareRow[] = [
  { key: "read", included: { free: true, standard: true, pro: true } },
  { key: "bookmarks", included: { free: true, standard: true, pro: true } },
  { key: "follow", included: { free: true, standard: true, pro: true } },
  { key: "write", included: { free: false, standard: true, pro: true } },
  { key: "editor", included: { free: false, standard: true, pro: true } },
  { key: "media", included: { free: false, standard: true, pro: true } },
  { key: "translation", included: { free: false, standard: true, pro: true } },
  { key: "aiTranslation", included: { free: false, standard: false, pro: true } },
  { key: "stats", included: { free: false, standard: false, pro: true } },
  { key: "visibility", included: { free: false, standard: false, pro: true } }
]

/** Суффиксы ключей `pricing.faq.items.<key>` — 6 вопросов (`pricing.md` §5 зона 6). */
export const PRICING_FAQ_KEYS: readonly string[] = [
  "whyAccount",
  "howToWrite",
  "prices",
  "myArticles",
  "moderation",
  "refunds"
]

/**
 * Состояния страницы (`pricing.md` §8), достижимые на первом запуске.
 * `ready` — обычная публичная страница; `empty` — каталог планов пуст, это ошибка конфигурации
 * словаря, и страница показывает `ErrorState` «планы временно недоступны».
 */
export type PricingLaunchState = "ready" | "empty"

export const resolvePricingLaunchState = (plans: readonly PricingLaunchPlan[]): PricingLaunchState =>
  plans.length > 0 ? "ready" : "empty"

const HIGHLIGHTABLE_TIERS: readonly PricingPlanTier[] = ["standard", "pro"]

/**
 * `?plan=standard|pro` подсвечивает карточку (`pricing.md` §3).
 * Неверные значения query игнорируются — подсветки просто нет.
 */
export const resolveHighlightedPlan = (value: unknown): PricingPlanTier | null => {
  const candidate = Array.isArray(value) ? value[0] : value
  return HIGHLIGHTABLE_TIERS.find((tier) => tier === candidate) ?? null
}

/**
 * Страница с `?promo=` закрыта от индексации (`pricing.md` §3, §10).
 * Сам промокод здесь не проверяется: это работа checkout, отложенного до платности.
 */
export const hasPromoQuery = (query: Record<string, unknown>): boolean => {
  const promo = query.promo
  const candidate = Array.isArray(promo) ? promo[0] : promo
  return typeof candidate === "string" && candidate.trim().length > 0
}

/** Канонический адрес — `/pricing` без query (`pricing.md` §10); у `en` — префикс локали. */
export const pricingCanonicalPath = (locale: string): string => (locale === "en" ? "/en/pricing" : "/pricing")

/**
 * Единые пороги серверных лимитов частоты — `docs/spec/50-access/rate-limits.md` §2.
 *
 * Лимит — серверное правило защиты от перегрузки и злоупотреблений, а не право роли: значения
 * одинаковы для гостя, `reader` и `owner`, персональных исключений нет ни повышенных, ни
 * снятых (журнал #57, `rate-limits.md` §2 п. 15, §3). Поэтому ни правило, ни его поиск не
 * принимают роль, аккаунт или исключение права: единственный аргумент — значение ключа корзины.
 * Реестр заморожен, чтобы порог нельзя было поднять во время работы процесса.
 *
 * Числа пришли из спецификации и повторены без изменений и без добавленных — корзины, для
 * которых спецификация числа не даёт, в реестр не попадают (см. ниже). Владелец утвердил их
 * целиком вместе с недостающими RL-14 и RL-15 (журнал §44 п. 1 по предложению
 * `docs/reports/2026-09-27-t116-rate-limit-thresholds-proposal.md`), поэтому пометка
 * `[ДОПУЩЕНИЕ]` с них снята; перенос утверждённых чисел в текст `rate-limits.md` §2 идёт
 * отдельной задачей.
 */

const MINUTE = 60
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

/** Чем именуется корзина: адрес до аутентификации, e-mail входа или аккаунт (§2 п. 2). */
export type RateLimitKeyKind = "ip" | "email" | "user"

export interface RateLimitRule {
  readonly bucket: RateLimitBucket
  readonly keyKind: RateLimitKeyKind
  readonly limit: number
  readonly windowSeconds: number
  /** Пункт `rate-limits.md`, из которого взяты порог и окно. */
  readonly source: string
  /**
   * Корневые поля GraphQL, которые проверяет одно middleware до резолвера (§2 п. 13).
   * Непустой список бывает только у `ip`-правил: они применяются до аутентификации.
   * Корзины по e-mail и аккаунту применяет хелпер в резолвере — после проверки прав
   * (`permission-checks.md` §2 п. 3: лимиты — последними).
   */
  readonly middlewareFields: readonly string[]
}

/*
 * Корзины, которых здесь нет намеренно — спецификация не даёт им числа, а выдумывать порог
 * задача не вправе: события вовлечённости (§2 п. 6 — стартовое значение отнесено к
 * эксплуатационной конфигурации), жалобы (§2 п. 5 — отложены до разбора сценария), AI и
 * переводы (§2 п. 11 — параметры Г4). Административные действия числом не лимитируются
 * вовсе (§2 п. 12), кроме экспорта CSV.
 */
const rules = {
  // §2 п. 3, ADR-0024: запрос ссылки входа — по адресу и по IP одновременно. Ту же корзину
  // адреса расходуют письма ветки пароля: подтверждение адреса и сброс.
  "auth.link.email": {
    bucket: "auth.link.email",
    keyKind: "email",
    limit: 5,
    windowSeconds: HOUR,
    source: "rate-limits.md §2 п. 3",
    middlewareFields: []
  },
  /*
   * Регистрация с паролем и запрос сброса ставят в очередь такое же письмо на введённый адрес,
   * что и запрос ссылки, и своего числа спецификация им не даёт: они делят корзину запроса
   * ссылки, а не получают выдуманный порог (§2 п. 3).
   */
  "auth.link.ip": {
    bucket: "auth.link.ip",
    keyKind: "ip",
    limit: 20,
    windowSeconds: HOUR,
    source: "rate-limits.md §2 п. 3",
    middlewareFields: ["requestMagicLink", "registerWithPassword", "requestPasswordReset"]
  },
  // §2 п. 3: подтверждение ссылки. `acceptConsent` — та же ветка обмена токена входа.
  "auth.verify.ip": {
    bucket: "auth.verify.ip",
    keyKind: "ip",
    limit: 10,
    windowSeconds: HOUR,
    source: "rate-limits.md §2 п. 3",
    middlewareFields: ["verifyMagicLink", "acceptConsent"]
  },
  /*
   * §2 п. 3, RL-14 и RL-15 утверждённого предложения T-116 (журнал §44 п. 1): неуспешный вход
   * по паролю. Считаются только неуспешные проверки пароля, успешный вход очищает корзину
   * адреса, а запрос отклоняется при исчерпании любой из двух корзин. Поэтому обе применяет
   * резолвер, а не middleware: до проверки пароля исход попытки неизвестен.
   */
  "auth.password.email": {
    bucket: "auth.password.email",
    keyKind: "email",
    limit: 5,
    windowSeconds: 15 * MINUTE,
    source: "rate-limits.md §2 п. 3 (RL-14, журнал §44 п. 1)",
    middlewareFields: []
  },
  "auth.password.ip": {
    bucket: "auth.password.ip",
    keyKind: "ip",
    limit: 30,
    windowSeconds: 15 * MINUTE,
    source: "rate-limits.md §2 п. 3 (RL-15, журнал §44 п. 1)",
    middlewareFields: []
  },
  // §2 п. 4: письмо в редакцию (`pages.md` #14). Та же мутация отправляет «битую ссылку» со
  // страницы 404: отдельного порога для неё реестр не задаёт, поэтому корзина общая.
  "contact.ip": {
    bucket: "contact.ip",
    keyKind: "ip",
    limit: 3,
    windowSeconds: HOUR,
    source: "rate-limits.md §2 п. 4",
    middlewareFields: ["createSupportRequest"]
  },
  "contact.user": {
    bucket: "contact.user",
    keyKind: "user",
    limit: 10,
    windowSeconds: DAY,
    source: "rate-limits.md §2 п. 4",
    middlewareFields: []
  },
  // §2 п. 7: поиск — этап 3, точка применения появится вместе со страницей поиска.
  "search.ip": {
    bucket: "search.ip",
    keyKind: "ip",
    limit: 60,
    windowSeconds: MINUTE,
    source: "rate-limits.md §2 п. 7",
    middlewareFields: []
  },
  "search.user": {
    bucket: "search.user",
    keyKind: "user",
    limit: 300,
    windowSeconds: MINUTE,
    source: "rate-limits.md §2 п. 7",
    middlewareFields: []
  },
  // §2 п. 8: мутации кабинета (закладки, профиль), отдельные корзины смены адреса и запроса
  // самостоятельного архивирования аккаунта.
  "account.mutation.user": {
    bucket: "account.mutation.user",
    keyKind: "user",
    limit: 60,
    windowSeconds: MINUTE,
    source: "rate-limits.md §2 п. 8",
    middlewareFields: []
  },
  "account.email_change.user": {
    bucket: "account.email_change.user",
    keyKind: "user",
    limit: 1,
    windowSeconds: DAY,
    source: "rate-limits.md §2 п. 8",
    middlewareFields: []
  },
  "account.archive.user": {
    bucket: "account.archive.user",
    keyKind: "user",
    limit: 1,
    windowSeconds: DAY,
    source: "rate-limits.md §2 п. 8",
    middlewareFields: []
  },
  // §2 п. 9: загрузка медиа. Квота объёма идёт по плану и отвечает `PLAN_LIMIT`, не `RATE_LIMITED`.
  "media.upload.user": {
    bucket: "media.upload.user",
    keyKind: "user",
    limit: 30,
    windowSeconds: HOUR,
    source: "rate-limits.md §2 п. 9",
    middlewareFields: []
  },
  // §2 п. 12: экспорт CSV сотрудником — единственное лимитируемое административное действие.
  "admin.export.user": {
    bucket: "admin.export.user",
    keyKind: "user",
    limit: 10,
    windowSeconds: HOUR,
    source: "rate-limits.md §2 п. 12",
    middlewareFields: []
  },
  // §2 п. 14: открытие формы оспаривания блокировки (матрица #114).
  "appeal.form.ip": {
    bucket: "appeal.form.ip",
    keyKind: "ip",
    limit: 10,
    windowSeconds: HOUR,
    source: "rate-limits.md §2 п. 14",
    middlewareFields: []
  }
} as const satisfies Record<string, Omit<RateLimitRule, "bucket"> & { bucket: string }>

export type RateLimitBucket = keyof typeof rules

export const RATE_LIMIT_BUCKETS = Object.keys(rules) as readonly RateLimitBucket[]

export const RATE_LIMIT_RULES: Readonly<Record<RateLimitBucket, RateLimitRule>> = Object.freeze(
  Object.fromEntries(
    Object.entries(rules).map(([bucket, rule]) => [
      bucket,
      Object.freeze({ ...rule, middlewareFields: Object.freeze([...rule.middlewareFields]) })
    ])
  )
) as Readonly<Record<RateLimitBucket, RateLimitRule>>

const middlewareRulesByField = new Map<string, readonly RateLimitRule[]>()
for (const rule of Object.values(RATE_LIMIT_RULES)) {
  for (const field of rule.middlewareFields) {
    middlewareRulesByField.set(field, [...(middlewareRulesByField.get(field) ?? []), rule])
  }
}

/**
 * Правила, которые middleware применяет к корневому полю операции. Роль вызывающего в поиск
 * не входит намеренно: лимит от роли не зависит (§2 п. 15).
 */
export function middlewareRulesForField(field: string): readonly RateLimitRule[] {
  return middlewareRulesByField.get(field) ?? []
}

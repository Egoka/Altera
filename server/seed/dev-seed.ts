/**
 * Наполнение локальной базы разработки разнообразными данными.
 *
 * Поверх детерминированного сида T-007 (`seed.ts`: учётные записи `seed-*@example.test`,
 * базовые рубрики, форматы и теги) создаёт сотни пользователей, материалов, языковых версий,
 * ревизий, переписки, медиа, заданий, писем, ошибок, юридических текстов, аудита и обращений —
 * чтобы кабинет, ленты и все разделы админки показывали реалистичные состояния.
 *
 * Только для локальной базы: скрипт отказывается работать с нелокальным хостом и с базой,
 * в которой уже есть материалы сверх сида. Полный цикл пересоздания — `pnpm run db:dev`.
 * Данные псевдослучайные, но воспроизводимые: генератор инициализируется фиксированным зерном.
 */
import crypto from "node:crypto"
import {
  AccountArchiveMode,
  AiProcessKind,
  AiProcessStatus,
  ArticleRevisionKind,
  ArticleStatus,
  BackendErrorService,
  BackendErrorWorkStatus,
  ErrorStream,
  JobStatus,
  LegalTextKind,
  LegalTextStatus,
  Locale,
  MailDeliveryStatus,
  MediaLicense,
  MediaProcessingStatus,
  PermissionExceptionKind,
  PlanTier,
  Prisma,
  PrismaClient,
  ProfileCheckStatus,
  ReviewMessageKind,
  Role,
  SupportTopic,
  TaxonomyStatus
} from "../src/generated/prisma"
import { masterKey, variantKey } from "../src/storage/keys"
import { createMediaWriter, inPool, renderAvatar, renderCover } from "./dev-media"
import { seedDatabase } from "./seed"

const prisma = new PrismaClient()

// Те же значения по умолчанию, что у адаптера хранилища (`src/storage/config.ts`).
const STORAGE_ROOT = process.env.STORAGE_LOCAL_DIR || ".storage"
const MEDIA_BASE_URL = (
  process.env.STORAGE_MEDIA_BASE_URL || `http://localhost:${process.env.PORT || 4000}/media`
).replace(/\/+$/, "")

interface MediaSpec {
  id: string
  key: string
  purpose: "cover" | "avatar" | "library"
  width: number
  height: number
  status: MediaProcessingStatus
  variants: { width: number; format: string; key: string }[]
  seed: number
  paletteIndex: number
}

// ---------------------------------------------------------------------------
// Генератор и утилиты
// ---------------------------------------------------------------------------

let rngState = 20260927
function rand(): number {
  rngState = (rngState + 0x6d2b79f5) | 0
  let t = rngState
  t = Math.imul(t ^ (t >>> 15), t | 1)
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296
}
const int = (min: number, max: number): number => min + Math.floor(rand() * (max - min + 1))
const chance = (p: number): boolean => rand() < p
const pick = <T>(items: readonly T[]): T => items[Math.floor(rand() * items.length)]
const pickMany = <T>(items: readonly T[], count: number): T[] => {
  const pool = [...items]
  const result: T[] = []
  while (result.length < count && pool.length > 0) result.push(pool.splice(Math.floor(rand() * pool.length), 1)[0])
  return result
}
const weighted = <T>(entries: readonly (readonly [T, number])[]): T => {
  const total = entries.reduce((sum, [, weight]) => sum + weight, 0)
  let roll = rand() * total
  for (const [value, weight] of entries) {
    roll -= weight
    if (roll <= 0) return value
  }
  return entries[entries.length - 1][0]
}

const uuid = (): string => crypto.randomUUID()
const hex = (bytes = 32): string => crypto.randomBytes(bytes).toString("hex")

const NOW = new Date()
const DAY = 24 * 60 * 60 * 1000
const daysAgo = (days: number): Date => new Date(NOW.getTime() - days * DAY - int(0, DAY / 1000) * 1000)
const daysAhead = (days: number): Date => new Date(NOW.getTime() + days * DAY)
const after = (date: Date, minMinutes: number, maxMinutes: number): Date =>
  new Date(date.getTime() + int(minMinutes, maxMinutes) * 60 * 1000)

const TRANSLIT: Record<string, string> = {
  а: "a",
  б: "b",
  в: "v",
  г: "g",
  д: "d",
  е: "e",
  ё: "e",
  ж: "zh",
  з: "z",
  и: "i",
  й: "i",
  к: "k",
  л: "l",
  м: "m",
  н: "n",
  о: "o",
  п: "p",
  р: "r",
  с: "s",
  т: "t",
  у: "u",
  ф: "f",
  х: "h",
  ц: "ts",
  ч: "ch",
  ш: "sh",
  щ: "sch",
  ъ: "",
  ы: "y",
  ь: "",
  э: "e",
  ю: "yu",
  я: "ya"
}
const slugify = (text: string, max = 60): string =>
  text
    .toLowerCase()
    .split("")
    .map((char) => TRANSLIT[char] ?? char)
    .join("")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, max)
    .replace(/-+$/g, "")

const sentence = (parts: readonly string[]): string => parts.join(" ")

// ---------------------------------------------------------------------------
// Словари
// ---------------------------------------------------------------------------

const FIRST_NAMES_M = [
  "Алексей",
  "Иван",
  "Дмитрий",
  "Максим",
  "Никита",
  "Артём",
  "Сергей",
  "Павел",
  "Егор",
  "Михаил",
  "Фёдор",
  "Лев",
  "Роман",
  "Глеб",
  "Тимофей",
  "Андрей",
  "Кирилл",
  "Олег"
]
const FIRST_NAMES_F = [
  "Анна",
  "Мария",
  "Елена",
  "Дарья",
  "Ольга",
  "Софья",
  "Алиса",
  "Вера",
  "Полина",
  "Ксения",
  "Ирина",
  "Татьяна",
  "Юлия",
  "Варвара",
  "Екатерина",
  "Нина",
  "Людмила",
  "Злата"
]
const LAST_NAMES = [
  "Иванов",
  "Смирнов",
  "Кузнецов",
  "Попов",
  "Соколов",
  "Лебедев",
  "Козлов",
  "Новиков",
  "Морозов",
  "Волков",
  "Зайцев",
  "Павлов",
  "Семёнов",
  "Голубев",
  "Виноградов",
  "Богданов",
  "Воробьёв",
  "Фёдоров",
  "Михайлов",
  "Беляев",
  "Тарасов",
  "Белов",
  "Комаров",
  "Орлов",
  "Киселёв",
  "Макаров",
  "Андреев",
  "Ковалёв",
  "Ильин",
  "Гусев"
]
const EN_FIRST = ["Oliver", "Emma", "Liam", "Ava", "Noah", "Mia", "Lucas", "Isla", "Leo", "Grace", "Hugo", "Chloe"]
const EN_LAST = ["Walker", "Bennett", "Hughes", "Foster", "Reed", "Carter", "Ellis", "Hayes", "Morgan", "Price"]

const BIOS = [
  "Пишу о том, что вижу в дороге и в людях.",
  "Фотограф и исследователь городской среды.",
  "Музыкальный критик, слушаю всё от барокко до техно.",
  "Историк по образованию, журналист по призванию.",
  "Люблю длинные тексты и короткие заголовки.",
  "Собираю истории маленьких музеев.",
  "Бегаю марафоны и пишу про спорт без пафоса.",
  "Архитектор, рассказываю о зданиях, которые мы не замечаем.",
  "Готовлю, путешествую, записываю рецепты из поездок.",
  "Писатель, преподаватель литературного мастерства."
]

interface SectionTopic {
  slug: string
  ru: string[]
  en: string[]
}
const SECTION_TOPICS: SectionTopic[] = [
  {
    slug: "culture",
    ru: [
      "городские фестивали",
      "культура чтения",
      "домашние архивы",
      "уличные библиотеки",
      "провинциальные театры",
      "новая этика в искусстве"
    ],
    en: ["city festivals", "reading culture", "family archives", "street libraries"]
  },
  {
    slug: "art",
    ru: [
      "современная керамика",
      "уличное искусство",
      "частные галереи",
      "реставрация икон",
      "цифровая живопись",
      "художественные резиденции"
    ],
    en: ["contemporary ceramics", "street art", "private galleries", "digital painting"]
  },
  {
    slug: "photography",
    ru: [
      "плёночная фотография",
      "портрет на улице",
      "ночная съёмка",
      "фотоархивы семей",
      "пейзаж Русского Севера",
      "документальная серия"
    ],
    en: ["film photography", "street portraits", "night photography", "documentary series"]
  },
  {
    slug: "music",
    ru: [
      "камерная музыка",
      "электронная сцена",
      "виниловые магазины",
      "джаз в провинции",
      "хоровое пение",
      "саундтреки к играм"
    ],
    en: ["chamber music", "electronic scene", "record shops", "regional jazz"]
  },
  {
    slug: "sport",
    ru: [
      "любительский марафон",
      "северная ходьба",
      "дворовый футбол",
      "шахматы в парках",
      "скалолазание",
      "лыжные гонки"
    ],
    en: ["amateur marathons", "street football", "park chess", "climbing"]
  },
  {
    slug: "travel",
    ru: [
      "Байкал зимой",
      "дорога на Алтай",
      "малые города Золотого кольца",
      "Калининградская коса",
      "Кольский полуостров",
      "Дагестанские аулы"
    ],
    en: ["winter Baikal", "the road to Altai", "the Curonian Spit", "the Kola Peninsula"]
  },
  {
    slug: "cinema",
    ru: ["авторское кино", "советская анимация", "кинофестивали", "документальное кино", "сериалы о семье"],
    en: ["arthouse cinema", "Soviet animation", "film festivals", "documentary film"]
  },
  {
    slug: "literature",
    ru: ["новая проза", "переводная поэзия", "литературные премии", "детская книга", "дневники писателей"],
    en: ["new prose", "poetry in translation", "literary prizes", "writers' diaries"]
  },
  {
    slug: "architecture",
    ru: ["деревянный модерн", "советский модернизм", "дворы-колодцы", "новые библиотеки", "заброшенные усадьбы"],
    en: ["wooden art nouveau", "Soviet modernism", "new libraries", "abandoned estates"]
  },
  {
    slug: "science",
    ru: ["наука о сне", "городская экология", "история медицины", "астрономия для всех", "нейросети и язык"],
    en: ["sleep science", "urban ecology", "history of medicine", "astronomy for everyone"]
  },
  {
    slug: "food",
    ru: ["северная кухня", "домашняя выпечка", "рынки выходного дня", "ферментация", "кофе обжарки"],
    en: ["northern cuisine", "home baking", "weekend markets", "fermentation"]
  },
  {
    slug: "design",
    ru: ["шрифты в городе", "дизайн упаковки", "интерфейсы музеев", "советский плакат", "мебель из фанеры"],
    en: ["city typography", "packaging design", "museum interfaces", "Soviet posters"]
  }
]

const TITLE_PATTERNS_RU = [
  (s: string) => `${cap(s)}: взгляд изнутри`,
  (s: string) => `Почему все снова говорят про ${s}`,
  (s: string) => `Пять вещей, которые стоит знать: ${s}`,
  (s: string) => `${cap(s)} — заметки на полях`,
  (s: string) => `Что осталось за кадром. ${cap(s)}`,
  (s: string) => `Разговор о главном: ${s}`,
  (s: string) => `${cap(s)} без глянца`,
  (s: string) => `Один день: ${s}`,
  (s: string) => `Как устроены ${s} на самом деле`,
  (s: string) => `${cap(s)}. Путеводитель для начинающих`,
  (s: string) => `Десять лет спустя: ${s}`,
  (s: string) => `Тихая революция: ${s}`
]
const TITLE_PATTERNS_EN = [
  (s: string) => `${cap(s)}: a view from the inside`,
  (s: string) => `Why everyone is talking about ${s} again`,
  (s: string) => `Five things to know about ${s}`,
  (s: string) => `${cap(s)}, without the gloss`,
  (s: string) => `A beginner's guide to ${s}`,
  (s: string) => `Ten years later: ${s}`
]
const SENTENCES_RU = [
  "Мы провели здесь неделю и увидели совсем не то, что ожидали.",
  "Эта история началась случайно, с разговора в очереди за кофе.",
  "Главное здесь — люди, которые продолжают делать своё дело без громких слов.",
  "Цифры говорят одно, но стоит пройтись по улицам, и картина меняется.",
  "Каждый из героев по-своему отвечает на вопрос, зачем всё это нужно.",
  "Архивные снимки помогают понять, как быстро меняется привычное.",
  "Эксперты расходятся в оценках, и это, пожалуй, самое интересное.",
  "Иногда лучший способ разобраться — просто задать простой вопрос.",
  "За последние годы многое изменилось, но суть осталась прежней.",
  "Мы попросили читателей поделиться своими наблюдениями, и получили сотни писем.",
  "Без этой детали картина была бы неполной.",
  "Здесь нет готовых ответов, зато много хороших вопросов.",
  "Первое впечатление обманчиво: за фасадом скрывается целая система.",
  "Эта практика пришла из девятнадцатого века и неожиданно прижилась.",
  "В конце разговора герой признался, что сам не ожидал такого результата."
]
const SENTENCES_EN = [
  "We spent a week there and saw something entirely unexpected.",
  "The story began by chance, with a conversation in a coffee queue.",
  "What matters most are the people who keep doing the work quietly.",
  "The numbers tell one story, but a walk through the streets tells another.",
  "Archive photographs show how quickly the familiar changes.",
  "Experts disagree, and that is perhaps the most interesting part.",
  "Much has changed in recent years, but the essence remains."
]
const TAG_WORDS: [string, string][] = [
  ["интервью", "interview"],
  ["история", "history"],
  ["люди", "people"],
  ["места", "places"],
  ["москва", "moscow"],
  ["петербург", "saint-petersburg"],
  ["сибирь", "siberia"],
  ["север", "north"],
  ["юг", "south"],
  ["музеи", "museums"],
  ["выставки", "exhibitions"],
  ["фестивали", "festivals"],
  ["книги", "books"],
  ["поэзия", "poetry"],
  ["джаз", "jazz"],
  ["винил", "vinyl"],
  ["плёнка", "film"],
  ["портрет", "portrait"],
  ["пейзаж", "landscape"],
  ["урбанистика", "urbanism"],
  ["экология", "ecology"],
  ["еда", "food"],
  ["рецепты", "recipes"],
  ["походы", "hiking"],
  ["горы", "mountains"],
  ["море", "sea"],
  ["зима", "winter"],
  ["лето", "summer"],
  ["ремёсла", "crafts"],
  ["дизайн", "design"],
  ["шрифты", "type"],
  ["кино", "cinema"],
  ["анимация", "animation"],
  ["театр", "theatre"],
  ["танец", "dance"],
  ["наука", "science"],
  ["космос", "space"],
  ["медицина", "medicine"],
  ["образование", "education"],
  ["дети", "kids"],
  ["семья", "family"],
  ["архивы", "archives"],
  ["реставрация", "restoration"],
  ["модернизм", "modernism"],
  ["усадьбы", "estates"]
]
const USER_AGENTS = [
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_6) AppleWebKit/605.1.15 Safari/605.1.15",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/128.0 Safari/537.36",
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148",
  "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/128.0 Mobile Safari/537.36",
  "Mozilla/5.0 (X11; Linux x86_64; rv:130.0) Gecko/20100101 Firefox/130.0"
]

function cap(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1)
}

const bodyDocument = (title: string, locale: Locale): string => {
  const pool = locale === Locale.en ? SENTENCES_EN : SENTENCES_RU
  const children: Record<string, unknown>[] = [{ type: "paragraph", text: sentence(pickMany(pool, 3)) }]
  const blocks = int(2, 6)
  for (let block = 0; block < blocks; block += 1) {
    if (chance(0.4)) children.push({ type: "heading", level: 2, text: `${title.split(":")[0]} — ${block + 1}` })
    children.push({ type: "paragraph", text: sentence(pickMany(pool, int(2, 4))) })
    if (chance(0.15)) children.push({ type: "quote", text: pick(pool) })
  }
  return JSON.stringify({ type: "root", children })
}

// ---------------------------------------------------------------------------
// Защита от запуска не на локальной базе
// ---------------------------------------------------------------------------

function assertLocalDatabase(): void {
  const raw = process.env.DATABASE_URL
  if (!raw) throw new Error("DATABASE_URL не задан")
  const url = new URL(raw)
  if (!["localhost", "127.0.0.1", "::1"].includes(url.hostname)) {
    throw new Error(`dev-seed работает только с локальной базой, а DATABASE_URL указывает на ${url.hostname}`)
  }
}

// ---------------------------------------------------------------------------
// Основной сценарий
// ---------------------------------------------------------------------------

interface SeedUser {
  id: string
  role: Role
  isServiceAccount: boolean
  locale: Locale
  email: string
  archived: boolean
  createdAt: Date
}

async function main(): Promise<void> {
  assertLocalDatabase()

  const existingArticles = await prisma.article.count({ where: { NOT: { id: { startsWith: "t007-" } } } })
  if (existingArticles > 0) {
    throw new Error("В базе уже есть материалы сверх сида T-007. Пересоздайте базу: pnpm run db:dev")
  }

  console.log("1/12 сид T-007")
  await seedDatabase(prisma)

  const owner = await prisma.user.findUniqueOrThrow({ where: { id: "t007-user-owner" } })

  // ----- Пользователи -------------------------------------------------------
  console.log("2/12 пользователи")
  const users: SeedUser[] = (
    await prisma.user.findMany({
      select: { id: true, role: true, isServiceAccount: true, locale: true, email: true, createdAt: true }
    })
  ).map((user) => ({ ...user, archived: false }))
  const usedHandles = new Set(users.map((user) => user.email.split("@")[0]))
  const handleRows: Prisma.HandleHistoryCreateManyInput[] = []
  const userRows: Prisma.UserCreateManyInput[] = []

  const makePerson = (role: Role, index: number) => {
    const english = chance(0.12)
    const female = chance(0.5)
    const first = english ? pick(EN_FIRST) : pick(female ? FIRST_NAMES_F : FIRST_NAMES_M)
    const lastBase = english ? pick(EN_LAST) : pick(LAST_NAMES)
    const last = !english && female ? `${lastBase}а` : lastBase
    let handle = slugify(`${first}-${last}`, 26)
    if (handle.length < 3 || usedHandles.has(handle)) handle = `${handle}-${index}`.slice(0, 32)
    usedHandles.add(handle)
    return { name: `${first} ${last}`, handle, locale: english ? Locale.en : chance(0.1) ? Locale.en : Locale.ru }
  }

  const roleCounts: [Role, number][] = [
    [Role.admin, 2],
    [Role.editor, 3],
    [Role.moderator, 3],
    [Role.analyst, 2],
    [Role.author, 45],
    [Role.reader, 160]
  ]
  let personIndex = 0
  for (const [role, count] of roleCounts) {
    for (let n = 0; n < count; n += 1) {
      personIndex += 1
      const person = makePerson(role, personIndex)
      const id = `dev-user-${String(personIndex).padStart(3, "0")}`
      const isServiceAccount = role !== Role.reader && role !== Role.author
      const createdAt = daysAgo(int(1, 720))
      const archiveRoll = role === Role.reader || role === Role.author ? rand() : 1
      const archiveMode =
        archiveRoll < 0.04
          ? AccountArchiveMode.self
          : archiveRoll < 0.07
            ? AccountArchiveMode.admin
            : archiveRoll < 0.08
              ? AccountArchiveMode.emergency
              : null
      const isPro = role === Role.author && chance(0.25)
      const email = `${person.handle}@example.test`

      handleRows.push({ handle: person.handle, createdAt })
      // Часть пользователей меняла хэндл: прежний остаётся в истории и за ними.
      if (chance(0.08))
        handleRows.push({ handle: `${person.handle}-old`.slice(0, 32), userId: id, createdAt: daysAgo(int(721, 900)) })

      userRows.push({
        id,
        name: person.name,
        email,
        handle: person.handle,
        role,
        locale: person.locale,
        bio: role === Role.author || chance(0.1) ? pick(BIOS) : null,
        socialLinks:
          role === Role.author && chance(0.6)
            ? {
                telegram: `https://t.me/${person.handle.replace(/-/g, "_")}`,
                site: `https://${person.handle}.example.test`
              }
            : undefined,
        nameCheckStatus: weighted([
          [ProfileCheckStatus.ok, 92],
          [ProfileCheckStatus.pending, 5],
          [ProfileCheckStatus.rejected, 3]
        ]),
        avatarCheckStatus: weighted([
          [ProfileCheckStatus.ok, 94],
          [ProfileCheckStatus.pending, 4],
          [ProfileCheckStatus.rejected, 2]
        ]),
        isServiceAccount,
        planTier: role === Role.author ? (isPro ? PlanTier.pro : PlanTier.standard) : PlanTier.free,
        planUntil: isPro ? daysAhead(int(-20, 365)) : null,
        createdAt,
        archivedAt: archiveMode ? daysAgo(int(1, 60)) : null,
        archiveMode,
        archivedByActorId: archiveMode && archiveMode !== AccountArchiveMode.self ? owner.id : archiveMode ? id : null,
        archivedByRole: archiveMode && archiveMode !== AccountArchiveMode.self ? Role.owner : archiveMode ? role : null,
        archiveReason:
          archiveMode === AccountArchiveMode.admin
            ? pick(["Спам в профиле", "Нарушение правил публикации", "Повторные оскорбления"])
            : archiveMode === AccountArchiveMode.emergency
              ? "Компрометация учётной записи"
              : null
      })
      users.push({
        id,
        role,
        isServiceAccount,
        locale: person.locale,
        email,
        archived: archiveMode !== null,
        createdAt
      })
    }
  }
  await prisma.handleHistory.createMany({
    data: handleRows.map((row) => ({ handle: row.handle, createdAt: row.createdAt }))
  })
  await prisma.user.createMany({ data: userRows })
  const staleHandles = handleRows.filter((row) => row.userId)
  for (const row of staleHandles)
    await prisma.handleHistory.update({ where: { handle: row.handle }, data: { userId: row.userId } })
  for (const row of userRows)
    await prisma.handleHistory.update({ where: { handle: row.handle }, data: { userId: row.id } })

  const authors = users.filter((user) => user.role === Role.author && !user.archived)
  const allAuthors = users.filter((user) => user.role === Role.author)
  const personal = users.filter(
    (user) => (user.role === Role.reader || user.role === Role.author) && !user.isServiceAccount
  )
  const staff = users.filter((user) => user.isServiceAccount)
  const moderators = staff.filter((user) => user.role === Role.moderator || user.role === Role.owner)
  const editors = staff.filter((user) => user.role === Role.editor)
  const admins = staff.filter((user) => user.role === Role.admin || user.role === Role.owner)

  // ----- Гранты и исключения прав -------------------------------------------
  console.log("3/12 гранты и исключения прав")
  const grantRows: Prisma.PlanGrantCreateManyInput[] = []
  for (const row of userRows.filter((user) => user.role === Role.author)) {
    grantRows.push({
      userId: row.id!,
      tier: PlanTier.standard,
      startsAt: row.createdAt as Date,
      reason: "Базовое авторство первого запуска"
    })
    if (row.planTier === PlanTier.pro) {
      grantRows.push({
        userId: row.id!,
        tier: PlanTier.pro,
        startsAt: daysAgo(int(30, 200)),
        endsAt: row.planUntil as Date,
        grantedById: owner.id,
        reason: pick(["Автор рубрики", "Партнёрская программа", "Победитель конкурса эссе"])
      })
    }
    if (chance(0.1)) {
      grantRows.push({
        userId: row.id!,
        tier: PlanTier.pro,
        startsAt: daysAgo(int(300, 400)),
        endsAt: daysAgo(int(100, 290)),
        grantedById: pick(admins).id,
        reason: "Пробный период pro",
        revokedAt: chance(0.5) ? daysAgo(int(100, 200)) : null
      })
    }
  }
  await prisma.planGrant.createMany({ data: grantRows })

  const exceptionPlan: [Role, string, PermissionExceptionKind][] = [
    [Role.editor, "review", PermissionExceptionKind.grant],
    [Role.editor, "taxonomy", PermissionExceptionKind.grant],
    [Role.moderator, "publish", PermissionExceptionKind.deny],
    [Role.analyst, "ai.read", PermissionExceptionKind.grant],
    [Role.analyst, "job.list", PermissionExceptionKind.grant],
    [Role.admin, "accounts", PermissionExceptionKind.deny],
    [Role.admin, "job.retry", PermissionExceptionKind.grant],
    [Role.moderator, "editorial", PermissionExceptionKind.grant]
  ]
  const exceptionRows: Prisma.PermissionExceptionCreateManyInput[] = exceptionPlan.flatMap(
    ([role, permission, kind], index) => {
      const holder = staff.find((user) => user.role === role)
      if (!holder) return []
      const state = index % 4
      return [
        {
          userId: holder.id,
          role,
          permission,
          kind,
          grantedById: owner.id,
          reason: pick([
            "Временная замена коллеги",
            "Разбор очереди на выходных",
            "Ограничение на время проверки",
            "Пилот нового процесса"
          ]),
          startsAt: daysAgo(int(5, 90)),
          endsAt: state === 0 ? null : state === 1 ? daysAhead(int(3, 60)) : daysAgo(int(1, 4)),
          expiredAt: state === 2 ? daysAgo(1) : null,
          revokedAt: state === 3 ? daysAgo(2) : null,
          revokedById: state === 3 ? owner.id : null
        }
      ]
    }
  )
  await prisma.permissionException.createMany({ data: exceptionRows })

  // ----- Таксономия ----------------------------------------------------------
  console.log("4/12 рубрики, форматы, теги")
  const extraSections = [
    { slug: "cinema", name: "Кино", nameEn: "Cinema" },
    { slug: "literature", name: "Литература", nameEn: "Literature" },
    { slug: "architecture", name: "Архитектура", nameEn: "Architecture" },
    { slug: "science", name: "Наука", nameEn: "Science" },
    { slug: "food", name: "Еда", nameEn: "Food" },
    { slug: "design", name: "Дизайн", nameEn: null }
  ]
  await prisma.sectionSlugHistory.createMany({
    data: [...extraSections.map(({ slug }) => ({ slug })), { slug: "theatre-archive" }, { slug: "kino" }]
  })
  const sectionIds: Record<string, string> = Object.fromEntries(
    (await prisma.section.findMany({ select: { id: true, slug: true } })).map(({ id, slug }) => [slug, id])
  )
  for (const [index, section] of extraSections.entries()) {
    const id = `dev-section-${section.slug}`
    await prisma.section.create({
      data: {
        id,
        ...section,
        order: 7 + index,
        description: `Материалы о теме «${section.name}»: люди, места и идеи.`,
        descriptionEn: section.nameEn
          ? `Stories about ${section.nameEn.toLowerCase()}: people, places and ideas.`
          : null,
        seoTitle: `${section.name} — Altera`,
        seoDescription: `Лучшие материалы рубрики «${section.name}».`
      }
    })
    await prisma.sectionSlugHistory.update({ where: { slug: section.slug }, data: { ownerSectionId: id } })
    sectionIds[section.slug] = id
  }
  // Архивная рубрика с преемником и прежний адрес рубрики «Кино».
  await prisma.section.create({
    data: {
      id: "dev-section-theatre-archive",
      slug: "theatre-archive",
      name: "Театр (архив)",
      nameEn: "Theatre (archive)",
      order: 99,
      status: TaxonomyStatus.archived,
      successorId: sectionIds.culture,
      archivedAt: daysAgo(40),
      archivedByActorId: owner.id,
      archivedByRole: Role.owner
    }
  })
  await prisma.sectionSlugHistory.update({
    where: { slug: "theatre-archive" },
    data: { ownerSectionId: "dev-section-theatre-archive", redirectToSectionId: sectionIds.culture }
  })
  await prisma.sectionSlugHistory.update({
    where: { slug: "kino" },
    data: { ownerSectionId: sectionIds.cinema, redirectToSectionId: sectionIds.cinema }
  })

  await prisma.format.createMany({
    data: [
      {
        id: "dev-format-longread",
        slug: "longread",
        name: "Лонгрид",
        nameEn: "Long read",
        description: "Большой текст с несколькими главами"
      },
      { id: "dev-format-guide", slug: "guide", name: "Гид", nameEn: "Guide" },
      { id: "dev-format-letter", slug: "letter", name: "Письмо", nameEn: "Letter" },
      {
        id: "dev-format-podcast",
        slug: "podcast",
        name: "Подкаст",
        nameEn: "Podcast",
        status: TaxonomyStatus.archived,
        archivedAt: daysAgo(90)
      }
    ]
  })
  const formatIds = (
    await prisma.format.findMany({ where: { status: TaxonomyStatus.active }, select: { id: true } })
  ).map(({ id }) => id)

  const tagRows: Prisma.TagCreateManyInput[] = TAG_WORDS.filter(
    ([, en]) => !["history", "people", "places"].includes(en)
  ).map(([ru, en]) => {
    const creator = chance(0.6) ? pick(allAuthors) : null
    return {
      id: `dev-tag-${en}`,
      slug: en,
      name: cap(ru),
      nameEn: cap(en.replace(/-/g, " ")),
      createdByActorId: creator?.id ?? owner.id,
      createdByRole: creator ? Role.author : Role.owner,
      createdAt: daysAgo(int(10, 600))
    }
  })
  await prisma.tagSlugHistory.createMany({ data: tagRows.map(({ slug }) => ({ slug })) })
  await prisma.tag.createMany({ data: tagRows })
  for (const tag of tagRows)
    await prisma.tagSlugHistory.update({ where: { slug: tag.slug }, data: { ownerTagId: tag.id } })
  // Архивные и слитые теги.
  for (const slug of ["summer", "dance"]) {
    await prisma.tag.update({
      where: { slug },
      data: {
        status: TaxonomyStatus.archived,
        archivedAt: daysAgo(int(5, 50)),
        archivedByActorId: owner.id,
        archivedByRole: Role.owner
      }
    })
  }
  for (const [from, into] of [
    ["vinyl", "jazz"],
    ["type", "design"],
    ["kids", "family"]
  ]) {
    await prisma.tag.update({
      where: { slug: from },
      data: {
        status: TaxonomyStatus.archived,
        mergedIntoId: `dev-tag-${into}`,
        archivedAt: daysAgo(int(5, 50)),
        archivedByActorId: owner.id,
        archivedByRole: Role.owner
      }
    })
    await prisma.tagSlugHistory.update({ where: { slug: from }, data: { redirectToTagId: `dev-tag-${into}` } })
  }
  const activeTags = (
    await prisma.tag.findMany({ where: { status: TaxonomyStatus.active }, select: { id: true } })
  ).map(({ id }) => id)

  // ----- Медиа: план записей и файлов ---------------------------------------
  // Файлы пишутся в локальное хранилище по раскладке `src/storage/keys.ts`; раздача `/media`
  // отдаёт публично только варианты готовых медиа, которые служат обложкой опубликованной
  // статьи или аватаром активного аккаунта (`storage/access.ts`).
  console.log("5/12 медиа: план")
  const mediaRows: Prisma.MediaAssetCreateManyInput[] = []
  const mediaSpecs: MediaSpec[] = []
  const planMedia = (input: {
    ownerId: string
    purpose: MediaSpec["purpose"]
    createdAt: Date
    paletteIndex: number
    status?: MediaProcessingStatus
  }): string => {
    const id = uuid()
    const status = input.status ?? MediaProcessingStatus.ready
    const [width, height] =
      input.purpose === "avatar"
        ? [512, 512]
        : pick([
            [1280, 720],
            [1280, 853],
            [1200, 900],
            [1080, 1080]
          ] as const)
    const widths = input.purpose === "avatar" ? [128, 256] : [480, 960]
    const key = masterKey({ assetId: id, createdAt: input.createdAt, extension: "png" })
    const variants =
      status === MediaProcessingStatus.ready
        ? widths.map((w) => ({
            width: w,
            format: "webp",
            key: variantKey({ assetId: id, createdAt: input.createdAt, width: w, format: "webp" })
          }))
        : []
    mediaRows.push({
      id,
      ownerId: input.ownerId,
      processingStatus: status,
      storageKey: key,
      mimeType: "image/png",
      byteSize: 0,
      width,
      height,
      sha256: "",
      variants,
      focalX: chance(0.5) ? Number(rand().toFixed(2)) : null,
      focalY: chance(0.5) ? Number(rand().toFixed(2)) : null,
      alt:
        input.purpose === "avatar"
          ? "Аватар автора"
          : chance(0.85)
            ? pick([
                "Улица старого города на рассвете",
                "Портрет героя материала",
                "Сцена во время концерта",
                "Горный перевал зимой",
                "Интерьер библиотеки",
                "Рынок выходного дня"
              ])
            : null,
      caption:
        input.purpose === "cover" && chance(0.4)
          ? pick(["Фото из архива автора", "Съёмка на плёнку", "Кадр из фильма"])
          : null,
      attribution: pick(["Фото автора", "Архив семьи героя", "Пресс-служба фестиваля", "Wikimedia Commons"]),
      license: weighted([
        [MediaLicense.own, 60],
        [MediaLicense.cc_by, 10],
        [MediaLicense.cc_by_sa, 8],
        [MediaLicense.cc0, 6],
        [MediaLicense.public_domain, 6],
        [MediaLicense.permission, 7],
        [MediaLicense.cc_by_nc, 3]
      ]),
      licenseNote: chance(0.1) ? "Разрешение получено письмом" : null,
      placeholder: status === MediaProcessingStatus.ready ? `#${hex(3)}` : null,
      deletedAt: input.purpose === "library" && chance(0.05) ? daysAgo(int(1, 30)) : null,
      createdAt: input.createdAt
    })
    mediaSpecs.push({
      id,
      key,
      purpose: input.purpose,
      width,
      height,
      status,
      variants,
      seed: int(1, 2 ** 30),
      paletteIndex: input.paletteIndex
    })
    return id
  }
  const variantUrl = (assetId: string, width: number): string => {
    const variant = (mediaRows.find((row) => row.id === assetId)!.variants as { width: number; key: string }[]).find(
      (v) => v.width === width
    )!
    return `${MEDIA_BASE_URL}/${variant.key}`
  }

  // Аватары: у половины авторов текущий, у части — ещё и прежний.
  const avatarPlan: { userId: string; avatarId: string; previousId: string | null }[] = []
  for (const author of authors.filter(() => chance(0.55))) {
    const previousId = chance(0.3)
      ? planMedia({
          ownerId: author.id,
          purpose: "avatar",
          createdAt: daysAgo(int(200, 500)),
          paletteIndex: int(0, 11)
        })
      : null
    const avatarId = planMedia({
      ownerId: author.id,
      purpose: "avatar",
      createdAt: daysAgo(int(1, 199)),
      paletteIndex: int(0, 11)
    })
    avatarPlan.push({ userId: author.id, avatarId, previousId })
  }
  // Медиатека: загрузки во всех статусах обработки, в том числе удалённые.
  for (let index = 0; index < 60; index += 1) {
    planMedia({
      ownerId: pick(authors).id,
      purpose: "library",
      createdAt: daysAgo(int(1, 540)),
      paletteIndex: int(0, 11),
      status: weighted([
        [MediaProcessingStatus.ready, 55],
        [MediaProcessingStatus.failed, 12],
        [MediaProcessingStatus.processing, 11],
        [MediaProcessingStatus.queued, 11],
        [MediaProcessingStatus.uploading, 11]
      ])
    })
  }

  // ----- Материалы -----------------------------------------------------------
  console.log("6/12 материалы")
  const articleRows: Prisma.ArticleCreateManyInput[] = []
  const articleTags: [string, string][] = []
  const usedSlugs = new Set<string>()
  const activeSectionSlugs = Object.keys(sectionIds)
  for (let index = 0; index < 480; index += 1) {
    const status = weighted([
      [ArticleStatus.published, 66],
      [ArticleStatus.draft, 11],
      [ArticleStatus.ai_check, 3],
      [ArticleStatus.review, 4],
      [ArticleStatus.in_review, 4],
      [ArticleStatus.rework, 6],
      [ArticleStatus.archived, 6]
    ])
    const sourceLocale = chance(0.14) ? Locale.en : Locale.ru
    const sectionSlug = pick(activeSectionSlugs)
    const topic = SECTION_TOPICS.find((entry) => entry.slug === sectionSlug) ?? SECTION_TOPICS[0]
    const title =
      sourceLocale === Locale.en ? pick(TITLE_PATTERNS_EN)(pick(topic.en)) : pick(TITLE_PATTERNS_RU)(pick(topic.ru))
    let slug = slugify(title, 60)
    if (usedSlugs.has(slug)) slug = `${slug}-${index}`
    usedSlugs.add(slug)
    const isEditorial = chance(0.05)
    const author = isEditorial && editors.length > 0 ? pick(editors) : pick(chance(0.92) ? authors : allAuthors)
    const createdAt = daysAgo(int(2, 560))
    const wasPublished =
      status === ArticleStatus.published ||
      status === ArticleStatus.archived ||
      (status === ArticleStatus.rework && chance(0.2))
    const firstPublishedAt = wasPublished ? after(createdAt, 60, 60 * 24 * 10) : null
    const firstPublished = firstPublishedAt && firstPublishedAt > NOW ? daysAgo(1) : firstPublishedAt
    const publishedAt =
      status === ArticleStatus.published && firstPublished
        ? chance(0.2)
          ? after(firstPublished, 60, 60 * 24 * 30)
          : firstPublished
        : null
    const hasSection = status !== ArticleStatus.draft || chance(0.5)
    const id = uuid()
    const dekPool = sourceLocale === Locale.en ? SENTENCES_EN : SENTENCES_RU
    const coverId = chance(0.85)
      ? planMedia({
          ownerId: author.id,
          purpose: "cover",
          createdAt,
          paletteIndex: SECTION_TOPICS.findIndex((entry) => entry.slug === sectionSlug)
        })
      : null
    articleRows.push({
      id,
      title,
      slug,
      dek: chance(0.85) ? pick(dekPool) : null,
      excerpt: chance(0.6) ? pick(dekPool) : null,
      body: bodyDocument(title, sourceLocale),
      featuredImage: coverId ? variantUrl(coverId, 960) : null,
      status,
      sourceLocale,
      isEditorial,
      createdAt,
      updatedAt: after(createdAt, 10, 60 * 24 * 20) > NOW ? NOW : after(createdAt, 10, 60 * 24 * 20),
      firstPublishedAt: firstPublished,
      publishedAt: publishedAt && publishedAt > NOW ? NOW : publishedAt,
      archivedAt: status === ArticleStatus.archived ? daysAgo(int(1, 60)) : null,
      archivedByActorId: status === ArticleStatus.archived ? (chance(0.6) ? author.id : pick(moderators).id) : null,
      archivedByRole: status === ArticleStatus.archived ? (chance(0.6) ? author.role : Role.moderator) : null,
      archiveReason:
        status === ArticleStatus.archived
          ? pick(["Автор снял материал", "Устаревшие сведения", "Жалоба правообладателя", null])
          : null,
      authorId: author.id,
      sectionId: hasSection ? sectionIds[sectionSlug] : null,
      formatId: chance(0.8) ? pick(formatIds) : null,
      coverAssetId: coverId
    })
    for (const tagId of pickMany(activeTags, int(0, 4))) articleTags.push([id, tagId])
  }

  // ----- Медиа: файлы в хранилище и записи ----------------------------------
  const writer = await createMediaWriter(STORAGE_ROOT)
  console.log(
    `   файлы: ${mediaSpecs.length} изображений → ${writer.root}${writer.webp ? "" : " (cwebp не найден: варианты в PNG)"}`
  )
  let written = 0
  await inPool(mediaSpecs, 8, async (spec) => {
    const row = mediaRows.find((entry) => entry.id === spec.id)!
    const png =
      spec.purpose === "avatar"
        ? renderAvatar(spec.width, spec.seed, spec.paletteIndex)
        : renderCover(spec.width, spec.height, spec.seed, spec.paletteIndex)
    row.sha256 = crypto.createHash("sha256").update(png).digest("hex")
    row.byteSize = png.length
    // Незавершённая загрузка ещё не дошла до хранилища.
    if (spec.status !== MediaProcessingStatus.uploading) await writer.put(spec.key, png, "image/png")
    for (const variant of spec.variants) await writer.variant(spec.key, variant.key, variant.width)
    written += 1
    if (written % 100 === 0) console.log(`   ${written}/${mediaSpecs.length}`)
  })
  await prisma.mediaAsset.createMany({ data: mediaRows })
  for (const plan of avatarPlan) {
    await prisma.user.update({
      where: { id: plan.userId },
      data: { avatarAssetId: plan.avatarId, prevAvatarId: plan.previousId, photoUrl: variantUrl(plan.avatarId, 256) }
    })
  }

  await prisma.article.createMany({ data: articleRows })
  for (let offset = 0; offset < articleTags.length; offset += 500) {
    const chunk = articleTags.slice(offset, offset + 500)
    await prisma.$executeRawUnsafe(
      `INSERT INTO "_ArticleToTag" ("A", "B") VALUES ${chunk.map(([articleId, tagId]) => `('${articleId}', '${tagId}')`).join(", ")} ON CONFLICT DO NOTHING`
    )
  }

  // ----- Языковые версии и ревизии -------------------------------------------
  console.log("7/12 языковые версии, ревизии, переписка")
  const sourceTranslations = await prisma.articleTranslation.findMany({
    where: { articleId: { in: articleRows.map((row) => row.id!) } },
    select: {
      id: true,
      articleId: true,
      status: true,
      locale: true,
      slug: true,
      title: true,
      revisions: { select: { id: true } }
    }
  })
  const articleById = new Map(articleRows.map((row) => [row.id!, row]))

  // Отклонённые и перередактируемые версии.
  const reworkIds = sourceTranslations.filter((t) => t.status === ArticleStatus.rework).map((t) => t.id)
  await prisma.articleTranslation.updateMany({
    where: { id: { in: reworkIds.filter(() => chance(0.25)) } },
    data: { rejected: true }
  })
  const reeditIds = sourceTranslations
    .filter((t) => t.status === ArticleStatus.published && chance(0.08))
    .map((t) => t.id)
  await prisma.articleTranslation.updateMany({
    where: { id: { in: reeditIds } },
    data: { reeditUntil: daysAhead(3), reeditedAt: daysAgo(1) }
  })

  const translationRows: Prisma.ArticleTranslationCreateManyInput[] = []
  for (const source of sourceTranslations) {
    const article = articleById.get(source.articleId)!
    if (
      !(source.status === ArticleStatus.published && chance(0.3)) &&
      !(source.status === ArticleStatus.draft && chance(0.05))
    )
      continue
    const locale = source.locale === Locale.ru ? Locale.en : Locale.ru
    const topic = SECTION_TOPICS[int(0, SECTION_TOPICS.length - 1)]
    const title =
      locale === Locale.en ? pick(TITLE_PATTERNS_EN)(pick(topic.en)) : pick(TITLE_PATTERNS_RU)(pick(topic.ru))
    const status =
      source.status === ArticleStatus.published
        ? weighted([
            [ArticleStatus.published, 70],
            [ArticleStatus.draft, 15],
            [ArticleStatus.review, 10],
            [ArticleStatus.rework, 5]
          ])
        : ArticleStatus.draft
    translationRows.push({
      id: uuid(),
      articleId: source.articleId,
      locale,
      slug: `${source.slug}-${locale}`.slice(0, 80),
      title,
      dek: pick(locale === Locale.en ? SENTENCES_EN : SENTENCES_RU),
      body: JSON.parse(bodyDocument(title, locale)),
      featuredImage: article.featuredImage,
      status,
      publishedAt:
        status === ArticleStatus.published ? after(article.firstPublishedAt as Date, 60 * 24, 60 * 24 * 20) : null,
      translatorId: chance(0.6) ? article.authorId : chance(0.5) ? pick(editors).id : null,
      sourceRevisionId: source.revisions[0]?.id ?? null,
      createdAt: after(article.createdAt as Date, 60 * 24, 60 * 24 * 30)
    })
  }
  for (const row of translationRows) if (row.publishedAt && (row.publishedAt as Date) > NOW) row.publishedAt = NOW
  await prisma.articleTranslation.createMany({ data: translationRows })

  const allTranslations = [
    ...sourceTranslations.map((t) => ({
      id: t.id,
      articleId: t.articleId,
      status: t.status,
      title: t.title,
      locale: t.locale
    })),
    ...translationRows.map((t) => ({
      id: t.id!,
      articleId: t.articleId,
      status: t.status as ArticleStatus,
      title: t.title,
      locale: t.locale
    }))
  ]
  const revisionRows: Prisma.ArticleRevisionCreateManyInput[] = []
  for (const translation of allTranslations) {
    const article = articleById.get(translation.articleId)!
    const extra = translation.status === ArticleStatus.draft ? int(1, 5) : int(0, 3)
    let previousId: string | null = null
    for (let n = 0; n < extra; n += 1) {
      const id = uuid()
      const kind = weighted([
        [ArticleRevisionKind.autosave, 55],
        [ArticleRevisionKind.manual, 25],
        [ArticleRevisionKind.editorial, 10],
        [ArticleRevisionKind.publish, 10]
      ])
      revisionRows.push({
        id,
        translationId: translation.id,
        title: n === extra - 1 ? translation.title : `${translation.title} (черновик ${n + 1})`,
        body: JSON.parse(bodyDocument(translation.title, translation.locale)),
        kind,
        createdById: kind === ArticleRevisionKind.editorial && editors.length > 0 ? pick(editors).id : article.authorId,
        note:
          kind === ArticleRevisionKind.editorial
            ? "Правка редакции: заголовок и лид"
            : kind === ArticleRevisionKind.manual && chance(0.3)
              ? "Сохранил перед подачей"
              : null,
        restoredFromId: previousId && chance(0.08) ? previousId : null,
        createdAt: after(article.createdAt as Date, 5 + n * 30, 60 * 24 * (n + 1))
      })
      previousId = id
    }
  }
  await prisma.articleRevision.createMany({ data: revisionRows })

  // Переписка по статье и заметки к блокам.
  const messageRows: Prisma.ReviewMessageCreateManyInput[] = []
  const noteRows: Prisma.ReviewNoteCreateManyInput[] = []
  const revisionsByTranslation = new Map<string, string[]>()
  for (const t of sourceTranslations)
    revisionsByTranslation.set(
      t.id,
      t.revisions.map((r) => r.id)
    )
  for (const r of revisionRows)
    revisionsByTranslation.set(r.translationId, [...(revisionsByTranslation.get(r.translationId) ?? []), r.id!])

  for (const translation of allTranslations) {
    const article = articleById.get(translation.articleId)!
    const base = article.createdAt as Date
    const push = (
      kind: ReviewMessageKind,
      byRole: Role,
      text: string | null,
      extra: Partial<Prisma.ReviewMessageCreateManyInput> = {}
    ) => {
      const id = uuid()
      messageRows.push({
        id,
        translationId: translation.id,
        kind,
        byRole,
        text,
        createdAt: after(base, 60 * (messageRows.length % 40), 60 * 24 * 15),
        readAt: chance(0.7) ? NOW : null,
        ...extra
      })
      return id
    }
    switch (translation.status) {
      case ArticleStatus.published:
        if (chance(0.5)) {
          push(ReviewMessageKind.submitted, Role.author, null)
          push(ReviewMessageKind.ai_decision, Role.moderator, "Автоматическая проверка: нарушений не найдено")
          push(chance(0.7) ? ReviewMessageKind.published_auto : ReviewMessageKind.manual_publish, Role.moderator, null)
        }
        break
      case ArticleStatus.ai_check:
      case ArticleStatus.review:
      case ArticleStatus.in_review:
        push(ReviewMessageKind.submitted, Role.author, chance(0.3) ? "Прошу посмотреть, особенно вторую главу." : null)
        if (translation.status !== ArticleStatus.ai_check)
          push(
            ReviewMessageKind.ai_decision,
            Role.moderator,
            "Автоматическая проверка: нужна ручная проверка — есть спорные формулировки"
          )
        break
      case ArticleStatus.rework: {
        push(ReviewMessageKind.submitted, Role.author, null)
        const request = push(
          ReviewMessageKind.rework_request,
          Role.moderator,
          "Нужно доработать материал перед публикацией.",
          {
            recommendations: pick([
              "Проверьте даты и имена в третьем абзаце.",
              "Добавьте источники к цифрам.",
              "Сократите вступление, сейчас оно затянуто.",
              "Уточните права на фотографии."
            ])
          }
        )
        if (chance(0.6))
          push(ReviewMessageKind.author_reply, Role.author, "Спасибо, поправлю до конца недели.", { parentId: request })
        if (chance(0.15))
          push(ReviewMessageKind.final_reject, Role.moderator, "Материал не соответствует правилам публикации.")
        const revisions = revisionsByTranslation.get(translation.id) ?? []
        for (let n = 0; n < int(1, 4) && revisions.length > 0; n += 1) {
          noteRows.push({
            revisionId: pick(revisions),
            blockId: `b${int(1, 12)}`,
            text: pick([
              "Здесь нужна ссылка на источник",
              "Фраза звучит двусмысленно",
              "Проверьте написание фамилии",
              "Слишком длинный абзац"
            ]),
            createdById: pick(moderators).id,
            resolved: chance(0.4)
          })
        }
        break
      }
      case ArticleStatus.archived:
        if (chance(0.5))
          push(ReviewMessageKind.unpublish, Role.moderator, "Материал снят с публикации: устаревшие сведения.")
        break
      case ArticleStatus.draft:
        if (chance(0.1)) push(ReviewMessageKind.withdrawn, Role.author, "Отзываю, хочу переписать финал.")
        break
    }
    if (chance(0.05))
      push(ReviewMessageKind.message, Role.editor, "Редакция: предлагаем поставить материал в подборку выходного дня.")
  }
  await prisma.reviewMessage.createMany({ data: messageRows })
  await prisma.reviewNote.createMany({ data: noteRows })

  // ----- Закладки, сессии, токены --------------------------------------------
  console.log("8/12 закладки, сессии, токены входа")
  const publishedArticleIds = articleRows.filter((row) => row.status === ArticleStatus.published).map((row) => row.id!)
  const archivedArticleIds = articleRows.filter((row) => row.status === ArticleStatus.archived).map((row) => row.id!)
  const bookmarkRows: Prisma.BookmarkCreateManyInput[] = []
  for (const user of personal.filter(() => chance(0.65))) {
    for (const articleId of pickMany(publishedArticleIds, int(1, 14)))
      bookmarkRows.push({ userId: user.id, articleId, createdAt: daysAgo(int(0, 200)) })
    if (chance(0.2) && archivedArticleIds.length > 0)
      bookmarkRows.push({ userId: user.id, articleId: pick(archivedArticleIds), createdAt: daysAgo(int(50, 300)) })
  }
  await prisma.bookmark.createMany({ data: bookmarkRows, skipDuplicates: true })

  const sessionRows: Prisma.SessionCreateManyInput[] = []
  for (const user of users.filter(() => chance(0.45))) {
    for (let n = 0; n < int(1, 4); n += 1) {
      const createdAt = daysAgo(int(0, 40))
      const state = rand()
      sessionRows.push({
        userId: user.id,
        tokenHash: hex(32),
        previousTokenHash: chance(0.4) ? hex(32) : null,
        expiresAt: state < 0.15 ? daysAgo(int(1, 10)) : daysAhead(int(5, 30)),
        revokedAt: state > 0.85 ? daysAgo(int(0, 5)) : null,
        userAgent: pick(USER_AGENTS),
        ip: `10.${int(0, 255)}.${int(0, 255)}.${int(1, 254)}`,
        limited: user.archived && chance(0.5),
        createdAt,
        lastUsedAt: after(createdAt, 1, 60 * 24 * 5) > NOW ? NOW : after(createdAt, 1, 60 * 24 * 5)
      })
    }
  }
  await prisma.session.createMany({ data: sessionRows })

  const tokenRows: Prisma.MagicLinkTokenCreateManyInput[] = []
  for (const email of pickMany(
    users.map((user) => user.email),
    25
  ).concat(["new-visitor-1@example.test", "new-visitor-2@example.test", "new-visitor-3@example.test"])) {
    const state = rand()
    tokenRows.push({
      tokenHash: hex(32),
      email,
      locale: chance(0.8) ? Locale.ru : Locale.en,
      next: chance(0.3) ? "/me" : null,
      expiresAt: state < 0.4 ? daysAgo(1) : after(NOW, 5, 15),
      usedAt: state > 0.7 ? daysAgo(0) : null,
      createdAt: daysAgo(int(0, 3))
    })
  }
  await prisma.magicLinkToken.createMany({ data: tokenRows })
  await prisma.emailChangeRequest.createMany({
    data: pickMany(personal, 6).map((user, index) => ({
      userId: user.id,
      newEmail: `changed-${index}@example.test`,
      codeHash: hex(32),
      expiresAt: index % 2 ? daysAhead(1) : daysAgo(1),
      attempts: int(0, 4)
    }))
  })

  // ----- Юридические тексты и согласия ---------------------------------------
  console.log("9/12 юридические тексты и согласия")
  const legalTitles: Record<LegalTextKind, string> = {
    terms: "Пользовательское соглашение",
    privacy: "Политика обработки персональных данных",
    content_rules: "Правила публикации",
    license: "Лицензия на материалы",
    paid_services: "Условия платных услуг",
    refunds: "Условия возврата",
    about: "О проекте"
  }
  const legalRows: Prisma.LegalTextCreateManyInput[] = []
  for (const kind of Object.values(LegalTextKind)) {
    for (const locale of [Locale.ru, Locale.en]) {
      const versions =
        kind === LegalTextKind.terms || kind === LegalTextKind.privacy
          ? 3
          : kind === LegalTextKind.content_rules
            ? 2
            : 1
      for (let version = 1; version <= versions; version += 1) {
        const status =
          version === versions && versions === 3
            ? LegalTextStatus.draft
            : version === versions - (versions === 3 ? 1 : 0)
              ? LegalTextStatus.published
              : LegalTextStatus.previous
        const published = status !== LegalTextStatus.draft
        legalRows.push({
          id: `dev-legal-${kind}-${locale}-${version}`,
          kind,
          locale,
          version,
          status,
          body: `# ${legalTitles[kind]}\n\nЛокальный текст для разработки, редакция ${version}. Не является юридическим документом.\n\n${sentence(pickMany(SENTENCES_RU, 5))}`,
          summaryOfChanges:
            version === 1
              ? "Первая редакция"
              : pick(["Уточнены сроки хранения данных", "Добавлен раздел о cookie", "Исправлены опечатки"]),
          isMaterial: version > 1 && chance(0.5),
          publishedAt: published ? daysAgo(400 - version * 120) : null,
          publishedByActorId: published ? owner.id : null,
          publishedByRole: published ? Role.owner : null
        })
      }
    }
  }
  await prisma.legalText.createMany({ data: legalRows })
  const consentRows: Prisma.UserLegalConsentCreateManyInput[] = []
  for (const user of personal) {
    for (const kind of [LegalTextKind.terms, LegalTextKind.privacy]) {
      const currentVersion = chance(0.8) ? 2 : 1
      consentRows.push({
        userId: user.id,
        legalTextId: `dev-legal-${kind}-${user.locale}-${currentVersion}`,
        acceptedAt: after(user.createdAt, 0, 5)
      })
    }
  }
  await prisma.userLegalConsent.createMany({ data: consentRows, skipDuplicates: true })

  // ----- Задания, AI-процессы, стоимость -------------------------------------
  console.log("10/12 задания, AI-процессы, стоимость")
  // Обработчик в API зарегистрирован только для housekeeping: задания других видов лежат в
  // конечных статусах или в очереди с датой в будущем, чтобы локальный воркер их не брал.
  const jobKinds = [
    "mail.send",
    "media.process",
    "ai.check",
    "ai.translate",
    "export.user",
    "ranking.recompute",
    "housekeeping"
  ]
  const jobRows: Prisma.JobCreateManyInput[] = []
  const attemptRows: Prisma.JobAttemptCreateManyInput[] = []
  for (let index = 0; index < 320; index += 1) {
    const kind = pick(jobKinds)
    const status = weighted([
      [JobStatus.completed, 62],
      [JobStatus.failed, 14],
      [JobStatus.cancelled, 6],
      [JobStatus.stuck, 5],
      [JobStatus.queued, 13]
    ])
    const createdAt = daysAgo(int(0, 120))
    const id = uuid()
    const attempts = status === JobStatus.queued ? 0 : status === JobStatus.failed ? 3 : int(1, 2)
    const startedAt = attempts > 0 ? after(createdAt, 0, 5) : null
    jobRows.push({
      id,
      kind,
      status,
      objectType: kind.startsWith("ai")
        ? "article_translation"
        : kind === "media.process"
          ? "media_asset"
          : kind === "export.user"
            ? "user"
            : null,
      objectId: kind === "export.user" ? pick(personal).id : null,
      parameters: kind === "export.user" ? { format: "zip" } : kind === "housekeeping" ? { scope: "all" } : undefined,
      originRequestId: uuid(),
      availableAt: status === JobStatus.queued ? daysAhead(int(1, 30)) : createdAt,
      startedAt,
      finishedAt: startedAt && status !== JobStatus.stuck ? after(startedAt, 0, 30) : null,
      cancelledAt: status === JobStatus.cancelled ? after(createdAt, 1, 60) : null,
      attemptCount: attempts,
      maxAttempts: 3,
      manualRetryAllowed: kind !== "ranking.recompute",
      createdAt
    })
    for (let number = 1; number <= attempts; number += 1) {
      const last = number === attempts
      attemptRows.push({
        jobId: id,
        number,
        status: last ? (status === JobStatus.stuck ? JobStatus.running : status) : JobStatus.failed,
        startedAt: after(createdAt, number, number * 5),
        finishedAt: last && status === JobStatus.stuck ? null : after(createdAt, number * 5, number * 10),
        errorClass:
          !last || status === JobStatus.failed
            ? pick(["ProviderTimeout", "ValidationError", "StorageUnavailable", "RateLimited"])
            : null,
        errorRequestId: !last || status === JobStatus.failed ? uuid() : null
      })
    }
  }
  await prisma.job.createMany({ data: jobRows })
  await prisma.jobAttempt.createMany({ data: attemptRows })

  const aiRows: Prisma.AiProcessCreateManyInput[] = []
  const aiJobs = jobRows.filter((job) => job.kind.startsWith("ai"))
  for (let index = 0; index < 420; index += 1) {
    const kind = weighted([
      [AiProcessKind.check, 55],
      [AiProcessKind.translate, 15],
      [AiProcessKind.profile, 15],
      [AiProcessKind.alt, 15]
    ])
    const status = weighted([
      [AiProcessStatus.completed, 80],
      [AiProcessStatus.failed, 8],
      [AiProcessStatus.running, 4],
      [AiProcessStatus.started, 3],
      [AiProcessStatus.created, 5]
    ])
    const createdAt = daysAgo(int(0, 90))
    const done = status === AiProcessStatus.completed || status === AiProcessStatus.failed
    const durationMs = done ? int(400, 25_000) : null
    const verdict =
      status === AiProcessStatus.completed
        ? kind === AiProcessKind.check
          ? weighted([
              ["pass", 70],
              ["manual_review", 20],
              ["reject", 10]
            ])
          : "ok"
        : null
    aiRows.push({
      jobId: chance(0.5) && aiJobs.length > 0 ? pick(aiJobs).id : null,
      kind,
      status,
      objectType:
        kind === AiProcessKind.profile ? "user" : kind === AiProcessKind.alt ? "media_asset" : "article_translation",
      objectId:
        kind === AiProcessKind.profile
          ? pick(users).id
          : kind === AiProcessKind.alt
            ? pick(mediaRows).id!
            : pick(allTranslations).id,
      model: pick(["yandexgpt-lite", "yandexgpt", "fake"]),
      promptVersion: pick(["check-v1", "check-v2", "alt-v1", "translate-v1"]),
      verdict,
      reasons:
        verdict === "reject" || verdict === "manual_review"
          ? { categories: pickMany(["off_topic", "unverified_facts", "hate", "copyright", "adult"], int(1, 2)) }
          : undefined,
      providerErrorClass:
        status === AiProcessStatus.failed ? pick(["ProviderTimeout", "QuotaExceeded", "InvalidResponse"]) : null,
      startedAt: status === AiProcessStatus.created ? null : after(createdAt, 0, 2),
      finishedAt: done && durationMs ? new Date(createdAt.getTime() + 60_000 + durationMs) : null,
      durationMs,
      createdAt
    })
  }
  await prisma.aiProcess.createMany({ data: aiRows })
  const costRows: Prisma.AiCostAggregateCreateManyInput[] = []
  for (let day = 90; day >= 1; day -= 1) {
    const bucketStart = new Date(Date.UTC(NOW.getUTCFullYear(), NOW.getUTCMonth(), NOW.getUTCDate() - day))
    for (const kind of Object.values(AiProcessKind)) {
      const processCount = int(0, kind === AiProcessKind.check ? 40 : 12)
      costRows.push({
        bucketStart,
        bucketEnd: new Date(bucketStart.getTime() + DAY),
        kind,
        processCount,
        totalCostMinor: BigInt(processCount * int(8, 60))
      })
    }
  }
  await prisma.aiCostAggregate.createMany({ data: costRows })

  // ----- Письма --------------------------------------------------------------
  console.log("11/12 письма, ошибки")
  const mailRows: Prisma.MailMessageCreateManyInput[] = []
  const mailEventRows: Prisma.MailDeliveryEventCreateManyInput[] = []
  const mailJobs = jobRows.filter((job) => job.kind === "mail.send")
  const templates: [string, string, string][] = [
    ["magic_link", "Вход в Altera", "Ссылка для входа: [скрыто]. Ссылка действует 15 минут."],
    ["email_change_code", "Код подтверждения почты", "Код подтверждения: [скрыто]."],
    ["email_change_notice", "Адрес почты изменён", "Адрес почты вашей учётной записи изменён."],
    ["support_request_staff", "Altera: новое обращение", "Поступило обращение из формы «Письмо в редакцию»."]
  ]
  for (let index = 0; index < 520; index += 1) {
    const [template, subject, body] = weighted(
      templates.map((entry, position) => [entry, [70, 10, 8, 12][position]] as const)
    )
    const status = weighted([
      [MailDeliveryStatus.sent, 84],
      [MailDeliveryStatus.queued, 4],
      [MailDeliveryStatus.bounced, 6],
      [MailDeliveryStatus.failed, 6]
    ])
    const queuedAt = daysAgo(int(0, 120))
    const id = uuid()
    const recipient = template === "support_request_staff" ? pick(staff).email : pick(users).email
    mailRows.push({
      id,
      jobId: chance(0.3) && mailJobs.length > 0 ? pick(mailJobs).id : null,
      template,
      recipientEmail: recipient,
      subject,
      sanitizedBody: body,
      status,
      objectType: template === "support_request_staff" ? "support_request" : "user",
      provider: pick(["console", "smtp"]),
      messageId: status === MailDeliveryStatus.queued ? null : `<${hex(8)}@altera.local>`,
      deliveryErrorClass:
        status === MailDeliveryStatus.failed
          ? pick(["ConnectionRefused", "AuthFailed", "Timeout"])
          : status === MailDeliveryStatus.bounced
            ? "MailboxUnavailable"
            : null,
      queuedAt,
      sentAt: status === MailDeliveryStatus.queued ? null : after(queuedAt, 0, 3),
      resentAt: status === MailDeliveryStatus.failed && chance(0.3) ? after(queuedAt, 30, 600) : null,
      createdAt: queuedAt
    })
    mailEventRows.push({ mailMessageId: id, status: MailDeliveryStatus.queued, occurredAt: queuedAt })
    if (status !== MailDeliveryStatus.queued)
      mailEventRows.push({
        mailMessageId: id,
        status,
        providerEventId: hex(6),
        errorClass: status === MailDeliveryStatus.sent ? null : "DeliveryError",
        occurredAt: after(queuedAt, 0, 5)
      })
  }
  await prisma.mailMessage.createMany({ data: mailRows })
  await prisma.mailDeliveryEvent.createMany({ data: mailEventRows })

  // ----- Ошибки --------------------------------------------------------------
  const errorCatalog: [BackendErrorService, string, string, string][] = [
    [BackendErrorService.api, "INTERNAL", "PrismaClientKnownRequestError", "/graphql Mutation.saveArticle"],
    [BackendErrorService.api, "PROVIDER_UNAVAILABLE", "MailTransportError", "/graphql Mutation.requestMagicLink"],
    [BackendErrorService.api, "INTERNAL", "TypeError", "/graphql Query.feed"],
    [BackendErrorService.api, "TIMEOUT", "PrismaClientInitializationError", "/graphql Query.me"],
    [BackendErrorService.web, "PAGE_RENDER", "H3Error", "/[section]/[slug]"],
    [BackendErrorService.web, "HYDRATION", "Error", "/me/articles"],
    [BackendErrorService.worker, "JOB_FAILED", "StorageUnavailable", "media.process"],
    [BackendErrorService.worker, "JOB_FAILED", "ProviderTimeout", "ai.check"],
    [BackendErrorService.worker, "JOB_STUCK", "Error", "export.user"]
  ]
  const backendErrorRows: Prisma.BackendErrorCreateManyInput[] = []
  const errorHistoryRows: Prisma.BackendErrorStatusHistoryCreateManyInput[] = []
  const errorEventRows: Prisma.BackendErrorEventCreateManyInput[] = []
  for (let index = 0; index < 48; index += 1) {
    const [service, code, errorClass, route] = pick(errorCatalog)
    const id = uuid()
    const signature = hex(20)
    const firstSeenAt = daysAgo(int(1, 60))
    const workStatus = weighted([
      [BackendErrorWorkStatus.new_record, 50],
      [BackendErrorWorkStatus.in_progress, 25],
      [BackendErrorWorkStatus.resolved, 25]
    ])
    const occurrences = int(1, 120)
    const assignee = workStatus === BackendErrorWorkStatus.new_record ? null : pick(admins)
    backendErrorRows.push({
      id,
      signature,
      service,
      code,
      errorClass,
      sanitizedMessage: `${errorClass}: ${pick(["connection terminated", "cannot read properties of undefined", "timeout after 30000 ms", "unique constraint failed on the fields (slug)"])}`,
      route,
      requestMethod: service === BackendErrorService.worker ? null : pick(["POST", "GET"]),
      requestId: uuid(),
      sanitizedStack: `${errorClass}: …\n    at handler (src/${service}/index.ts:${int(10, 300)}:${int(1, 40)})\n    at process.processTicksAndRejections`,
      actorRole: chance(0.5) ? pick([Role.reader, Role.author, Role.moderator]) : null,
      jobId:
        service === BackendErrorService.worker
          ? pick(jobRows.filter((job) => job.status === JobStatus.failed)).id
          : null,
      workStatus,
      assignedActorId: assignee?.id ?? null,
      assignedActorRole: assignee?.role ?? null,
      firstSeenAt,
      lastSeenAt: after(firstSeenAt, 10, 60 * 24 * 30) > NOW ? NOW : after(firstSeenAt, 10, 60 * 24 * 30),
      occurrenceCount: occurrences
    })
    if (assignee) {
      errorHistoryRows.push({
        backendErrorId: id,
        fromStatus: BackendErrorWorkStatus.new_record,
        toStatus: BackendErrorWorkStatus.in_progress,
        changedByActorId: assignee.id,
        changedByActorRole: assignee.role,
        comment: "Беру в работу",
        createdAt: after(firstSeenAt, 30, 600)
      })
      if (workStatus === BackendErrorWorkStatus.resolved)
        errorHistoryRows.push({
          backendErrorId: id,
          fromStatus: BackendErrorWorkStatus.in_progress,
          toStatus: BackendErrorWorkStatus.resolved,
          changedByActorId: assignee.id,
          changedByActorRole: assignee.role,
          comment: pick(["Исправлено в релизе", "Причина — сбой провайдера", null]),
          createdAt: after(firstSeenAt, 700, 3000)
        })
    }
    for (let n = 0; n < Math.min(occurrences, int(2, 14)); n += 1) {
      errorEventRows.push({
        event:
          service === BackendErrorService.worker
            ? "job.failed"
            : service === BackendErrorService.web
              ? "page.error"
              : pick(["backend.error", "error.unhandled"]),
        stream: service === BackendErrorService.web ? ErrorStream.page : ErrorStream.backend,
        service,
        code,
        route,
        requestId: uuid(),
        errorType: errorClass,
        message: backendErrorRows[backendErrorRows.length - 1].sanitizedMessage,
        stack: backendErrorRows[backendErrorRows.length - 1].sanitizedStack,
        signature,
        occurredAt: after(firstSeenAt, n * 60, n * 60 + 600) > NOW ? NOW : after(firstSeenAt, n * 60, n * 60 + 600)
      })
    }
  }
  await prisma.backendError.createMany({ data: backendErrorRows })
  await prisma.backendErrorStatusHistory.createMany({ data: errorHistoryRows })
  await prisma.backendErrorEvent.createMany({ data: errorEventRows })

  // ----- Аудит и обращения ---------------------------------------------------
  console.log("12/12 аудит и обращения")
  const auditRows: Prisma.AuditLogCreateManyInput[] = []
  const auditPlan: [string, string, () => string, () => SeedUser, () => Prisma.InputJsonValue | undefined][] = [
    ["article.create", "article", () => pick(articleRows).id!, () => pick(authors), () => undefined],
    [
      "article.edit",
      "article",
      () => pick(articleRows).id!,
      () => pick(authors),
      () => ({ title: { from: "Черновик", to: "Новый заголовок" } })
    ],
    [
      "article.archive",
      "article",
      () => pick(archivedArticleIds),
      () => pick(moderators),
      () => ({ status: { from: "published", to: "archived" } })
    ],
    [
      "article.restore",
      "article",
      () => pick(publishedArticleIds),
      () => pick(authors),
      () => ({ status: { from: "archived", to: "published" } })
    ],
    [
      "author.enabled",
      "user",
      () => pick(authors).id,
      () => pick(authors),
      () => ({ planTier: { from: "free", to: "standard" } })
    ],
    ["plan.grant", "user", () => pick(authors).id, () => owner as unknown as SeedUser, () => ({ tier: "pro" })],
    ["plan.revoke", "user", () => pick(authors).id, () => owner as unknown as SeedUser, () => ({ tier: "pro" })],
    [
      "permission.exception.grant",
      "user",
      () => pick(staff).id,
      () => owner as unknown as SeedUser,
      () => ({ permission: "review", kind: "grant" })
    ],
    [
      "permission.exception.revoke",
      "user",
      () => pick(staff).id,
      () => owner as unknown as SeedUser,
      () => ({ permission: "publish" })
    ],
    ["permission.exception.expire", "user", () => pick(staff).id, () => owner as unknown as SeedUser, () => undefined],
    [
      "user.role.change",
      "user",
      () => pick(staff).id,
      () => owner as unknown as SeedUser,
      () => ({ role: { from: "editor", to: "moderator" } })
    ],
    ["user.archive", "user", () => pick(personal).id, () => pick(admins), () => ({ mode: "admin" })],
    ["user.restore", "user", () => pick(personal).id, () => pick(admins), () => undefined],
    ["user.email.change", "user", () => pick(personal).id, () => pick(personal), () => undefined],
    ["admin.read.personal", "user", () => pick(personal).id, () => pick(admins), () => undefined],
    ["session.list", "user", () => pick(personal).id, () => pick(admins), () => undefined],
    [
      "section.update",
      "section",
      () => pick(Object.values(sectionIds)),
      () => owner as unknown as SeedUser,
      () => ({ description: { from: null, to: "Обновлено" } })
    ],
    [
      "section.archive",
      "section",
      () => "dev-section-theatre-archive",
      () => owner as unknown as SeedUser,
      () => ({ successor: "culture" })
    ],
    ["format.update", "format", () => pick(formatIds), () => pick(admins), () => undefined],
    ["tag.merge", "tag", () => pick(activeTags), () => pick(admins), () => ({ from: "vinyl", into: "jazz" })],
    ["tag.archive", "tag", () => pick(activeTags), () => pick(admins), () => undefined],
    ["job.retry", "job", () => pick(jobRows).id!, () => pick(admins), () => undefined],
    ["mail.resend", "mail_message", () => pick(mailRows).id!, () => pick(admins), () => undefined],
    [
      "legal.update",
      "legal_text",
      () => pick(legalRows).id!,
      () => owner as unknown as SeedUser,
      () => ({ version: 2 })
    ]
  ]
  for (let index = 0; index < 1600; index += 1) {
    const [action, entityType, entity, actorOf, diffOf] = pick(auditPlan)
    const actor = actorOf()
    const actorRole = (actor as { role: Role }).role
    auditRows.push({
      action,
      actorId: actor.id,
      actorRole,
      entityType,
      entityId: entity(),
      diff: diffOf(),
      purpose:
        action === "admin.read.personal"
          ? pick(["Разбор обращения", "Проверка жалобы", "Восстановление доступа"])
          : null,
      context: action === "admin.read.personal" ? pick(["/admin/users", "/admin/mail", "/admin/audit"]) : null,
      requestId: uuid(),
      createdAt: daysAgo(int(0, 180))
    })
  }
  await prisma.auditLog.createMany({ data: auditRows })

  const supportRows: Prisma.SupportRequestCreateManyInput[] = []
  for (let index = 0; index < 90; index += 1) {
    const topic = weighted([
      [SupportTopic.general, 35],
      [SupportTopic.broken_link, 20],
      [SupportTopic.refund, 5],
      [SupportTopic.copyright, 10],
      [SupportTopic.restore, 15],
      [SupportTopic.other, 15]
    ])
    const user = chance(0.5) ? pick(personal) : null
    const anonymousLink = topic === SupportTopic.broken_link && !user && chance(0.5)
    supportRows.push({
      topic,
      email: anonymousLink ? null : (user?.email ?? `guest-${index}@example.test`),
      message: anonymousLink
        ? null
        : pick([
            "Не могу войти, ссылка из письма не приходит.",
            "На странице автора битая ссылка.",
            "Прошу восстановить удалённый аккаунт.",
            "В материале использовано моё фото без разрешения.",
            "Предлагаю тему для рубрики «Наука».",
            "Спасибо за журнал!"
          ]),
      path: topic === SupportTopic.broken_link ? `/${pick(Object.keys(sectionIds))}/${pick([...usedSlugs])}` : null,
      requestId: chance(0.2) ? uuid() : null,
      userId: user?.id ?? null,
      locale: user?.locale ?? Locale.ru,
      createdByRequestId: uuid(),
      createdAt: daysAgo(int(0, 150))
    })
  }
  await prisma.supportRequest.createMany({ data: supportRows })

  // ----- Итог ----------------------------------------------------------------
  const counts = {
    users: await prisma.user.count(),
    articles: await prisma.article.count(),
    translations: await prisma.articleTranslation.count(),
    revisions: await prisma.articleRevision.count(),
    reviewMessages: await prisma.reviewMessage.count(),
    reviewNotes: await prisma.reviewNote.count(),
    sections: await prisma.section.count(),
    tags: await prisma.tag.count(),
    media: await prisma.mediaAsset.count(),
    bookmarks: await prisma.bookmark.count(),
    sessions: await prisma.session.count(),
    planGrants: await prisma.planGrant.count(),
    permissionExceptions: await prisma.permissionException.count(),
    jobs: await prisma.job.count(),
    aiProcesses: await prisma.aiProcess.count(),
    mail: await prisma.mailMessage.count(),
    backendErrors: await prisma.backendError.count(),
    errorEvents: await prisma.backendErrorEvent.count(),
    legalTexts: await prisma.legalText.count(),
    consents: await prisma.userLegalConsent.count(),
    audit: await prisma.auditLog.count(),
    supportRequests: await prisma.supportRequest.count()
  }
  console.table(counts)
  console.log(
    "Вход: seed-owner@example.test (owner), seed-admin@example.test (admin); письмо — в Mailpit http://localhost:28025"
  )
}

main()
  .catch((error: unknown) => {
    console.error("dev-seed failed", error)
    process.exitCode = 1
  })
  .finally(async () => {
    await prisma.$disconnect()
  })

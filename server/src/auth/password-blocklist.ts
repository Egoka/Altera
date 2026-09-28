/**
 * Локальный blocklist паролей (утверждено владельцем, журнал §44 п. 1; требования —
 * `docs/reports/2026-09-27-t116-rate-limit-thresholds-proposal.md` «Требования к паролю» п. 3).
 *
 * Список локальный: онлайн-провайдер и передача пароля третьей стороне предложением не вводятся.
 * Обязательных классов символов нет, поэтому blocklist — вторая половина защиты после длины: он
 * отсекает длинные, но ожидаемые строки — повторы слова, ряды клавиатуры, название сервиса и
 * собственные адрес и хэндл пользователя.
 *
 * Сам пароль сюда не попадает ни в лог, ни в ошибку: функции возвращают только признак.
 */

/**
 * Распространённые и известные скомпрометированные строки. Короткие записи оставлены
 * намеренно — они служат основой проверки повторов и подстановок (`passwordpassword`,
 * `p@ssw0rd`), а не самостоятельным правилом: пароль короче 15 символов отсекает длина.
 */
const COMMON_PASSWORDS: readonly string[] = [
  "password",
  "passwort",
  "пароль",
  "qwerty",
  "qwertyuiop",
  "asdfghjkl",
  "zxcvbnm",
  "йцукен",
  "123456",
  "1234567890",
  "abcdefg",
  "abcdefghijklmnop",
  "iloveyou",
  "letmein",
  "welcome",
  "monkey",
  "dragon",
  "sunshine",
  "princess",
  "football",
  "baseball",
  "superman",
  "batman",
  "shadow",
  "master",
  "masterpassword",
  "trustno1",
  "changeme",
  "secret",
  "admin",
  "administrator",
  "root",
  "guest",
  "test",
  "qwerty123",
  "password1",
  "password123",
  "passw0rd",
  "whatever",
  "keyboard",
  "starwars",
  "pokemon",
  "computer",
  "internet",
  "samsung",
  "google",
  "facebook",
  "thisismypassword",
  "mypassword",
  "correcthorsebatterystaple",
  "1qaz2wsx",
  "1q2w3e4r5t",
  "qazwsxedc",
  "zaq12wsx",
  "loveyouforever",
  "nevergonnagiveyouup"
]

/** Название сервиса и его адрес — самое ожидаемое слово в пароле именно этого сайта. */
const SERVICE_WORDS: readonly string[] = ["altera", "alteraru", "alterajournal"]

/** Подстановки символов: `p@ssw0rd` — тот же `password`, и списком его ловить бессмысленно. */
const LEET_MAP: Readonly<Record<string, string>> = {
  "0": "o",
  "1": "i",
  "3": "e",
  "4": "a",
  "5": "s",
  "7": "t",
  "8": "b",
  "9": "g",
  "@": "a",
  $: "s",
  "!": "i",
  "|": "l",
  "+": "t"
}

const lower = (value: string): string => value.normalize("NFKC").toLowerCase()

/** Только буквы и цифры: разделители и регистр ожидаемую строку не делают стойкой. */
const alphanumeric = (value: string): string => lower(value).replace(/[^\p{L}\p{N}]+/gu, "")

const unleet = (value: string): string => [...value].map((character) => LEET_MAP[character] ?? character).join("")

/** Строка целиком собрана повторами одного и того же куска: `wordwordword`. */
const isRepetitionOf = (value: string, unit: string): boolean => {
  if (unit.length === 0 || value.length % unit.length !== 0) return false
  return value === unit.repeat(value.length / unit.length)
}

/** Хвост и голова из цифр или повторов — самый частый способ дотянуть до нужной длины. */
const stripPadding = (value: string): string => value.replace(/^[\d\W_]+/u, "").replace(/[\d\W_]+$/u, "")

const matchesToken = (candidate: string, token: string): boolean => {
  if (token.length < 3) return false
  return candidate === token || isRepetitionOf(candidate, token) || stripPadding(candidate) === token
}

/**
 * Ряды, которые набирают подряд: цифры, латиница, кириллица и раскладка клавиатуры. Длина сама
 * по себе от них не спасает — «123456789012345» ровно пятнадцать символов, — а класса символов
 * это правило не требует: отсекается именно ожидаемая последовательность, а не отсутствие цифры
 * или заглавной буквы (обязательных классов утверждённые требования не вводят).
 */
const SEQUENCES: readonly string[] = [
  "01234567890123456789012345678901234567890",
  "abcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyz",
  "абвгдеёжзийклмнопрстуфхцчшщъыьэюя",
  "qwertyuiopasdfghjklzxcvbnm",
  "йцукенгшщзхъфывапролджэячсмитьбю"
].flatMap((row) => [row, [...row].reverse().join("")])

const MIN_SEQUENCE_LENGTH = 6

/** Один символ на всю строку или кусок такого ряда. */
const isTrivialSequence = (value: string): boolean => {
  if (value.length < 3) return false
  if (new Set(value).size === 1) return true
  if (value.length < MIN_SEQUENCE_LENGTH) return false

  return SEQUENCES.some((sequence) => sequence.includes(value))
}

/** Что ещё ожидаемо именно у этого пользователя: его адрес, локальная часть, хэндл, имя. */
export interface PasswordOwnerHints {
  email?: string | null
  handle?: string | null
  name?: string | null
}

const ownerTokens = (hints: PasswordOwnerHints): string[] => {
  const tokens: string[] = []
  const email = hints.email ? lower(hints.email) : null
  if (email) {
    tokens.push(alphanumeric(email))
    const [local, domain] = email.split("@")
    if (local) tokens.push(alphanumeric(local))
    if (domain) tokens.push(alphanumeric(domain.split(".")[0] ?? domain))
  }
  if (hints.handle) tokens.push(alphanumeric(hints.handle))
  if (hints.name) tokens.push(alphanumeric(hints.name))

  return tokens.filter((token) => token.length >= 3)
}

/**
 * Пароль сверяется целиком, а не по вхождению подстроки: длинная фраза с общим словом внутри
 * остаётся стойкой, а «слово, повтор слова и цифры в конце» — нет.
 */
export function isBlockedPassword(password: string, hints: PasswordOwnerHints = {}): boolean {
  const candidates = new Set<string>()
  for (const form of [lower(password), alphanumeric(password)]) {
    candidates.add(form)
    candidates.add(unleet(form))
    candidates.add(alphanumeric(unleet(form)))
  }

  const tokens = [...COMMON_PASSWORDS, ...SERVICE_WORDS, ...ownerTokens(hints)].map(alphanumeric)

  for (const candidate of candidates) {
    if (candidate.length === 0) continue
    if (isTrivialSequence(candidate)) return true
    if (tokens.some((token) => matchesToken(candidate, token))) return true
  }

  return false
}

// [ДОПУЩЕНИЕ] `next` — только относительный путь внутри сайта (docs/spec/20-public/login.md §3):
// абсолютные адреса, протокол-относительные ссылки и управляющие символы отбрасываются, чтобы
// ссылка из письма не уводила на чужой домен.
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/

export function sanitizeNextPath(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null

  const candidate = value.trim()
  if (candidate.length === 0 || candidate.length > 512) return null
  if (CONTROL_CHARACTERS.test(candidate)) return null
  if (!candidate.startsWith("/")) return null
  // `//host` и `/\host` браузер разбирает как протокол-относительный внешний адрес.
  if (candidate.startsWith("//") || candidate.startsWith("/\\")) return null

  return candidate
}

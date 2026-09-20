// [ДОПУЩЕНИЕ] `next` — только относительный путь внутри сайта (docs/spec/20-public/login.md §3).
// Зеркалит серверную проверку `server/src/auth/next-path.ts`: страница не должна отправлять
// в письмо адрес, который сервер всё равно отбросит.
export function sanitizeNextPath(value: unknown): string | null {
  if (typeof value !== "string") return null

  const candidate = value.trim()
  if (candidate.length === 0 || candidate.length > 512) return null
  if (/[\u0000-\u001f\u007f]/.test(candidate)) return null
  if (!candidate.startsWith("/")) return null
  if (candidate.startsWith("//") || candidate.startsWith("/\\")) return null

  return candidate
}

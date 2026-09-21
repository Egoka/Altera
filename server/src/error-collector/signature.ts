import { createHash } from "node:crypto"

/**
 * Сколько верхних кадров стека входит в сигнатуру. Спецификация говорит «первые кадры стека без
 * адресов» (`error-collector.md` §2 п. 3, `[ДОПУЩЕНИЕ]`) и числа не задаёт; это техническая
 * константа группировки, а не продуктовое правило.
 */
export const SIGNATURE_STACK_FRAMES = 5

const framePattern = /^\s*at\s+/
const locationPattern = /:\d+(?::\d+)?(?=\)?$)/
const addressPattern = /\b0x[0-9a-f]+\b/gi

/**
 * Кадр без адресов: номера строки и столбца, шестнадцатеричные адреса и каталог файла убираются —
 * иначе одна и та же ошибка расходилась бы по группам между сборками и хостами.
 */
function normalizeFrame(line: string): string {
  const frame = line.replace(framePattern, "").trim().replace(locationPattern, "").replace(addressPattern, "0x")
  return frame.replace(/(?:[A-Za-z]:)?[^\s()]*[\\/]([^\\/\s()]+)/g, "$1")
}

export function normalizeStack(stack: string | null | undefined): string[] {
  if (!stack) return []
  return stack
    .split("\n")
    .filter((line) => framePattern.test(line))
    .slice(0, SIGNATURE_STACK_FRAMES)
    .map(normalizeFrame)
}

export function errorSignature(parts: {
  stream: string
  service: string
  code: string
  route: string | null
  stack: string | null
}): string {
  const material = [parts.stream, parts.service, parts.code, parts.route ?? "", ...normalizeStack(parts.stack)]
  return createHash("sha256").update(material.join("\n")).digest("hex")
}

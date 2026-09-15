import { readFileSync } from "node:fs"
import path from "node:path"
import { describe, expect, test } from "vitest"
import { ERROR_DEFINITIONS } from "../src/errors/dictionary"
import { LOG_EVENT_CODES } from "../src/observability/log-events"

type RegistryCodeType = "error" | "log"

const registryPath = path.resolve(__dirname, "../../docs/spec/00-registries/events-and-logs.md")

function extractCodes(cell: string): string[] {
  let prefix = ""

  return [...cell.matchAll(/`([^`]+)`/g)].map((match) => {
    const code = match[1]
    if (!code.startsWith(".")) {
      prefix = code.slice(0, code.lastIndexOf(".") + 1)
      return code
    }

    return `${prefix}${code.slice(1)}`
  })
}

function approvedRegistryCodes(type: RegistryCodeType): string[] {
  const registry = readFileSync(registryPath, "utf8")

  return registry
    .split("\n")
    .filter((line) => line.startsWith("|"))
    .map((line) =>
      line
        .split("|")
        .slice(1, -1)
        .map((cell) => cell.trim())
    )
    .filter((cells) => cells[2] === type && cells[10]?.startsWith("утверждён"))
    .flatMap((cells) => extractCodes(cells[1]))
    .sort()
}

describe("event code registry", () => {
  test("approved log codes match LOG_EVENT_CODES bijectively", () => {
    expect([...LOG_EVENT_CODES].sort()).toEqual(approvedRegistryCodes("log"))
  })

  test("approved error codes match ERROR_DEFINITIONS bijectively", () => {
    expect(Object.keys(ERROR_DEFINITIONS).sort()).toEqual(approvedRegistryCodes("error"))
  })
})

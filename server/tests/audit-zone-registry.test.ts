import { readFileSync } from "node:fs"
import path from "node:path"
import { describe, expect, test } from "vitest"
import { AUDIT_CODE_ZONES, AUDIT_EVENT_CODES, auditCodesForZone } from "../src/audit/registry"

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

/**
 * Строка #21 помечена «audit (лог для `requested`)», поэтому тип сравнивается по началу ячейки:
 * иначе утверждённые платёжные коды выпали бы из реестра зон и стали бы невидимы аналитику.
 */
function approvedAuditCodes(): string[] {
  return readFileSync(registryPath, "utf8")
    .split("\n")
    .filter((line) => line.startsWith("|"))
    .map((line) =>
      line
        .split("|")
        .slice(1, -1)
        .map((cell) => cell.trim())
    )
    .filter((cells) => cells[2]?.startsWith("audit") && cells[10]?.startsWith("утверждён"))
    .flatMap((cells) => extractCodes(cells[1]))
    .sort()
}

describe("audit zone registry", () => {
  test("охватывает утверждённые audit-коды реестра биективно", () => {
    expect([...AUDIT_EVENT_CODES].sort()).toEqual(approvedAuditCodes())
  })

  test("каждая зона содержит свои коды, а закрытые коды не попадают ни в одну зону", () => {
    expect(auditCodesForZone("editorial")).toContain("article.archive")
    expect(auditCodesForZone("moderation")).toContain("translation.unpublish")
    expect(auditCodesForZone("financeAndPd")).toContain("admin.read.personal")

    expect(auditCodesForZone("editorial")).not.toContain("settings.change")
    expect(auditCodesForZone("moderation")).not.toContain("settings.change")
    expect(auditCodesForZone("financeAndPd")).not.toContain("settings.change")
    expect(AUDIT_CODE_ZONES["settings.change"]).toEqual([])
  })

  test("зоны берутся только из трёх тем visibility.md п. 10", () => {
    const zones = new Set(Object.values(AUDIT_CODE_ZONES).flat())

    expect([...zones].sort()).toEqual(["editorial", "financeAndPd", "moderation"])
  })
})

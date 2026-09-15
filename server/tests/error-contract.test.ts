import { execFileSync } from "node:child_process"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { describe, expect, it } from "vitest"
import { isErrorCode } from "../src/errors/dictionary"

const repositoryRoot = resolve(import.meta.dirname, "../..")
const sourceFiles = execFileSync("git", ["ls-files", "server/src/**/*.ts", "server/src/**/*.js"], {
  cwd: repositoryRoot,
  encoding: "utf8"
})
  .trim()
  .split("\n")
  .filter((path) => path && !path.startsWith("server/src/generated/"))

describe("server error source contract", () => {
  it("uses the application logger instead of console sinks", () => {
    const violations = sourceFiles.filter((path) =>
      /\bconsole\.(?:log|info|warn|error)\s*\(/.test(readFileSync(resolve(repositoryRoot, path), "utf8"))
    )
    expect(violations).toEqual([])
  })

  it("constructs GraphQLError only inside the canonical boundary", () => {
    const violations = sourceFiles.filter((path) => {
      if (path === "server/src/errors/graphql-error.ts") return false
      return /(?:from\s+["']graphql["']|new\s+GraphQLError\s*\()/.test(
        readFileSync(resolve(repositoryRoot, path), "utf8")
      )
    })
    expect(violations).toEqual([])
  })

  it("uses only registered literal codes in createApiError calls", () => {
    const violations: string[] = []
    for (const path of sourceFiles) {
      const source = readFileSync(resolve(repositoryRoot, path), "utf8")
      for (const match of source.matchAll(/createApiError\(\s*["']([^"']+)["']/g)) {
        if (!isErrorCode(match[1])) violations.push(`${path}:${match[1]}`)
      }
    }
    expect(violations).toEqual([])
  })
})

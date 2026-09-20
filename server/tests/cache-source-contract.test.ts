import { execFileSync } from "node:child_process"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { describe, expect, it } from "vitest"

const repositoryRoot = resolve(import.meta.dirname, "../..")
const sourceFiles = execFileSync("git", ["ls-files", "server/src/**/*.ts", "server/src/**/*.js"], {
  cwd: repositoryRoot,
  encoding: "utf8"
})
  .trim()
  .split("\n")
  .filter((path) => path && !path.startsWith("server/src/generated/"))

/**
 * Обход keyspace блокирует Redis целиком, поэтому инвалидация T-006 устроена на тегах и
 * обратном индексе. Критерий «в коде нет `KEYS`» до сих пор держался ручным grep, а клиентов
 * Redis в сервере уже два (кеш и счётчики лимитов). Тест переносит проверку в набор.
 */
const KEYSPACE_COMMANDS = /redis\.call\(\s*["'](KEYS|SCAN|HSCAN|SSCAN|ZSCAN|RANDOMKEY)["']/i
const KEYSPACE_CLIENT_CALLS = /\.(keys|scan|scanStream|hscan|sscan|zscan|randomkey)\s*\(/i
const OBJECT_KEYS = /\b(Object|Reflect)\.keys\s*\(/g
const MAP_LIKE_KEYS = /\.(entries|handlers|rules|zones|codes|cache|store|map)\.keys\s*\(/gi

describe("контракт исходников кеша", () => {
  it("не содержит команд обхода keyspace в Lua-скриптах", () => {
    const violations = sourceFiles.filter((path) =>
      KEYSPACE_COMMANDS.test(readFileSync(resolve(repositoryRoot, path), "utf8"))
    )
    expect(violations).toEqual([])
  })

  it("не вызывает keyspace-методы Redis-клиентов", () => {
    const violations: string[] = []

    for (const path of sourceFiles) {
      // `Object.keys` и `Map.keys` к Redis отношения не имеют и из проверки исключены:
      // отличить их от команд клиента можно только по имени получателя.
      const source = readFileSync(resolve(repositoryRoot, path), "utf8")
        .replace(OBJECT_KEYS, "")
        .replace(MAP_LIKE_KEYS, "")
        .replace(/\[\s*\.\.\.[^\]]*\.keys\s*\(\s*\)\s*\]/g, "")

      if (KEYSPACE_CLIENT_CALLS.test(source)) violations.push(path)
    }

    expect(violations).toEqual([])
  })

  it("описывает контракт Redis-клиента кеша без keyspace-команд", () => {
    const redisCache = readFileSync(resolve(repositoryRoot, "server/src/cache/redis.ts"), "utf8")
    const clientContract = redisCache.slice(
      redisCache.indexOf("export interface CacheRedisClient"),
      redisCache.indexOf("const DELETE_DATA_KEY_LUA")
    )

    expect(clientContract).not.toMatch(/\b(keys|scan)\s*\(/i)
    expect(clientContract).toContain("eval(")
  })
})

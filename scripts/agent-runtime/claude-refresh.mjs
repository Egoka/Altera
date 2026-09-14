// Trusted container operation: секреты доступны только фиксированному дочернему Claude CLI.
import { spawn } from "node:child_process"
import fs from "node:fs"
import { pathToFileURL } from "node:url"

export const LIMITS = Object.freeze({
  credentialBytes: 65536,
  depth: 16,
  stringBytes: 16384,
  childBytes: 8192,
  exchangeMs: 60000,
  statusMs: 30000,
  modelMs: 120000
})
const object = (value) => value !== null && typeof value === "object" && !Array.isArray(value)
const own = (value, key) => Object.hasOwn(value, key)

function boundedJson(bytes) {
  if (bytes.length > LIMITS.credentialBytes) throw new Error("invalid_json")
  const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes)
  const result = JSON.parse(text)
  const pending = [[result, 1]]
  while (pending.length) {
    const [value, depth] = pending.pop()
    if (typeof value === "string" && Buffer.byteLength(value) > LIMITS.stringBytes) throw new Error("invalid_json")
    if (value && typeof value === "object") {
      if (depth > LIMITS.depth) throw new Error("invalid_json")
      for (const [key, item] of Object.entries(value)) {
        if (Buffer.byteLength(key) > LIMITS.stringBytes) throw new Error("invalid_json")
        pending.push([item, depth + 1])
      }
    }
  }
  // JSON.parse уже проверил грамматику; отдельный проход запрещает duplicate object keys.
  const stack = []
  for (let i = 0; i < text.length; i++) {
    const char = text[i]
    if (char === "{" || char === "[") stack.push({ object: char === "{", keys: new Set(), key: true })
    else if (char === "}" || char === "]") stack.pop()
    else if (char === "," && stack.at(-1)?.object) stack.at(-1).key = true
    else if (char === '"') {
      const start = i++
      while (text[i] !== '"') {
        if (text[i] === "\\") i++
        i++
      }
      const frame = stack.at(-1)
      if (frame?.object && frame.key) {
        const key = JSON.parse(text.slice(start, i + 1))
        if (frame.keys.has(key)) throw new Error("invalid_json")
        frame.keys.add(key)
        frame.key = false
      }
    }
  }
  return result
}

export function parseCredential(bytes) {
  try {
    const data = boundedJson(bytes)
    if (!object(data) || !own(data, "claudeAiOauth") || !object(data.claudeAiOauth)) throw new Error()
    const oauth = data.claudeAiOauth
    if (
      !own(oauth, "refreshToken") ||
      typeof oauth.refreshToken !== "string" ||
      !oauth.refreshToken ||
      oauth.refreshToken.includes("\0")
    )
      throw new Error()
    if (
      !own(oauth, "scopes") ||
      !Array.isArray(oauth.scopes) ||
      !oauth.scopes.length ||
      oauth.scopes.some((scope) => typeof scope !== "string" || !scope || /[\s\0]/u.test(scope))
    )
      throw new Error()
    if (
      own(oauth, "clientId") &&
      (typeof oauth.clientId !== "string" ||
        !oauth.clientId ||
        Buffer.byteLength(oauth.clientId) > 256 ||
        /[\s\x00-\x1f\x7f]/u.test(oauth.clientId))
    )
      throw new Error()
    return {
      refreshToken: oauth.refreshToken,
      scopes: oauth.scopes.join(" "),
      ...(own(oauth, "clientId") ? { clientId: oauth.clientId } : {})
    }
  } catch {
    throw new Error("invalid_credential")
  }
}

export function fixedCommand(operation) {
  if (operation === "exchange") return ["/usr/local/bin/claude", "auth", "login"]
  if (operation === "status") return ["/usr/local/bin/claude", "auth", "status"]
  if (operation === "model")
    return [
      "/usr/local/bin/claude",
      "--print",
      "--output-format",
      "json",
      "--model",
      "claude-opus-4-6",
      "--effort",
      "medium",
      "--tools",
      "",
      "--strict-mcp-config",
      "--mcp-config",
      "/runtime/policy/empty-mcp.json",
      "--settings",
      "/runtime/policy/claude-settings.json",
      "Reply exactly ALTERA_CLAUDE_AUTH_OK"
    ]
  throw new Error("unsupported_operation")
}

export function childEnvironment(operation, fields = {}) {
  fixedCommand(operation)
  const env = {
    PATH: "/usr/local/bin:/usr/bin:/bin",
    HOME: "/runtime/cache/home",
    CLAUDE_CONFIG_DIR: operation === "exchange" ? "/runtime/output/claude" : "/runtime/cache/claude",
    TMPDIR: "/runtime/tmp",
    TMP: "/runtime/tmp",
    TEMP: "/runtime/tmp",
    XDG_CACHE_HOME: "/runtime/cache/xdg",
    HTTPS_PROXY: "http://egress-proxy:8080",
    HTTP_PROXY: "http://egress-proxy:8080",
    ALL_PROXY: "http://egress-proxy:8080",
    NO_PROXY: "",
    NODE_USE_ENV_PROXY: "1"
  }
  if (operation === "exchange") {
    env.CLAUDE_CODE_OAUTH_REFRESH_TOKEN = fields.refreshToken
    env.CLAUDE_CODE_OAUTH_SCOPES = fields.scopes
    if (own(fields, "clientId")) env.CLAUDE_CODE_OAUTH_CLIENT_ID = fields.clientId
  }
  return env
}

function usageResult(data) {
  const numeric = (value) => typeof value === "number" && Number.isFinite(value) && value >= 0
  if (!object(data.modelUsage) || data.modelUsage["claude-opus-4-6"]?.canonicalModel !== "claude-opus-4-6")
    throw new Error()
  const models = {}
  for (const [name, value] of Object.entries(data.modelUsage)) {
    const canonical = { "claude-opus-4-6": "claude-opus-4-6", "claude-haiku-4-5-20251001": "claude-haiku-4-5" }[name]
    if (
      !canonical ||
      !object(value) ||
      value.canonicalModel !== canonical ||
      value.provider !== "firstParty" ||
      value.costBasis !== "list"
    )
      throw new Error()
    const clean = { canonicalModel: canonical, provider: "firstParty", costBasis: "list" }
    for (const field of [
      "inputTokens",
      "outputTokens",
      "cacheReadInputTokens",
      "cacheCreationInputTokens",
      "webSearchRequests",
      "costUSD",
      "contextWindow",
      "maxOutputTokens",
      "thinkingTokens"
    ]) {
      if (own(value, field)) {
        if (!numeric(value[field])) throw new Error()
        clean[field] = value[field]
      }
    }
    if (clean.webSearchRequests) throw new Error()
    models[name] = clean
  }
  const usage = {}
  if (!object(data.usage) || !numeric(data.total_cost_usd)) throw new Error()
  for (const key of ["input_tokens", "output_tokens", "cache_creation_input_tokens", "cache_read_input_tokens"]) {
    if (own(data.usage, key)) {
      if (!numeric(data.usage[key])) throw new Error()
      usage[key] = data.usage[key]
    }
  }
  for (const [key, fields] of [
    ["output_tokens_details", ["thinking_tokens"]],
    ["cache_creation", ["ephemeral_1h_input_tokens", "ephemeral_5m_input_tokens"]],
    ["server_tool_use", ["web_search_requests", "web_fetch_requests"]]
  ]) {
    if (own(data.usage, key)) {
      if (!object(data.usage[key])) throw new Error()
      usage[key] = {}
      for (const field of fields)
        if (own(data.usage[key], field)) {
          const value = data.usage[key][field]
          if (!numeric(value) || (key === "server_tool_use" && value !== 0)) throw new Error()
          usage[key][field] = value
        }
    }
  }
  return { usage, modelUsage: models, totalCostUsd: data.total_cost_usd, billingVerified: false }
}

export function classify(operation, code, stdout, stderr) {
  if (operation === "exchange") {
    const browserHandoffObserved = [
      "Opening browser to sign in",
      "If the browser didn't open, visit: ",
      "Paste code here if prompted > "
    ].some((text) => (stdout + stderr).includes(text))
    const refreshBranchObserved = stderr.split("\n").some((line) => line.startsWith("Login failed: "))
    return {
      status: browserHandoffObserved ? "browser_flow_rejected" : code === 0 ? "exchange_succeeded" : "exchange_failed",
      refreshBranchObserved,
      browserHandoffObserved
    }
  }
  try {
    if (code !== 0) throw new Error()
    const data = boundedJson(Buffer.from(stdout))
    if (operation === "status")
      return {
        status: data.loggedIn === true && data.authMethod === "claude.ai" ? "authenticated" : "status_unaccepted"
      }
    if (
      operation !== "model" ||
      data.type !== "result" ||
      data.subtype !== "success" ||
      data.is_error !== false ||
      typeof data.result !== "string" ||
      data.result.trim() !== "ALTERA_CLAUDE_AUTH_OK"
    )
      throw new Error()
    return { status: "model_accepted", ...usageResult(data) }
  } catch {
    return { status: operation === "status" ? "status_unaccepted" : "model_unaccepted" }
  }
}

export function runChild(operation, env, dependencies = {}) {
  const command = fixedCommand(operation)
  const spawnProcess = dependencies.spawnProcess || spawn
  const killGroup =
    dependencies.killGroup ||
    ((pid) => {
      try {
        process.kill(-pid, "SIGKILL")
      } catch {
        /* Процесс мог уже завершиться. */
      }
    })
  const setTimer = dependencies.setTimer || setTimeout
  const clearTimer = dependencies.clearTimer || clearTimeout
  return new Promise((resolve) => {
    let child,
      timer,
      forced,
      finished = false,
      bytes = 0
    const out = [],
      errors = []
    function finish(code) {
      if (finished) return
      finished = true
      clearTimer(timer)
      const result = forced
        ? { status: forced }
        : classify(operation, code, Buffer.concat(out).toString("utf8"), Buffer.concat(errors).toString("utf8"))
      for (const chunk of [...out, ...errors]) chunk.fill(0)
      resolve(result)
    }
    function stop(status) {
      if (!forced) forced = status
      if (child?.pid) killGroup(child.pid)
    }
    try {
      child = spawnProcess(command[0], command.slice(1), { env, detached: true, stdio: ["ignore", "pipe", "pipe"] })
      const capture = (list) => (data) => {
        bytes += data.length
        if (bytes > LIMITS.childBytes) {
          stop("output_limit")
          return
        }
        list.push(Buffer.from(data))
      }
      child.stdout.on("data", capture(out))
      child.stderr.on("data", capture(errors))
      child.on("error", () => {
        forced = "child_failed"
        finish(null)
      })
      child.on("close", (code) => finish(code))
      timer = setTimer(
        () => stop("timeout"),
        { exchange: LIMITS.exchangeMs, status: LIMITS.statusMs, model: LIMITS.modelMs }[operation]
      )
    } catch {
      forced = "child_failed"
      finish(null)
    }
  })
}

function readRefreshFields() {
  const fd = fs.openSync("/runtime/input/.credentials.json", fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW)
  const bytes = Buffer.alloc(LIMITS.credentialBytes + 1)
  try {
    const info = fs.fstatSync(fd)
    if (
      !info.isFile() ||
      info.nlink !== 1 ||
      info.uid !== process.getuid() ||
      (info.mode & 0o777) !== 0o600 ||
      info.size > LIMITS.credentialBytes
    )
      throw new Error()
    const size = fs.readSync(fd, bytes, 0, bytes.length, 0)
    if (size !== info.size) throw new Error()
    return parseCredential(bytes.subarray(0, size))
  } finally {
    bytes.fill(0)
    fs.closeSync(fd)
  }
}

export async function main(args) {
  try {
    if (args.length !== 1) throw new Error()
    const operation = args[0]
    fixedCommand(operation)
    let fields
    try {
      fields = operation === "exchange" ? readRefreshFields() : {}
    } catch {
      return { status: "invalid_credential" }
    }
    return await runChild(operation, childEnvironment(operation, fields))
  } catch {
    return { status: "invalid_operation" }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const result = await main(process.argv.slice(2))
  process.stdout.write(JSON.stringify(result) + "\n")
  process.exitCode = ["exchange_succeeded", "authenticated", "model_accepted"].includes(result.status) ? 0 : 1
}

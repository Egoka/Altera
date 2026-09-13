// No-model проверка точного reviewer MCP roster внутри изолированного runtime.
import { spawn, spawnSync } from "node:child_process"
import fs from "node:fs"
import http from "node:http"
import readline from "node:readline"
import { pathToFileURL } from "node:url"

const LIMIT = 524288
const ENDPOINT = "https://mcp.context7.com/mcp"
const VERSION = "2025-03-26"
const clientInfo = { name: "altera-reviewer-mcp-canary", version: "1.0.0" }

export function acceptedResult(message, id) {
  if (
    !message ||
    message.jsonrpc !== "2.0" ||
    message.id !== id ||
    "error" in message ||
    !message.result ||
    typeof message.result !== "object" ||
    Array.isArray(message.result) ||
    message.result.isError
  )
    throw new Error("rpc_result_unaccepted")
  return message.result
}

function sseMessages(text) {
  return text
    .replaceAll("\r\n", "\n")
    .split("\n\n")
    .slice(0, -1)
    .flatMap((event) => {
      const data = event
        .split("\n")
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice(5).replace(/^ /, ""))
        .join("\n")
      return data ? [JSON.parse(data)] : []
    })
}

export function decodeRpc(text, contentType, id) {
  const type = contentType.split(";")[0].trim()
  const messages =
    type === "application/json" ? [JSON.parse(text)] : type === "text/event-stream" ? sseMessages(text) : []
  const message = messages.find((item) => item?.id === id)
  acceptedResult(message, id)
  return message
}

export async function readRpc(response, id) {
  const type = response.headers.get("content-type") || ""
  if (!response.ok || !/^(application\/json|text\/event-stream)(;|$)/.test(type)) {
    throw new Error(`http_response_unaccepted_${response.status}`)
  }
  const reader = response.body.getReader()
  const decoder = new TextDecoder("utf-8", { fatal: true })
  let text = ""
  let size = 0
  try {
    while (true) {
      const { value, done } = await reader.read()
      if (done) return decodeRpc(text + decoder.decode(), type, id)
      size += value.byteLength
      if (size > LIMIT) throw new Error("rpc_body_limit")
      text += decoder.decode(value, { stream: true })
      if (type.startsWith("text/event-stream")) {
        const message = sseMessages(text).find((item) => item?.id === id)
        if (message) {
          acceptedResult(message, id)
          return message
        }
      }
    }
  } finally {
    await reader.cancel()
  }
}

export function libraryIds(result) {
  if (result?.isError || !Array.isArray(result?.content)) throw new Error("library_result_unaccepted")
  const text = result.content
    .filter((item) => item.type === "text")
    .map((item) => item.text)
    .join("\n")
  const ids = [
    ...text.matchAll(/^\s*-?\s*Context7-compatible library ID:\s*(\/[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_./-]+)\s*$/gim)
  ].map((match) => match[1])
  if (!ids.length) throw new Error("library_result_unaccepted")
  return ids
}

function record(name, data) {
  const text = JSON.stringify(data, null, 2) + "\n"
  if (Buffer.byteLength(text) > LIMIT) throw new Error("evidence_limit")
  fs.writeFileSync(`/runtime/evidence/${name}.json`, text)
}

export function traceAccepted(map, outline) {
  function payload(result) {
    if (result?.isError || result?.content?.length !== 1 || result.content[0].type !== "text") {
      throw new Error("trace_content_unaccepted")
    }
    return JSON.parse(result.content[0].text)
  }
  const summary = payload(map)
  const file = payload(outline)
  if (
    summary?.fileCount !== 1 ||
    summary.symbolCount !== 1 ||
    !summary.languages?.includes("javascript") ||
    file?.path !== "sample.js" ||
    file.language !== "javascript" ||
    file._freshness !== "fresh" ||
    !file.symbols?.some(
      (symbol) =>
        symbol.symbolId === "sample.js::answer#function" && symbol.name === "answer" && symbol.kind === "function"
    )
  ) {
    throw new Error("trace_content_unaccepted")
  }
}

async function context7() {
  let session
  let id = 0
  const exchanges = []
  async function request(method, params, notification = false) {
    const body = { jsonrpc: "2.0", ...(notification ? {} : { id: ++id }), method, ...(params ? { params } : {}) }
    const headers = { "Content-Type": "application/json", Accept: "application/json, text/event-stream" }
    if (session) headers["Mcp-Session-Id"] = session
    if (method !== "initialize") headers["MCP-Protocol-Version"] = VERSION
    const response = await fetch(ENDPOINT, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      redirect: "error",
      signal: AbortSignal.timeout(25000)
    })
    // Session ID остаётся только в памяти: headers никогда не входят в evidence.
    if (method === "initialize") session = response.headers.get("mcp-session-id") || undefined
    const exchange = { request: body, status: response.status }
    exchanges.push(exchange)
    record("context7-protocol", exchanges)
    if (notification) {
      await response.body?.cancel()
      if (response.status !== 202) throw new Error("initialized_notification_unaccepted")
      return
    }
    exchange.response = await readRpc(response, body.id)
    record("context7-protocol", exchanges)
    return acceptedResult(exchange.response, body.id)
  }
  const initialized = await request("initialize", { protocolVersion: VERSION, capabilities: {}, clientInfo })
  if (initialized.protocolVersion !== VERSION || !initialized.serverInfo) throw new Error("initialize_unaccepted")
  await request("notifications/initialized", undefined, true)
  const tools = await request("tools/list", {})
  if (!tools.tools?.some((tool) => tool.name === "resolve-library-id")) throw new Error("resolve_tool_missing")
  const result = await request("tools/call", {
    name: "resolve-library-id",
    arguments: { libraryName: "react", query: "Synthetic public documentation lookup for the React useState API." }
  })
  return { endpoint: ENDPOINT, tool: "resolve-library-id", libraryIds: libraryIds(result) }
}

async function trace() {
  const index = spawnSync("/usr/local/bin/trace-mcp", ["index", process.cwd()], {
    encoding: "utf8",
    timeout: 30000,
    maxBuffer: LIMIT
  })
  fs.writeFileSync("/runtime/evidence/trace-index.log", ((index.stdout || "") + (index.stderr || "")).slice(0, LIMIT))
  record("trace-index-exit", { exit: index.status, signal: index.signal })
  if (index.status !== 0) throw new Error("trace_index_failed")
  const child = spawn("/usr/local/bin/trace-mcp", ["serve"], { stdio: ["pipe", "pipe", "pipe"] })
  const pending = new Map()
  const exchanges = []
  let stderr = ""
  let bytes = 0
  let nextId = 0
  let childFailure
  const fail = () => {
    childFailure = new Error("trace_process_failed")
    for (const callback of pending.values()) callback.reject(childFailure)
    pending.clear()
  }
  child.on("error", fail)
  child.on("exit", fail)
  child.stdin.on("error", fail)
  child.stderr.on("data", (data) => {
    stderr = (stderr + data.toString()).slice(0, LIMIT)
  })
  child.stdout.on("data", (data) => {
    bytes += data.byteLength
    if (bytes > LIMIT * 4) {
      fail()
      child.kill("SIGTERM")
    }
  })
  const lines = readline.createInterface({ input: child.stdout })
  lines.on("line", (line) => {
    try {
      const message = JSON.parse(line)
      const callback = pending.get(message.id)
      if (callback) {
        pending.delete(message.id)
        callback.resolve(message)
      }
    } catch {
      /* Произвольный stdout не считается ответом MCP. */
    }
  })
  async function request(method, params) {
    if (childFailure) throw childFailure
    const body = { jsonrpc: "2.0", id: ++nextId, method, params }
    let timer
    try {
      const response = await new Promise((resolve, reject) => {
        timer = setTimeout(() => {
          pending.delete(body.id)
          reject(new Error("trace_timeout"))
        }, 25000)
        pending.set(body.id, { resolve, reject })
        child.stdin.write(JSON.stringify(body) + "\n")
      })
      exchanges.push({ request: body, response })
      record("trace-protocol", exchanges)
      return acceptedResult(response, body.id)
    } finally {
      clearTimeout(timer)
    }
  }
  try {
    const initialized = await request("initialize", { protocolVersion: VERSION, capabilities: {}, clientInfo })
    if (!initialized.serverInfo || !initialized.protocolVersion) throw new Error("trace_initialize_unaccepted")
    child.stdin.write('{"jsonrpc":"2.0","method":"notifications/initialized"}\n')
    const tools = await request("tools/list", {})
    for (const name of ["get_project_map", "get_outline"]) {
      if (!tools.tools?.some((tool) => tool.name === name)) throw new Error("trace_tool_missing")
    }
    const map = await request("tools/call", { name: "get_project_map", arguments: { summary_only: true } })
    const outline = await request("tools/call", { name: "get_outline", arguments: { path: "sample.js" } })
    traceAccepted(map, outline)
    return {
      command: "/usr/local/bin/trace-mcp",
      args: ["serve"],
      indexExit: 0,
      tools: ["get_project_map", "get_outline"],
      projectMap: true,
      outline: true
    }
  } finally {
    lines.close()
    child.kill("SIGTERM")
    const killTimer = setTimeout(() => child.kill("SIGKILL"), 1000)
    killTimer.unref()
    fs.writeFileSync("/runtime/evidence/trace-stderr.log", stderr)
  }
}

function forbidden(destination) {
  return new Promise((resolve, reject) => {
    const request = http.request({
      host: "egress-proxy",
      port: 8080,
      method: "CONNECT",
      path: destination,
      timeout: 10000
    })
    request.on("timeout", () => request.destroy(new Error("connect_timeout")))
    request.on("error", reject)
    request.on("connect", (response, socket) => {
      socket.destroy()
      resolve(response.statusCode)
    })
    request.end()
  })
}

export async function main() {
  const report = { modelLaunched: false, tokenAbsent: !process.env.MULTICA_TOKEN, phases: {} }
  for (const [name, action] of [
    [
      "forbidden",
      async () => {
        const destinations = [
          "host.docker.internal:443",
          "127.0.0.1:443",
          "169.254.169.254:443",
          "mcp.context7.com:80",
          "mcp.context7.com.:443",
          "mcp.context7.com.evil.invalid:443"
        ]
        const statuses = await Promise.all(destinations.map(forbidden))
        record("forbidden-connect", { destinations, statuses })
        if (statuses.some((status) => status !== 403)) throw new Error("forbidden_destination_accepted")
        return { destinations, statuses }
      }
    ],
    ["trace", trace],
    ["context7", context7]
  ]) {
    try {
      report.phases[name] = { ok: true, result: await action() }
    } catch (error) {
      // Только локальные коды ошибок; исключения fetch/JSON не раскрывают данные сервера.
      const known = /^(rpc_|http_response_|initialized_|initialize_|resolve_|library_|trace_|forbidden_|evidence_)/
      report.phases[name] = {
        ok: false,
        error: known.test(error.message) ? error.message : "transport_or_protocol_error"
      }
    }
  }
  record("reviewer-mcp-result", report)
  process.stdout.write(JSON.stringify(report) + "\n")
  return report.tokenAbsent && Object.values(report.phases).every((phase) => phase.ok) ? 0 : 1
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) process.exitCode = await main()

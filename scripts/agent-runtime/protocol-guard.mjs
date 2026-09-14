// Прозрачная проверка cwd в JSONL; CLI и все его дочерние процессы уже в контейнере.
import { spawn } from "node:child_process"
import path from "node:path"
import { pathToFileURL } from "node:url"

export function validate(bytes, root, family = "codex") {
  const value = JSON.parse(bytes.toString("utf8"))
  // Config writes/import меняют будущие defaults; checker не принимает эти RPC.
  if (
    family === "codex" &&
    ["config/value/write", "config/batchWrite", "externalAgentConfig/import"].includes(value?.method)
  )
    throw new Error("preserved_model_settings_changed")
  // Исключение только для прямого params в трёх native RPC; вложенные tiers не расширяются.
  const nativeParams =
    family === "codex" &&
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    ["thread/start", "thread/resume", "turn/start"].includes(value.method) &&
    value.params !== null &&
    typeof value.params === "object" &&
    !Array.isArray(value.params)
      ? value.params
      : null
  function visit(item) {
    if (item === null || typeof item !== "object") return
    for (const [key, child] of Object.entries(item)) {
      const model = family === "codex" ? "gpt-5.6-terra" : "claude-opus-4-6"
      if (
        (key === "model" && child !== null && child !== model) ||
        (["effort", "reasoningEffort", "reasoning_effort", "model_reasoning_effort"].includes(key) &&
          child !== null &&
          child !== "medium") ||
        (key === "serviceTier" && child !== null && !(item === nativeParams && child === "default")) ||
        (["service_tier", "modelProvider", "model_provider"].includes(key) && child !== null) ||
        (key === "serviceTierForTurn" && child !== null && child !== "default")
      )
        throw new Error("preserved_model_settings_changed")
      // Thread config — произвольный TOML override; разрешены только закреплённые knobs.
      if (family === "codex" && key === "config" && child !== null) {
        if (
          typeof child !== "object" ||
          Array.isArray(child) ||
          Object.keys(child).some((name) => !["model", "model_reasoning_effort", "service_tier"].includes(name))
        )
          throw new Error("preserved_model_settings_changed")
      }
      if (
        key === "cwd" &&
        (typeof child !== "string" ||
          !path.isAbsolute(child) ||
          path.normalize(child) !== child ||
          !(child === root || child.startsWith(root + "/")))
      ) {
        throw new Error("cwd_outside_declared_source")
      }
      visit(child)
    }
  }
  visit(value)
}

function main() {
  const family = process.argv[2]
  if (!["codex", "claude"].includes(family)) throw new Error("invalid_family")
  const child = spawn(`/usr/local/bin/${family}`, process.argv.slice(3), { stdio: ["pipe", "inherit", "inherit"] })
  let pending = Buffer.alloc(0)
  let rejected = false
  function reject() {
    rejected = true
    process.stderr.write("ALTERA_RUNTIME rejected protocol cwd or framing\n")
    process.stdin.pause()
    child.kill("SIGTERM")
  }
  process.stdin.on("data", (bytes) => {
    pending = Buffer.concat([pending, bytes])
    if (pending.length > 8 * 1024 * 1024) {
      reject()
      return
    }
    let end
    while ((end = pending.indexOf(10)) !== -1) {
      const line = pending.subarray(0, end + 1)
      pending = pending.subarray(end + 1)
      try {
        validate(line, process.cwd(), family)
      } catch {
        reject()
        return
      }
      if (!child.stdin.write(line)) process.stdin.pause()
    }
  })
  child.stdin.on("drain", () => {
    if (!rejected) process.stdin.resume()
  })
  child.stdin.on("error", reject)
  process.stdin.on("end", () => {
    if (pending.length) {
      try {
        validate(pending, process.cwd(), family)
        child.stdin.write(pending)
      } catch {
        reject()
        return
      }
    }
    child.stdin.end()
  })
  for (const signal of ["SIGTERM", "SIGINT", "SIGHUP"]) process.on(signal, () => child.kill(signal))
  child.on("error", () => {
    process.exitCode = 78
    process.stdin.destroy()
  })
  child.on("exit", (code, signal) => {
    process.stdin.destroy()
    process.exitCode = rejected ? 78 : (code ?? ({ SIGTERM: 143, SIGINT: 130, SIGHUP: 129 }[signal] || 78))
  })
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main()

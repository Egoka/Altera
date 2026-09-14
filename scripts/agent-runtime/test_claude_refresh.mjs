import assert from "node:assert/strict"
import { randomBytes } from "node:crypto"
import { EventEmitter } from "node:events"
import fs from "node:fs"
import { PassThrough } from "node:stream"
import test from "node:test"

async function implementation() {
  assert.ok(fs.existsSync(new URL("./claude-refresh.mjs", import.meta.url)), "refresh wrapper missing")
  return import("./claude-refresh.mjs")
}
const secret = "SYNTHETIC_" + randomBytes(24).toString("hex")
const credential = () => ({
  claudeAiOauth: { refreshToken: secret, scopes: ["user:profile", "user:inference"], clientId: "fixture-client" },
  irrelevant: secret
})

test("exact pinned schema rejects aliases, empty scopes, normalization and bounds", async () => {
  const { parseCredential, LIMITS } = await implementation()
  const parsed = parseCredential(Buffer.from(JSON.stringify(credential())))
  assert.ok(
    parsed.refreshToken === secret &&
      parsed.scopes === "user:profile user:inference" &&
      parsed.clientId === "fixture-client"
  )
  const invalid = [
    { refreshToken: secret },
    { wrapper: credential() },
    { claudeAiOauth: { ...credential().claudeAiOauth, refreshToken: "" } }
  ]
  for (const scopes of [[], "user:profile", [""], ["user:profile user:inference"], ["scope\tbad"], [42]])
    invalid.push({ claudeAiOauth: { ...credential().claudeAiOauth, scopes } })
  for (const clientId of ["", "bad id", "bad\u0001id", "x".repeat(257), null])
    invalid.push({ claudeAiOauth: { ...credential().claudeAiOauth, clientId } })
  invalid.push({ ...credential(), extra: "x".repeat(16385) })
  let deep = credential()
  for (let n = 0; n < 17; n++) deep = { nested: deep }
  invalid.push(deep)
  let exactDepth = "leaf"
  for (let n = 0; n < 15; n++) exactDepth = { nested: exactDepth }
  assert.ok(
    parseCredential(Buffer.from(JSON.stringify({ ...credential(), extra: exactDepth }))).refreshToken === secret
  )
  assert.throws(() => parseCredential(Buffer.from('{"claudeAiOauth":{},"claudeAiOauth":{}}')), /invalid_credential/)
  for (const value of invalid) {
    assert.throws(
      () => parseCredential(Buffer.from(JSON.stringify(value))),
      (error) => error.message === "invalid_credential"
    )
  }
  assert.throws(() => parseCredential(Buffer.alloc(65537)), /invalid_credential/)
  assert.throws(() => parseCredential(Buffer.from([0xff])), /invalid_credential/)
  assert.deepEqual(LIMITS, {
    credentialBytes: 65536,
    depth: 16,
    stringBytes: 16384,
    childBytes: 8192,
    exchangeMs: 60000,
    statusMs: 30000,
    modelMs: 120000
  })
})

test("only fixed exchange child receives refresh fields, later children are clean", async () => {
  const { childEnvironment, fixedCommand } = await implementation()
  const fields = { refreshToken: secret, scopes: "user:profile", clientId: "fixture-client" }
  const env = childEnvironment("exchange", fields)
  assert.ok(env.CLAUDE_CODE_OAUTH_REFRESH_TOKEN === secret && env.CLAUDE_CODE_OAUTH_SCOPES === "user:profile")
  assert.equal(env.CLAUDE_CODE_OAUTH_CLIENT_ID, "fixture-client")
  for (const operation of ["status", "model"]) {
    const clean = childEnvironment(operation, fields)
    assert.ok(!Object.keys(clean).some((key) => /TOKEN|SCOPES|CLIENT_ID|MULTICA|API_KEY/.test(key)))
    assert.ok(!JSON.stringify(clean).includes(secret))
  }
  assert.deepEqual(fixedCommand("exchange"), ["/usr/local/bin/claude", "auth", "login"])
  assert.deepEqual(fixedCommand("status"), ["/usr/local/bin/claude", "auth", "status"])
  const model = fixedCommand("model")
  assert.equal(model[model.indexOf("--tools") + 1], "")
  assert.equal(model[model.indexOf("--model") + 1], "claude-opus-4-6")
  assert.equal(model[model.indexOf("--effort") + 1], "medium")
  assert.equal(model.at(-1), "Reply exactly ALTERA_CLAUDE_AUTH_OK")
  assert.throws(() => fixedCommand("arbitrary"))
})

test("captured output and timeout produce only fixed enums and kill the child group", async () => {
  const { runChild } = await implementation()
  for (const scenario of ["failure", "overflow", "timeout", "spawn_error"]) {
    const child = new EventEmitter()
    child.stdout = new PassThrough()
    child.stderr = new PassThrough()
    child.pid = 12345
    let timeoutCallback,
      timeoutMs,
      killed = false
    const result = await runChild(
      "exchange",
      {},
      {
        spawnProcess: () => {
          queueMicrotask(() => {
            if (scenario === "failure") {
              child.stderr.write("Login failed: " + secret)
              child.emit("close", 1, null)
            }
            if (scenario === "overflow") {
              child.stdout.write(secret.repeat(500))
              child.emit("close", null, "SIGKILL")
            }
            if (scenario === "timeout") {
              timeoutCallback()
              child.emit("close", null, "SIGKILL")
            }
            if (scenario === "spawn_error") child.emit("error", new Error(secret))
          })
          return child
        },
        killGroup: (pid) => {
          assert.equal(pid, 12345)
          killed = true
        },
        setTimer: (callback, ms) => {
          timeoutCallback = callback
          timeoutMs = ms
          return 1
        },
        clearTimer: () => {}
      }
    )
    assert.equal(timeoutMs, 60000)
    assert.ok(!JSON.stringify(result).includes(secret))
    assert.equal(
      result.status,
      { failure: "exchange_failed", overflow: "output_limit", timeout: "timeout", spawn_error: "child_failed" }[
        scenario
      ]
    )
    if (["overflow", "timeout"].includes(scenario)) assert.equal(killed, true)
    if (scenario === "failure") assert.equal(result.refreshBranchObserved, true)
  }
})

test("status and fixed model acceptance expose only safe approved metadata", async () => {
  const { classify } = await implementation()
  assert.deepEqual(
    classify("status", 0, JSON.stringify({ loggedIn: true, authMethod: "claude.ai", email: secret }), ""),
    { status: "authenticated" }
  )
  assert.equal(
    classify("status", 0, JSON.stringify({ loggedIn: true, authMethod: "api_key" }), "").status,
    "status_unaccepted"
  )
  const model = {
    type: "result",
    subtype: "success",
    is_error: false,
    result: "ALTERA_CLAUDE_AUTH_OK",
    usage: { input_tokens: 3, output_tokens: 5 },
    total_cost_usd: 0.05,
    modelUsage: {
      "claude-opus-4-6": {
        canonicalModel: "claude-opus-4-6",
        provider: "firstParty",
        costBasis: "list",
        inputTokens: 3,
        outputTokens: 5,
        costUSD: 0.05
      }
    },
    email: secret
  }
  const result = classify("model", 0, JSON.stringify(model), "")
  assert.equal(result.status, "model_accepted")
  assert.equal(result.totalCostUsd, 0.05)
  assert.equal(result.billingVerified, false)
  assert.ok(!JSON.stringify(result).includes(secret))
  assert.equal(classify("model", 0, JSON.stringify({ ...model, result: "wrong" }), "").status, "model_unaccepted")
  assert.equal(classify("model", 0, JSON.stringify({ ...model, modelUsage: {} }), "").status, "model_unaccepted")
})

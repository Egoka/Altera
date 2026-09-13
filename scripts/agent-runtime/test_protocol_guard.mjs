import assert from "node:assert/strict"
import fs from "node:fs"
import test from "node:test"

test("protocol accepts the declared cwd and refuses alternate cwd in nested RPC parameters", async () => {
  assert.ok(fs.existsSync(new URL("./protocol-guard.mjs", import.meta.url)), "cwd guard not implemented")
  const { validate } = await import("./protocol-guard.mjs")
  const source = "/source/project"
  validate(Buffer.from('{"params":{"cwd":"/source/project"}}\n'), source)
  validate(Buffer.from('{"params":{"cwd":"/source/project/tests"}}\n'), source)
  for (const cwd of ["/tmp", "/source/project/../../tmp", "/source/project-other", "relative", null]) {
    assert.throws(() => validate(Buffer.from(JSON.stringify({ params: { nested: [{ cwd }] } })), source))
  }
  assert.throws(() => validate(Buffer.from("invalid"), source))
})

test("protocol rejects changes to preserved model, reasoning and service tier", async () => {
  const { validate } = await import("./protocol-guard.mjs")
  for (const params of [
    { model: "other" },
    { effort: "low" },
    { model_reasoning_effort: "high" },
    { serviceTier: "fast" }
  ]) {
    assert.throws(() => validate(Buffer.from(JSON.stringify({ params })), "/source/project", "codex"))
  }
  validate(
    Buffer.from('{"params":{"model":"gpt-5.6-terra","effort":"medium","serviceTier":null}}'),
    "/source/project",
    "codex"
  )
})

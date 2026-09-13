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
    { reasoning_effort: "low" },
    { collaborationMode: { settings: { model: "gpt-5.6-terra", reasoning_effort: "high" } } },
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

test("pinned turn tier override permits only inherited or explicit standard speed", async () => {
  const { validate } = await import("./protocol-guard.mjs")
  const request = (params) =>
    Buffer.from(JSON.stringify({ method: "turn/start", params: { threadId: "synthetic", input: [], ...params } }))
  for (const params of [{}, { serviceTierForTurn: null }, { serviceTierForTurn: "default" }]) {
    validate(request(params), "/source/project")
  }
  for (const serviceTierForTurn of ["fast", "flex", "unknown", false, {}]) {
    assert.throws(
      () => validate(request({ serviceTierForTurn }), "/source/project"),
      /preserved_model_settings_changed/
    )
  }
})

test("thread config and provider overrides cannot replace the pinned runtime settings", async () => {
  const { validate } = await import("./protocol-guard.mjs")
  for (const method of ["thread/start", "thread/resume", "thread/fork"]) {
    const request = (params) => Buffer.from(JSON.stringify({ method, params: { threadId: "synthetic", ...params } }))
    for (const config of [null, {}, { model: "gpt-5.6-terra", model_reasoning_effort: "medium", service_tier: null }]) {
      validate(request({ config, modelProvider: null }), "/source/project")
    }
    for (const params of [
      { config: { service_tier: "fast" } },
      { config: { model_reasoning_effort: "low" } },
      { config: { "profiles.checker.service_tier": "fast" } },
      { config: { profiles: { checker: { service_tier: "fast" } } } },
      { config: { profile: "checker" } },
      { config: { model_provider: "other" } },
      { modelProvider: "other" }
    ]) {
      assert.throws(() => validate(request(params), "/source/project"), /preserved_model_settings_changed/)
    }
  }
})

test("config mutation RPCs cannot hide overrides in keyPath values or imported files", async () => {
  const { validate } = await import("./protocol-guard.mjs")
  for (const request of [
    { method: "config/value/write", params: { keyPath: "service_tier", value: "fast", mergeStrategy: "replace" } },
    {
      method: "config/batchWrite",
      params: { edits: [{ keyPath: "model_reasoning_effort", value: "low", mergeStrategy: "replace" }] }
    },
    { method: "externalAgentConfig/import", params: { items: [] } }
  ]) {
    assert.throws(
      () => validate(Buffer.from(JSON.stringify(request)), "/source/project"),
      /preserved_model_settings_changed/
    )
  }
  validate(Buffer.from('{"method":"config/read","params":{}}'), "/source/project")
})

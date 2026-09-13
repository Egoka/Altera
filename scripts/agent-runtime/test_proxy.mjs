import assert from "node:assert/strict"
import fs from "node:fs"
import test from "node:test"

test("proxy refuses host endpoints, ambiguous authorities and non-public DNS answers", async () => {
  assert.ok(fs.existsSync(new URL("./provider-proxy.mjs", import.meta.url)), "provider proxy not implemented")
  const { authority, publicAddress } = await import("./provider-proxy.mjs")
  for (const value of [
    "localhost:443",
    "host.docker.internal:443",
    "127.0.0.1:443",
    "api.openai.com:80",
    "api.openai.com.:443",
    "api.openai.com@evil:443",
    "evil.invalid:443"
  ]) {
    assert.throws(() => authority(value))
  }
  assert.equal(authority("api.openai.com:443"), "api.openai.com")
  for (const value of [
    "127.0.0.1",
    "10.0.0.1",
    "172.16.0.1",
    "192.168.1.1",
    "169.254.169.254",
    "100.64.0.1",
    "0.0.0.0",
    "224.0.0.1",
    "::1",
    "::ffff:127.0.0.1"
  ]) {
    assert.equal(publicAddress(value), false, value)
  }
  assert.equal(publicAddress("1.1.1.1"), true)
})

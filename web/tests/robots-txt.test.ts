import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { describe, expect, it } from "vitest"

const robotsPath = resolve(__dirname, "../public/robots.txt")
const robotsContent = readFileSync(robotsPath, "utf8")

describe("robots.txt", () => {
  it("disallows cabinet path /me", () => {
    expect(robotsContent).toContain("Disallow: /me")
  })

  it("disallows admin path /admin", () => {
    expect(robotsContent).toContain("Disallow: /admin")
  })

  it("disallows preview path /preview", () => {
    expect(robotsContent).toContain("Disallow: /preview")
  })

  it("disallows nuxt service path /_nuxt/", () => {
    expect(robotsContent).toContain("Disallow: /_nuxt/")
  })

  it("disallows api path /api/", () => {
    expect(robotsContent).toContain("Disallow: /api/")
  })

  it("blocks GPTBot AI training bot", () => {
    expect(robotsContent).toContain("User-agent: GPTBot")
  })

  it("blocks CCBot AI training bot", () => {
    expect(robotsContent).toContain("User-agent: CCBot")
  })

  it("blocks anthropic-ai bot", () => {
    expect(robotsContent).toContain("User-agent: anthropic-ai")
  })

  it("blocks Claude-Web bot", () => {
    expect(robotsContent).toContain("User-agent: Claude-Web")
  })

  it("blocks Omgilibot AI training bot", () => {
    expect(robotsContent).toContain("User-agent: Omgilibot")
  })

  it("blocks FacebookBot AI training bot", () => {
    expect(robotsContent).toContain("User-agent: FacebookBot")
  })

  it("blocks Applebot-Extended AI training bot", () => {
    expect(robotsContent).toContain("User-agent: Applebot-Extended")
  })

  it("blocks DataForSeoBot AI training bot", () => {
    expect(robotsContent).toContain("User-agent: DataForSeoBot")
  })

  it("AI bot sections have Disallow: /", () => {
    // Count occurrences of "Disallow: /" to verify AI bots are fully blocked
    const matches = robotsContent.match(/^Disallow: \/$/gm)
    expect(matches).not.toBeNull()
    expect(matches!.length).toBeGreaterThanOrEqual(8)
  })
})

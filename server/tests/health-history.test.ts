import { describe, expect, it, vi } from "vitest"
import { createHealthAlerts, type Health } from "../src/health"

const healthy: Health = {
  status: "ok",
  revision: null,
  checkedAt: "2026-09-28T10:00:00.000Z",
  checks: { postgres: true, migrations: true, redis: "disabled" },
  components: {
    db: { status: "up", adapter: "postgres", latencyMs: 4 },
    redis: { status: "disabled", adapter: "disabled", latencyMs: null },
    psp: { status: "disabled", adapter: "disabled", latencyMs: null },
    ai: { status: "disabled", adapter: "disabled", latencyMs: null },
    mail: { status: "up", adapter: "console", latencyMs: 0 },
    storage: { status: "up", adapter: "local", latencyMs: 2 }
  },
  backups: {
    database: { status: "disabled", lastSucceededAt: null, ageSeconds: null, maxAgeSeconds: 86400 },
    media: { status: "disabled", lastSucceededAt: null, ageSeconds: null, maxAgeSeconds: 604800 }
  }
}

describe("T-081 health history", () => {
  it("records the first snapshot and each state change without duplicating an unchanged state", async () => {
    const history = vi.fn(async () => undefined)
    const alerts = createHealthAlerts({
      recipients: async () => [],
      logger: { log: vi.fn() },
      history
    })

    await alerts(healthy)
    await alerts({ ...healthy, checkedAt: "2026-09-28T10:01:00.000Z" })
    const degraded: Health = {
      ...healthy,
      status: "degraded",
      checkedAt: "2026-09-28T10:02:00.000Z",
      components: { ...healthy.components, storage: { status: "down", adapter: "local", latencyMs: null } }
    }
    await alerts(degraded)

    expect(history).toHaveBeenCalledTimes(2)
    expect(history).toHaveBeenNthCalledWith(1, healthy)
    expect(history).toHaveBeenNthCalledWith(2, degraded)
  })

  it("records provider and backup-age changes even when alert reasons stay unchanged", async () => {
    const history = vi.fn(async () => undefined)
    const alerts = createHealthAlerts({ recipients: async () => [], logger: { log: vi.fn() }, history })

    await alerts(healthy)
    await alerts({
      ...healthy,
      checkedAt: "2026-09-28T11:00:00.000Z",
      components: { ...healthy.components, mail: { status: "disabled", adapter: "disabled", latencyMs: null } }
    })
    await alerts({
      ...healthy,
      checkedAt: "2026-09-28T12:00:00.000Z",
      backups: {
        ...healthy.backups,
        database: { ...healthy.backups.database, status: "ok", ageSeconds: 7_200 }
      }
    })

    expect(history).toHaveBeenCalledTimes(3)
  })
})

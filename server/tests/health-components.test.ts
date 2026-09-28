import { describe, expect, it, vi } from "vitest"
import { createHealthCheck, createMailProbe, createProviderProbes, createStorageProbe } from "../src/health"
import { StorageUnavailableError } from "../src/storage/types"

// T-088: состояние зависимостей в `/health` (§29.3, `80-observability/health-and-alerts.md` п. 1–2, 7):
// хранилище и почта проверяются лёгкими вызовами не чаще раза в минуту, AI и провайдер платежей
// пока не подключены, а недоступный провайдер даёт деградацию без 503.

const ready = { postgres: async () => [{ ok: 1 }], migrations: async () => true, redis: async () => true }

const mailHistory = (status: string | null) => ({
  mailMessage: { findFirst: vi.fn(async () => (status === null ? null : { status })) }
})

describe("проверка хранилища медиа", () => {
  it("спрашивает провайдера одним лёгким вызовом и не пишет в хранилище", async () => {
    const exists = vi.fn(async () => false)
    const probe = createStorageProbe({ name: "s3", exists })
    expect(await probe()).toEqual({ status: "up", adapter: "s3", latencyMs: expect.any(Number) })
    expect(exists).toHaveBeenCalledTimes(1)
    expect(exists).toHaveBeenCalledWith("quarantine/00000000-0000-0000-0000-000000000000.upload")
  })

  it("недоступный провайдер — down с именем адаптера и без подробностей отказа", async () => {
    const probe = createStorageProbe({
      name: "s3",
      exists: async () => {
        throw new StorageUnavailableError("https://s3.private.example/bucket?X-Amz-Credential=secret")
      }
    })
    const state = await probe()
    expect(state.status).toBe("down")
    expect(state.adapter).toBe("s3")
    expect(JSON.stringify(state)).not.toContain("secret")
  })

  it("незаданный драйвер в production — down без имени адаптера", async () => {
    const probe = createStorageProbe({ name: "unconfigured", exists: async () => true })
    expect(await probe()).toEqual({ status: "down", adapter: null, latencyMs: null })
  })
})

describe("проверка почты по последним отправкам", () => {
  it("последняя завершённая отправка отказала — down", async () => {
    const client = mailHistory("failed")
    const probe = createMailProbe({ transport: { name: "smtp" }, client })
    expect(await probe()).toEqual({ status: "down", adapter: "smtp", latencyMs: expect.any(Number) })
    expect(client.mailMessage.findFirst).toHaveBeenCalledWith({
      where: { status: { in: ["sent", "failed"] } },
      orderBy: { updatedAt: "desc" },
      select: { status: true }
    })
  })

  it("успешная отправка или их отсутствие — up", async () => {
    expect((await createMailProbe({ transport: { name: "smtp" }, client: mailHistory("sent") })())?.status).toBe("up")
    expect((await createMailProbe({ transport: { name: "console" }, client: mailHistory(null) })())?.status).toBe("up")
  })

  it("транспорт не настроен в production — down", async () => {
    const probe = createMailProbe({ transport: { name: "unconfigured" }, client: mailHistory("sent") })
    expect(await probe()).toEqual({ status: "down", adapter: null, latencyMs: null })
  })
})

describe("минутный интервал проверок провайдеров", () => {
  it("повторяет лёгкий вызов не чаще раза в минуту", async () => {
    vi.useFakeTimers()
    try {
      const exists = vi.fn(async () => false)
      const probes = createProviderProbes({
        storage: { name: "local", exists },
        mail: { name: "console" },
        mailHistory: mailHistory("sent")
      })
      await Promise.all([probes.storage(), probes.storage(), probes.storage()])
      expect(exists).toHaveBeenCalledTimes(1)
      await vi.advanceTimersByTimeAsync(59_999)
      await probes.storage()
      expect(exists).toHaveBeenCalledTimes(1)
      await vi.advanceTimersByTimeAsync(2)
      await probes.storage()
      expect(exists).toHaveBeenCalledTimes(2)
    } finally {
      vi.useRealTimers()
    }
  })

  it("AI и провайдер платежей не подключены — disabled, а не деградация", async () => {
    const probes = createProviderProbes({
      storage: { name: "local", exists: async () => false },
      mail: { name: "console" },
      mailHistory: mailHistory("sent")
    })
    expect(await probes.ai()).toEqual({ status: "disabled", adapter: null, latencyMs: null })
    expect(await probes.psp()).toEqual({ status: "disabled", adapter: null, latencyMs: null })
  })
})

describe("состояние зависимостей в ответе", () => {
  it("недоступное хранилище даёт degraded без 503", async () => {
    const check = createHealthCheck({
      ...ready,
      providers: {
        storage: createStorageProbe({
          name: "s3",
          exists: async () => {
            throw new StorageUnavailableError("provider is down")
          }
        })
      }
    })
    const health = await check()
    expect(health.status).toBe("degraded")
    expect(health.components.storage.status).toBe("down")
    expect(health.components.db.status).toBe("up")
  })

  it("исправные провайдеры оставляют ok, а падение проверки не роняет ответ", async () => {
    const check = createHealthCheck({
      ...ready,
      providers: {
        storage: async () => ({ status: "up", adapter: "local", latencyMs: 1 }),
        mail: async () => {
          throw new Error("probe bug")
        }
      }
    })
    const health = await check()
    expect(health.components.storage).toEqual({ status: "up", adapter: "local", latencyMs: 1 })
    expect(health.components.mail).toEqual({ status: "down", adapter: null, latencyMs: null })
    expect(health.status).toBe("degraded")
  })

  it("зависший вызов провайдера укладывается в общий предел четырёх секунд", async () => {
    vi.useFakeTimers()
    try {
      const check = createHealthCheck({
        ...ready,
        providers: { storage: () => new Promise(() => {}) }
      })
      const pending = check()
      await vi.advanceTimersByTimeAsync(4000)
      const health = await pending
      expect(health.status).toBe("degraded")
      expect(health.components.storage).toEqual({ status: "down", adapter: null, latencyMs: null })
    } finally {
      vi.useRealTimers()
    }
  })
})

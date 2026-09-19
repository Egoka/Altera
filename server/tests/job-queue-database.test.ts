import { execFileSync, spawnSync } from "node:child_process"
import { randomUUID } from "node:crypto"
import { readdirSync } from "node:fs"
import path from "node:path"
import { PrismaClient } from "../src/generated/prisma"
import { describe, expect, it, vi } from "vitest"
import { cancelJob, retryJob } from "../src/jobs/job-actions"
import { createJobWorker } from "../src/jobs/job-worker"
import { createPrismaJobStore } from "../src/jobs/prisma-job-store"
import type { AppLogger } from "../src/observability/logger"

const testDatabaseUrl = process.env.T047_TEST_DATABASE_URL
const serverRoot = path.resolve(__dirname, "..")
const migrationsRoot = path.join(serverRoot, "prisma/migrations")
const targetMigration = "20260918120000_job_queue_runner"

const databaseUrl = (name: string): string => {
  const url = new URL(testDatabaseUrl!)
  url.pathname = `/${name}`
  return url.toString()
}

const prismaFor = (url: string): PrismaClient => new PrismaClient({ datasources: { db: { url } } })

const runPrisma = (args: string[], url: string): void => {
  execFileSync("pnpm", ["exec", "prisma", ...args, "--schema", path.join(serverRoot, "prisma/schema.prisma")], {
    cwd: serverRoot,
    env: { ...process.env, DATABASE_URL: url, DATABASE_URL_UNPOOLED: url },
    stdio: "pipe"
  })
}

const applyMigrations = (url: string) => {
  const migrations = readdirSync(migrationsRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name < targetMigration)
    .map((entry) => entry.name)
    .sort()
  for (const migration of migrations) {
    runPrisma(["db", "execute", "--file", path.join(migrationsRoot, migration, "migration.sql")], url)
  }
  return spawnSync(
    "pnpm",
    [
      "exec",
      "prisma",
      "db",
      "execute",
      "--file",
      path.join(migrationsRoot, targetMigration, "migration.sql"),
      "--schema",
      path.join(serverRoot, "prisma/schema.prisma")
    ],
    {
      cwd: serverRoot,
      env: { ...process.env, DATABASE_URL: url, DATABASE_URL_UNPOOLED: url },
      encoding: "utf8"
    }
  )
}

const withDatabase = async (run: (database: PrismaClient) => Promise<void>): Promise<void> => {
  const name = `t047_${randomUUID().replaceAll("-", "")}`
  const admin = prismaFor(databaseUrl("postgres"))
  const url = databaseUrl(name)
  try {
    await admin.$executeRawUnsafe(`CREATE DATABASE "${name}"`)
    const migration = applyMigrations(url)
    expect(migration.status, `${migration.stdout}\n${migration.stderr}`).toBe(0)
    const database = prismaFor(url)
    try {
      await run(database)
    } finally {
      await database.$disconnect()
    }
  } finally {
    await admin.$executeRawUnsafe(
      `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '${name}' AND pid <> pg_backend_pid()`
    )
    await admin.$executeRawUnsafe(`DROP DATABASE IF EXISTS "${name}"`)
    await admin.$disconnect()
  }
}

describe.skipIf(!testDatabaseUrl)("T-047 database job queue", () => {
  it("persists retries, terminal failure and timeout-based stuck state", async () => {
    await withDatabase(async (database) => {
      const store = createPrismaJobStore(database)
      const log = vi.fn<AppLogger["log"]>()
      let now = new Date("2026-09-18T08:00:00.000Z")
      const failedJob = await store.enqueue({
        kind: "test.fail",
        originRequestId: "request-1",
        parameters: { objectId: "article-1" },
        maxAttempts: 2,
        availableAt: now
      })
      const worker = createJobWorker({
        store,
        logger: { log },
        handlers: new Map([["test.fail", async () => Promise.reject(new TypeError("provider failed"))]]),
        now: () => now,
        retryDelayMs: 0
      })

      await worker.processNext()
      await worker.processNext()

      await expect(database.job.findUniqueOrThrow({ where: { id: failedJob.id } })).resolves.toMatchObject({
        status: "failed",
        attemptCount: 2,
        originRequestId: "request-1"
      })
      await expect(database.jobAttempt.count({ where: { jobId: failedJob.id, status: "failed" } })).resolves.toBe(2)
      expect(log).toHaveBeenCalledWith(expect.objectContaining({ event: "job.failed", jobId: failedJob.id }))

      const stuckJob = await store.enqueue({ kind: "test.stuck", availableAt: now })
      await database.job.update({
        where: { id: stuckJob.id },
        data: { status: "running", startedAt: now, attemptCount: 1 }
      })
      await database.jobAttempt.create({
        data: { jobId: stuckJob.id, number: 1, status: "running", startedAt: now }
      })
      now = new Date(now.getTime() + 60 * 60 * 1_000 + 1)

      await worker.markStuckJobs()

      await expect(database.job.findUniqueOrThrow({ where: { id: stuckJob.id } })).resolves.toMatchObject({
        status: "stuck"
      })
      expect(log).toHaveBeenCalledWith(expect.objectContaining({ event: "job.stuck", jobId: stuckJob.id }))

      const owner = {
        id: "owner-1",
        role: "owner" as const,
        archivedAt: null,
        planTier: "free" as const,
        planUntil: null
      }
      await retryJob({ store, currentUser: owner, jobId: failedJob.id, requestId: "request-2", now })
      await cancelJob({
        store,
        currentUser: owner,
        jobId: failedJob.id,
        requestId: "request-3",
        reason: "duplicate delivery",
        now
      })

      await expect(
        database.auditLog.findMany({ where: { entityId: failedJob.id }, orderBy: { createdAt: "asc" } })
      ).resolves.toEqual([
        expect.objectContaining({ action: "job.retry", actorId: "owner-1", requestId: "request-2" }),
        expect.objectContaining({ action: "job.cancel", actorId: "owner-1", requestId: "request-3" })
      ])

      const rankingJob = await store.enqueue({ kind: "ranking.recompute", availableAt: now })
      await database.job.update({ where: { id: rankingJob.id }, data: { status: "failed" } })
      await expect(
        retryJob({ store, currentUser: owner, jobId: rankingJob.id, requestId: "request-4", now })
      ).rejects.toMatchObject({ extensions: { code: "CONFLICT" } })
    })
  }, 30_000)

  it("rejects a non-positive attempt limit at the database boundary", async () => {
    await withDatabase(async (database) => {
      await expect(
        database.$executeRawUnsafe(`
          INSERT INTO "jobs" ("id", "kind", "maxAttempts", "updatedAt")
          VALUES ('invalid-job', 'test.invalid', 0, NOW())
        `)
      ).rejects.toMatchObject({ meta: { code: "23514" } })
    })
  }, 30_000)
})

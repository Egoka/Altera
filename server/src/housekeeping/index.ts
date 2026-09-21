import type { PrismaClient } from "../generated/prisma"
import { registerJobHandler } from "../jobs/job-handlers"
import type { PrismaJobStore } from "../jobs/prisma-job-store"
import { HOUSEKEEPING_JOB_KIND, runHousekeeping } from "./housekeeping"
import type { HousekeepingQueue } from "./scheduler"

export { HOUSEKEEPING_JOB_KIND, runHousekeeping, type HousekeepingClient } from "./housekeeping"
export { enqueueHousekeeping, startHousekeepingSchedule, type HousekeepingQueue } from "./scheduler"
export { RETENTION_POLICY } from "./retention-policy"

export function registerHousekeepingJob(client: PrismaClient): void {
  registerJobHandler(HOUSEKEEPING_JOB_KIND, async () => {
    await runHousekeeping(client, new Date())
  })
}

export function createHousekeepingQueue(client: PrismaClient, store: PrismaJobStore): HousekeepingQueue {
  return {
    async hasPending(kind) {
      return (await client.job.count({ where: { kind, status: { in: ["queued", "running"] } } })) > 0
    },
    enqueue: (input) => store.enqueue(input)
  }
}

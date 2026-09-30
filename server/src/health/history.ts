import type { Prisma } from "../generated/prisma"
import type { Health } from "./readiness"
import { healthAlertReasons } from "./alerts"

export interface HealthHistoryClient {
  systemHealthSnapshot: {
    create(args: {
      data: {
        status: string
        signature: string
        components: Prisma.InputJsonValue
        backups: Prisma.InputJsonValue
        checkedAt: Date
      }
    }): Promise<unknown>
  }
}

export const createPrismaHealthHistory =
  (client: HealthHistoryClient) =>
  async (health: Health): Promise<void> => {
    await client.systemHealthSnapshot.create({
      data: {
        status: health.status,
        signature: healthAlertReasons(health).join(" "),
        components: health.components as unknown as Prisma.InputJsonValue,
        backups: health.backups as unknown as Prisma.InputJsonValue,
        checkedAt: new Date(health.checkedAt)
      }
    })
  }

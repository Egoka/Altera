import { randomUUID } from "node:crypto"
import type { AppLogger } from "../observability/logger"
import { expirePermissionExceptions, type PermissionExceptionClient } from "./service"

const EXPIRY_INTERVAL_MS = 60_000

export function startPermissionExceptionExpiry(
  client: PermissionExceptionClient,
  logger: AppLogger,
  intervalMs = EXPIRY_INTERVAL_MS
): NodeJS.Timeout {
  const run = async () => {
    const requestId = `permission-expiry:${randomUUID()}`
    try {
      await expirePermissionExceptions(client, { now: new Date(), requestId })
    } catch (error) {
      logger.log({
        level: "error",
        event: "error.unhandled",
        requestId,
        message: "Permission exception expiry failed",
        error
      })
    }
  }
  void run()
  const timer = setInterval(() => void run(), intervalMs)
  timer.unref()
  return timer
}

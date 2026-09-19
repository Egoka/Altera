import type { JobHandler } from "./job-worker"

const registeredJobHandlers = new Map<string, JobHandler>()
export const jobHandlers: ReadonlyMap<string, JobHandler> = registeredJobHandlers

export function registerJobHandler(kind: string, handler: JobHandler): void {
  if (registeredJobHandlers.has(kind)) throw new Error(`Job handler already registered: ${kind}`)
  registeredJobHandlers.set(kind, handler)
}

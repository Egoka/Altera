import type { ClaimedJob, JobHandler } from "../jobs/job-worker"
import { registerJobHandler } from "../jobs/job-handlers"
import { ACCOUNT_EXPORT_JOB_KIND } from "./types"
import type { AccountExportService } from "./service"

function exportIdFrom(job: ClaimedJob): string {
  if (
    typeof job.parameters !== "object" ||
    job.parameters === null ||
    !("exportId" in job.parameters) ||
    typeof job.parameters.exportId !== "string"
  ) {
    throw new Error("Account export job parameters are invalid")
  }
  return job.parameters.exportId
}

export function createAccountExportJobHandler(service: Pick<AccountExportService, "build">): JobHandler {
  return async (job) => service.build(exportIdFrom(job))
}

export function registerAccountExportJob(service: AccountExportService): void {
  registerJobHandler(ACCOUNT_EXPORT_JOB_KIND, createAccountExportJobHandler(service))
}

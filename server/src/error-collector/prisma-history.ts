import type { ErrorGroup, ErrorHistory, ErrorOccurrence, ErrorStream } from "./types"

interface ErrorEventRow {
  signature: string
  stream: ErrorStream
  service: string
  code: string
  route: string | null
  _count: { _all: number }
  _min: { occurredAt: Date | null }
  _max: { occurredAt: Date | null }
}

/** Узкий срез Prisma-клиента: история только добавляется и группируется, `update` ей не нужен. */
export interface ErrorHistoryClient {
  $transaction<T>(run: (client: ErrorHistoryTransactionClient) => Promise<T>): Promise<T>
  backendErrorEvent: {
    create(args: { data: ErrorOccurrence }): Promise<unknown>
    groupBy(args: {
      by: ["signature", "stream", "service", "code", "route"]
      where: { occurredAt: { gte: Date; lt: Date }; stream?: ErrorStream }
      _count: { _all: true }
      _min: { occurredAt: true }
      _max: { occurredAt: true }
    }): Promise<ErrorEventRow[]>
  }
}

interface ErrorHistoryTransactionClient {
  backendErrorEvent: {
    create(args: { data: ErrorOccurrence }): Promise<unknown>
  }
  backendError: {
    findUnique(args: {
      where: { signature: string }
      select: { id: true; workStatus: true }
    }): Promise<{ id: string; workStatus: "new_record" | "in_progress" | "resolved" } | null>
    create(args: { data: Record<string, unknown> }): Promise<unknown>
    update(args: { where: { id: string }; data: Record<string, unknown> }): Promise<unknown>
  }
}

async function appendOccurrence(client: ErrorHistoryTransactionClient, occurrence: ErrorOccurrence): Promise<void> {
  await client.backendErrorEvent.create({ data: occurrence })
  // Клиентские ошибки остаются отдельным неизменяемым потоком без рабочих статусов (§2 п. 1).
  if (occurrence.stream === "page") return

  const current = await client.backendError.findUnique({
    where: { signature: occurrence.signature },
    select: { id: true, workStatus: true }
  })
  const latest = {
    service: occurrence.service,
    code: occurrence.code,
    errorClass: occurrence.errorType,
    sanitizedMessage: occurrence.message ?? occurrence.code,
    route: occurrence.route,
    requestId: occurrence.requestId,
    sanitizedStack: occurrence.stack,
    jobId: occurrence.jobId,
    lastSeenAt: occurrence.occurredAt
  }

  if (!current) {
    await client.backendError.create({
      data: {
        signature: occurrence.signature,
        ...latest,
        firstSeenAt: occurrence.occurredAt,
        occurrenceCount: 1
      }
    })
    return
  }

  await client.backendError.update({
    where: { id: current.id },
    data: {
      ...latest,
      occurrenceCount: { increment: 1 },
      ...(current.workStatus === "resolved"
        ? { workStatus: "new_record", assignedActorId: null, assignedActorRole: null }
        : {})
    }
  })
}

export function createPrismaErrorHistory(client: ErrorHistoryClient): ErrorHistory {
  return {
    async append(occurrence) {
      await client.$transaction((transaction) => appendOccurrence(transaction, occurrence))
    },

    async listGroups(filter) {
      const rows = await client.backendErrorEvent.groupBy({
        by: ["signature", "stream", "service", "code", "route"],
        where: {
          occurredAt: { gte: filter.since, lt: filter.until },
          ...(filter.stream ? { stream: filter.stream } : {})
        },
        _count: { _all: true },
        _min: { occurredAt: true },
        _max: { occurredAt: true }
      })

      return rows
        .map(
          (row): ErrorGroup => ({
            signature: row.signature,
            stream: row.stream,
            service: row.service,
            code: row.code,
            route: row.route,
            occurrences: row._count._all,
            firstSeenAt: row._min.occurredAt ?? filter.since,
            lastSeenAt: row._max.occurredAt ?? filter.since
          })
        )
        .sort((left, right) => right.lastSeenAt.getTime() - left.lastSeenAt.getTime())
    }
  }
}

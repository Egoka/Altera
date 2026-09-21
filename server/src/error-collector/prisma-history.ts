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

export function createPrismaErrorHistory(client: ErrorHistoryClient): ErrorHistory {
  return {
    async append(occurrence) {
      await client.backendErrorEvent.create({ data: occurrence })
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

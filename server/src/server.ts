import "dotenv/config"
import { createServer } from "node:http"
import { createYoga } from "graphql-yoga"
import { useCSRFPrevention } from "@graphql-yoga/plugin-csrf-prevention"
import { blockFieldSuggestionsPlugin } from "@escape.tech/graphql-armor-block-field-suggestions"
import { schema } from "./graphql/schema"
import { createContext, GraphQLContext, prisma } from "./prisma"
import {
  checkMigrations,
  createBackupMonitorFromEnv,
  createHealthAlerts,
  createHealthCheck,
  createProviderProbes,
  createStaffRecipients,
  redisReadiness,
  withHealth,
  type BackupRunsClient,
  type MailHistoryClient,
  type StaffRecipientsClient
} from "./health"
import { createCache } from "./cache"
import { createErrorMasker } from "./errors/graphql-error"
import {
  createErrorCollector,
  createErrorCollectorAdapterFromEnv,
  createPrismaErrorHistory,
  type ErrorHistoryClient
} from "./error-collector"
import { createMailConfigFromEnv } from "./mail/config"
import { createMailService } from "./mail/service"
import {
  createMediaPurgeDeps,
  createMediaPurgeQueue,
  createMediaService,
  isMediaPurgeEnabled,
  isMediaUploadEnabled,
  registerMediaPurgeJob,
  startMediaPurgeSchedule
} from "./media"
import { createPrismaPublicAccessResolver, type MediaUsageClient } from "./storage/access"
import { createStorageConfigFromEnv } from "./storage/config"
import { withMedia } from "./storage/gateway"
import { createAppLogger } from "./observability/logger"
import { createPiiHasher } from "./observability/privacy"
import { createRequestTracingPlugin, getRequestId } from "./observability/request-tracing"
import { jobHandlers } from "./jobs/job-handlers"
import { createJobWorker } from "./jobs/job-worker"
import { createPrismaJobStore } from "./jobs/prisma-job-store"
import { createHousekeepingQueue, registerHousekeepingJob, startHousekeepingSchedule } from "./housekeeping"
import { createAiCheckAdapterFromEnv, registerAiCheckJob } from "./ai"
import { createAiAltAdapterFromEnv, createPrismaAiAltQueue, registerAiAltJob } from "./ai/alt"
import { startPermissionExceptionExpiry } from "./permission-exceptions/scheduler"
import type { PermissionExceptionClient } from "./permission-exceptions/service"
import {
  createRateLimiter,
  createRateLimitPlugin,
  createRateLimitStore,
  startRateLimitCounterPrune,
  type RateLimitDatabaseClient
} from "./rate-limits"
import { createAccountExportService, createPrismaAccountExportStore, registerAccountExportJob } from "./account-export"

const PORT = process.env.PORT || 4000
const cache = createCache({ redisUrl: process.env.REDIS_URL })
const logger = createAppLogger({ service: "api", environment: process.env.NODE_ENV ?? "development" })
const piiHasher = createPiiHasher(process.env.LOG_HASH_SECRET)
const forwardedRequestSecret = process.env.REQUEST_ID_FORWARD_SECRET
if (!forwardedRequestSecret) throw new Error("REQUEST_ID_FORWARD_SECRET must be defined")
const mailConfig = createMailConfigFromEnv(process.env)
const mail = createMailService({ store: prisma, transport: mailConfig.transport, logger, from: mailConfig.from })
const storageConfig = createStorageConfigFromEnv(process.env)
// История `backend.error` своя, внешний сборщик — через адаптер; до выбора поставщика — `noop` (Q-01).
const errorCollector = createErrorCollector({
  history: createPrismaErrorHistory(prisma as unknown as ErrorHistoryClient),
  adapter: createErrorCollectorAdapterFromEnv(process.env),
  logger
})
const maskError = createErrorMasker({ logger, requestIdFactory: getRequestId, collector: errorCollector })
// Счётчики лимитов: Redis при заданном `REDIS_URL`, иначе таблица (`rate-limits.md` §2 п. 13).
const rateLimitClient = prisma as unknown as RateLimitDatabaseClient
const rateLimiter = createRateLimiter({
  store: createRateLimitStore({
    redisUrl: process.env.REDIS_URL,
    client: rateLimitClient,
    warn: (message) => logger.log({ level: "warn", event: "backend.error", requestId: getRequestId(), message })
  }),
  logger,
  piiHasher
})

const jobStore = createPrismaJobStore(prisma)
const accountExports = createAccountExportService({
  store: createPrismaAccountExportStore(prisma),
  storage: storageConfig.storage
})
// Очередь AI-описания: конвейеру нужна только постановка задания, поэтому идентификаторы задания
// и AI-процесса остаются внутри модуля AI (`upload-pipeline.md` п. 6а).
const aiAltQueue = createPrismaAiAltQueue(prisma, logger)
// Конвейер загрузки: сервис в контексте API и обработчик задания `media.process` в этом же
// процессе (`upload-pipeline.md` п. 5). Загрузка закрыта до утверждения порогов (журнал §33 п. 3).
const media = createMediaService({
  client: prisma,
  jobStore,
  storage: storageConfig.storage,
  mediaBaseUrl: storageConfig.mediaBaseUrl,
  uploadEnabled: isMediaUploadEnabled(process.env),
  // Описание `alt` создаётся один раз после обработки файла (журнал §29.11, §29.13).
  altQueue: { enqueue: async (input) => void (await aiAltQueue.enqueue(input)) }
})

const yoga = createYoga<GraphQLContext>({
  schema,
  context: (initialContext) =>
    createContext(initialContext, cache, logger, piiHasher, mail, media, rateLimiter, errorCollector, accountExports),
  logging: false,
  maskedErrors: { isDev: false, maskError },
  cors: {
    origin: process.env.FRONTEND_URL,
    credentials: true,
    methods: ["POST"]
  },
  graphqlEndpoint: "/",
  plugins: [
    createRequestTracingPlugin({ logger, forwardedRequestSecret }),
    useCSRFPrevention(),
    createRateLimitPlugin(),
    process.env.NODE_ENV === "production" && blockFieldSuggestionsPlugin()
  ].filter(Boolean)
})

// Состояние зависимостей и возраст копий (`health-and-alerts.md` п. 1): проверки провайдеров
// кешируются минуту, оповещение о деградации формируется получателям — активным `owner` и `admin`
// (журнал §40 п. 2); канал доставки отложен (§40 п. 1).
const healthAlerts = createHealthAlerts({
  recipients: createStaffRecipients(prisma as unknown as StaffRecipientsClient),
  logger
})
const health = createHealthCheck(
  {
    postgres: () => prisma.$queryRaw`SELECT 1 AS ok`,
    migrations: () =>
      checkMigrations(
        () => prisma.$queryRaw`SELECT migration_name, finished_at, rolled_back_at FROM "_prisma_migrations"`
      ),
    redis: redisReadiness(cache),
    providers: createProviderProbes({
      storage: storageConfig.storage,
      mail: mailConfig.transport,
      mailHistory: prisma as unknown as MailHistoryClient
    }),
    backups: createBackupMonitorFromEnv(process.env, prisma as unknown as BackupRunsClient)
  },
  process.env.RENDER_GIT_COMMIT,
  {
    onCheck: (snapshot) =>
      void healthAlerts(snapshot).catch((error: unknown) =>
        logger.log({
          level: "error",
          event: "backend.error",
          requestId: getRequestId(),
          message: "Health alert failed",
          error
        })
      )
  }
)
// Локальная реализация раздаёт `/media/*` сама; у S3 публичные файлы идут через CDN провайдера.
const mediaGateway = storageConfig.local
  ? withMedia(yoga, {
      storage: storageConfig.local,
      resolvePublicAccess: createPrismaPublicAccessResolver(prisma as unknown as MediaUsageClient)
    })
  : yoga
const server = createServer(withHealth(mediaGateway, health))
registerHousekeepingJob(prisma)
registerAccountExportJob(accountExports)
// Чистка медиа-сирот (`retention-and-orphans.md` §2 п. 5–6): обработчик задания есть всегда, а
// расписание включается признаком — окно и интервал ещё не утверждены владельцем (журнал §33 п. 3).
registerMediaPurgeJob(createMediaPurgeDeps(prisma, storageConfig.storage))
// AI-проверка допустимости: `real` ждёт утверждения владельцем (журнал §32 п. 2), поэтому вне
// разработки адаптер отвечает недоступностью провайдера, а не выносит вердикт.
registerAiCheckJob({ client: prisma, adapter: createAiCheckAdapterFromEnv(process.env), logger, cache, mail })
// AI-описание изображений: выбор модели — отдельный проход (`upload-pipeline.md` п. 6а), поэтому
// вне разработки адаптер отвечает недоступностью провайдера, а не выдумывает описание.
registerAiAltJob({
  client: prisma,
  storage: storageConfig.storage,
  adapter: createAiAltAdapterFromEnv(process.env),
  logger
})
const jobWorker = createJobWorker({ store: jobStore, handlers: jobHandlers, logger, errorCollector })
jobWorker.start()
server.on("close", () => jobWorker.stop())
startPermissionExceptionExpiry(prisma as unknown as PermissionExceptionClient, logger)
startRateLimitCounterPrune(rateLimitClient, logger)
startHousekeepingSchedule(createHousekeepingQueue(prisma, jobStore), logger)
if (isMediaPurgeEnabled(process.env)) startMediaPurgeSchedule(createMediaPurgeQueue(prisma, jobStore), logger)
server.listen(PORT)

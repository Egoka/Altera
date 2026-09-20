import "dotenv/config"
import { createServer } from "node:http"
import { createYoga } from "graphql-yoga"
import { useCSRFPrevention } from "@graphql-yoga/plugin-csrf-prevention"
import { blockFieldSuggestionsPlugin } from "@escape.tech/graphql-armor-block-field-suggestions"
import { schema } from "./graphql/schema"
import { createContext, GraphQLContext, prisma } from "./prisma"
import { checkMigrations, createHealthCheck, redisReadiness, withHealth } from "./health"
import { createCache } from "./cache"
import { createErrorMasker } from "./errors/graphql-error"
import { createMailConfigFromEnv } from "./mail/config"
import { createMailService } from "./mail/service"
import { createAppLogger } from "./observability/logger"
import { createPiiHasher } from "./observability/privacy"
import { createRequestTracingPlugin, getRequestId } from "./observability/request-tracing"
import { jobHandlers } from "./jobs/job-handlers"
import { createJobWorker } from "./jobs/job-worker"
import { createPrismaJobStore } from "./jobs/prisma-job-store"
import { startPermissionExceptionExpiry } from "./permission-exceptions/scheduler"
import type { PermissionExceptionClient } from "./permission-exceptions/service"
import {
  createRateLimiter,
  createRateLimitPlugin,
  createRateLimitStore,
  startRateLimitCounterPrune,
  type RateLimitDatabaseClient
} from "./rate-limits"

const PORT = process.env.PORT || 4000
const cache = createCache({ redisUrl: process.env.REDIS_URL })
const logger = createAppLogger({ service: "api", environment: process.env.NODE_ENV ?? "development" })
const piiHasher = createPiiHasher(process.env.LOG_HASH_SECRET)
const forwardedRequestSecret = process.env.REQUEST_ID_FORWARD_SECRET
if (!forwardedRequestSecret) throw new Error("REQUEST_ID_FORWARD_SECRET must be defined")
const mailConfig = createMailConfigFromEnv(process.env)
const mail = createMailService({ store: prisma, transport: mailConfig.transport, logger, from: mailConfig.from })
const maskError = createErrorMasker({ logger, requestIdFactory: getRequestId })
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

const yoga = createYoga<GraphQLContext>({
  schema,
  context: (initialContext) => createContext(initialContext, cache, logger, piiHasher, mail, rateLimiter),
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

const health = createHealthCheck(
  {
    postgres: () => prisma.$queryRaw`SELECT 1 AS ok`,
    migrations: () =>
      checkMigrations(
        () => prisma.$queryRaw`SELECT migration_name, finished_at, rolled_back_at FROM "_prisma_migrations"`
      ),
    redis: redisReadiness(cache)
  },
  process.env.RENDER_GIT_COMMIT
)
const server = createServer(withHealth(yoga, health))
const jobWorker = createJobWorker({ store: createPrismaJobStore(prisma), handlers: jobHandlers, logger })
jobWorker.start()
server.on("close", () => jobWorker.stop())
startPermissionExceptionExpiry(prisma as unknown as PermissionExceptionClient, logger)
startRateLimitCounterPrune(rateLimitClient, logger)
server.listen(PORT)

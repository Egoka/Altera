import "dotenv/config"
import { createServer } from "node:http"
import { createYoga } from "graphql-yoga"
import { useCSRFPrevention } from "@graphql-yoga/plugin-csrf-prevention"
import { blockFieldSuggestionsPlugin } from "@escape.tech/graphql-armor-block-field-suggestions"
import { schema } from "./graphql/schema"
import { createContext, GraphQLContext } from "./prisma"
import { createCache } from "./cache"
import { createErrorMasker } from "./errors/graphql-error.js"
import { createAppLogger } from "./observability/logger"
import { createPiiHasher } from "./observability/privacy"

const PORT = process.env.PORT || 4000
const cache = createCache({ redisUrl: process.env.REDIS_URL })
const logger = createAppLogger({ service: "api", environment: process.env.NODE_ENV ?? "development" })
const piiHasher = createPiiHasher(process.env.LOG_HASH_SECRET)
const maskError = createErrorMasker({ logger })

const yoga = createYoga<GraphQLContext>({
  schema,
  context: (initialContext) => createContext(initialContext, cache, logger, piiHasher),
  logging: false,
  maskedErrors: { isDev: false, maskError },
  cors: {
    origin: process.env.FRONTEND_URL,
    credentials: true,
    methods: ["POST"]
  },
  graphqlEndpoint: "/",
  plugins: [useCSRFPrevention(), process.env.NODE_ENV === "production" && blockFieldSuggestionsPlugin()].filter(Boolean)
})

const server = createServer(yoga)
server.listen(PORT)

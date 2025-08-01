import "dotenv/config"
import { createServer } from "node:http"
import { createYoga } from "graphql-yoga"
import { useCSRFPrevention } from "@graphql-yoga/plugin-csrf-prevention"
import { blockFieldSuggestionsPlugin } from "@escape.tech/graphql-armor-block-field-suggestions"
import { schema } from "./graphql/schema"
import { createContext, GraphQLContext } from "./prisma"

const PORT = process.env.PORT || 4000

const yoga = createYoga<GraphQLContext>({
  schema,
  context: (initialContext) => createContext(initialContext),
  cors: {
    origin: process.env.FRONTEND_URL,
    credentials: true,
    methods: ["POST"]
  },
  graphqlEndpoint: "/",
  plugins: [useCSRFPrevention(), process.env.NODE_ENV === "production" && blockFieldSuggestionsPlugin()].filter(Boolean)
})

const server = createServer(yoga)
server.listen(PORT, () => {
  console.info(`Server is running on http://localhost:${PORT}/`)
})

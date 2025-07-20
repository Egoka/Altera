import { createServer } from "node:http"
import { createYoga } from "graphql-yoga"
import { schema } from "./graphql/schema"
import { createContext, GraphQLContext } from "./prisma"

const PORT = process.env.PORT || 4000

const yoga = createYoga<GraphQLContext>({
  schema,
  context: createContext
})

const server = createServer(yoga)
server.listen(PORT, () => {
  console.info(`Server is running on http://localhost:${PORT}/graphql`)
})

import { createSchema } from "graphql-yoga"
import { GraphQLContext } from "../context"
import { loadFilesSync } from "@graphql-tools/load-files"
import { mergeResolvers, mergeTypeDefs } from "@graphql-tools/merge"
import path from "path"

const typesArray = loadFilesSync(path.join(__dirname), { extensions: ["graphql"] })
const resolversArray = loadFilesSync(path.join(__dirname, "**/resolver.ts"))
export const schema = createSchema<GraphQLContext>({
  typeDefs: mergeTypeDefs(typesArray),
  resolvers: mergeResolvers(resolversArray)
})

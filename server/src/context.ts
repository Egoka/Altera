import { PrismaClient } from "./prisma"

// Создадим один экземпляр PrismaClient
const prisma = new PrismaClient()

export interface GraphQLContext {
  prisma: PrismaClient
}

export async function createContext(): Promise<GraphQLContext> {
  return { prisma }
}

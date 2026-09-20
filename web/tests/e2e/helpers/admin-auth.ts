import type { Page } from "@playwright/test"
import { PrismaClient } from "../../../../server/src/generated/prisma/index.js"
import { createSessionId, signAccessToken } from "./session-token"

const databaseUrl = process.env.T069_TEST_DATABASE_URL ?? "postgresql://test:test@127.0.0.1:5432/test"
const userId = "t069-layout-admin"
const handle = "t069-layout-admin"

export async function authenticateAdminPage(page: Page) {
  const prisma = new PrismaClient({ datasourceUrl: databaseUrl })
  let sessionId: string
  try {
    await prisma.handleHistory.upsert({ where: { handle }, update: {}, create: { handle } })
    await prisma.user.upsert({
      where: { email: `${handle}@example.test` },
      update: { archivedAt: null, isServiceAccount: true, role: "admin" },
      create: {
        id: userId,
        email: `${handle}@example.test`,
        handle,
        isServiceAccount: true,
        name: "T069 layout admin",
        role: "admin"
      }
    })
    await prisma.handleHistory.update({ where: { handle }, data: { userId } })
    sessionId = await createSessionId(prisma, userId)
  } finally {
    await prisma.$disconnect()
  }

  await page.setExtraHTTPHeaders({ authorization: `Bearer ${signAccessToken(userId, sessionId)}` })
}

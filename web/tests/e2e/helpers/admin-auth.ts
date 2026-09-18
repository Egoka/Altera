import type { Page } from "@playwright/test"
import { createHmac } from "node:crypto"
import { PrismaClient } from "../../../../server/src/generated/prisma/index.js"

const databaseUrl = process.env.T069_TEST_DATABASE_URL ?? "postgresql://test:test@127.0.0.1:5432/test"
const accessSecret = "t009-test-access-secret"
const userId = "t069-layout-admin"
const handle = "t069-layout-admin"

function signAdminToken() {
  const encodedHeader = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url")
  const encodedPayload = Buffer.from(
    JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 900, role: "admin", userId })
  ).toString("base64url")
  const unsigned = `${encodedHeader}.${encodedPayload}`
  const signature = createHmac("sha256", accessSecret).update(unsigned).digest("base64url")
  return `${unsigned}.${signature}`
}

export async function authenticateAdminPage(page: Page) {
  const prisma = new PrismaClient({ datasourceUrl: databaseUrl })
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
  } finally {
    await prisma.$disconnect()
  }

  await page.setExtraHTTPHeaders({ authorization: `Bearer ${signAdminToken()}` })
}

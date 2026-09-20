import { expect, test, type Page, type Route } from "@playwright/test"

// Строки состояний раздела «Администраторы» (`docs/spec/40-admin/admins.md` §9).

const staffRows = [
  {
    id: "staff-editor",
    name: "Редактор журнала",
    email: "r***р@altera.test",
    emailMasked: true,
    role: "editor",
    status: "active",
    createdAt: "2026-09-01T00:00:00.000Z",
    createdByName: "Администратор",
    lastActiveAt: "2026-09-19T10:00:00.000Z",
    activeExceptionCount: 1,
    archivedAt: null,
    archiveReason: null
  },
  {
    id: "staff-owner",
    name: "Второй владелец",
    email: "o***r@altera.test",
    emailMasked: true,
    role: "owner",
    status: "active",
    createdAt: "2026-08-01T00:00:00.000Z",
    createdByName: "Первый владелец",
    lastActiveAt: "2026-09-20T09:00:00.000Z",
    activeExceptionCount: 0,
    archivedAt: null,
    archiveReason: null
  }
]

const staffCard = {
  ...staffRows[0],
  email: "redaktor@altera.test",
  emailMasked: false,
  sessionCount: 2,
  roleHistory: [
    {
      id: "history-1",
      action: "user.role.change",
      before: "moderator",
      after: "editor",
      actorName: "Первый владелец",
      reason: "Перевод в редакцию",
      createdAt: "2026-09-10T00:00:00.000Z"
    }
  ],
  exceptions: [
    {
      id: "exception-1",
      permission: "publish",
      kind: "grant",
      reason: "Совмещение обязанностей",
      startsAt: "2026-09-02T00:00:00.000Z",
      endsAt: "2026-10-02T00:00:00.000Z",
      revokedAt: null,
      expiredAt: null
    }
  ]
}

interface MockOptions {
  role?: "admin" | "owner"
  rows?: unknown[]
  listError?: { code: string; requestId: string }
  mutationError?: { code: string }
  delayListMs?: number
  onAssignOwner?: () => void
}

async function mockAdminStaff(page: Page, options: MockOptions = {}) {
  const role = options.role ?? "owner"

  await page.route("**/api/graphql", async (route: Route) => {
    const body = route.request().postDataJSON() as { query?: string }
    const query = body.query ?? ""
    let payload: Record<string, unknown>

    if (query.includes("GetAdminSummary")) {
      payload = { data: { adminSummary: { role, cards: [] } } }
    } else if (query.includes("GetAdminStaffMember")) {
      payload = { data: { adminStaffMember: staffCard } }
    } else if (query.includes("GetAdminStaff")) {
      if (options.delayListMs) await new Promise((resolve) => setTimeout(resolve, options.delayListMs))
      payload = options.listError
        ? { data: { adminStaff: null }, errors: [{ message: "failed", extensions: options.listError }] }
        : { data: { adminStaff: options.rows ?? staffRows } }
    } else if (query.includes("GetOwners")) {
      payload = {
        data: {
          owners: [
            {
              id: "staff-owner",
              name: "Второй владелец",
              email: "owner@altera.test",
              status: "active",
              assignedAt: "2026-09-12T00:00:00.000Z"
            }
          ]
        }
      }
    } else if (query.includes("AssignOwner")) {
      options.onAssignOwner?.()
      payload = { data: { assignOwner: { id: "staff-editor" } } }
    } else if (
      /ChangeStaffRole|RevokeStaffRole|RevokeOwner|DeactivateOwner|ArchiveStaffAccount|RestoreStaffAccount|CreateStaff/.test(
        query
      )
    ) {
      payload = options.mutationError
        ? { data: null, errors: [{ message: "conflict", extensions: options.mutationError }] }
        : { data: { result: { id: "staff-editor" } } }
    } else {
      return route.continue()
    }

    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(payload) })
  })
}

async function openAdmins(page: Page, options: { waitForList?: boolean } = {}) {
  await page.goto("/")
  const waitForList = options.waitForList !== false
  const listResponse = waitForList
    ? page.waitForResponse(
        (response) =>
          response.url().includes("/api/graphql") && response.request().postData()?.includes("GetAdminStaff") === true
      )
    : null
  await page.evaluate(() => {
    window.history.pushState({}, "", "/admin/admins")
    window.dispatchEvent(new PopStateEvent("popstate"))
  })
  await expect(page).toHaveURL(/\/admin\/admins/)
  if (listResponse) await listResponse
}

test.describe("раздел «Администраторы»: состояния", () => {
  test("показывает скелеты, пока список загружается", async ({ page }) => {
    await mockAdminStaff(page, { delayListMs: 1500 })
    await openAdmins(page, { waitForList: false })

    await expect(page.getByRole("status", { name: /загрузка списка/i })).toBeVisible()
  })

  test("показывает пустое состояние, когда по фильтру ничего нет", async ({ page }) => {
    await mockAdminStaff(page, { rows: [] })
    await openAdmins(page)

    await expect(page.getByText(/по фильтру ничего не найдено/i)).toBeVisible()
  })

  test("показывает ошибку с кодом запроса", async ({ page }) => {
    await mockAdminStaff(page, { listError: { code: "INTERNAL_ERROR", requestId: "req-staff-42" } })
    await openAdmins(page)

    const alert = page.getByRole("main").getByRole("alert")
    await expect(alert).toContainText(/не удалось выполнить запрос/i)
    await expect(alert).toContainText("req-staff-42")
  })

  test("показывает список с маскированным адресом и владельцами", async ({ page }) => {
    await mockAdminStaff(page)
    await openAdmins(page)

    await expect(page.locator("tbody").getByText("Редактор журнала")).toBeVisible()
    await expect(page.locator("tbody").getByText("r***р@altera.test")).toBeVisible()
    await expect(page.getByRole("heading", { name: /владельцы/i })).toBeVisible()
  })

  test("ограничивает администратора чтением и созданием", async ({ page }) => {
    await mockAdminStaff(page, { role: "admin" })
    await openAdmins(page)

    await expect(page.getByText(/изменения ролей и архив служебных записей — только владелец/i)).toBeVisible()
    await expect(page.getByRole("button", { name: /создать служебную запись/i })).toBeVisible()

    await page.locator("tbody").getByText("Редактор журнала").click()
    await expect(page.getByRole("button", { name: /^сменить роль$/i })).toHaveCount(0)
    await expect(page.getByRole("button", { name: /архивировать запись/i })).toHaveCount(0)
    await expect(page.getByRole("heading", { name: /владельцы/i })).toHaveCount(0)
  })

  test("сообщает о конфликте, когда запись изменена другим администратором", async ({ page }) => {
    await mockAdminStaff(page, { mutationError: { code: "CONFLICT" } })
    await openAdmins(page)

    await page.locator("tbody").getByText("Редактор журнала").click()
    await page.getByRole("button", { name: /^сменить роль$/i }).click()
    await page.getByLabel(/^причина$/i).fill("Перевод")
    await page.getByRole("button", { name: /подтвердить/i }).click()

    await expect(page.getByText(/запись изменена другим администратором/i).first()).toBeVisible()
  })

  test("не показывает ограничений по лимиту: административные действия не лимитируются", async ({ page }) => {
    await mockAdminStaff(page)
    await openAdmins(page)

    await expect(page.getByText(/лимит|rate limit/i)).toHaveCount(0)
  })
})

test.describe("назначение владельца в два шага", () => {
  test("выдаёт роль только на втором шаге после точного e-mail", async ({ page }) => {
    let assigned = 0
    await mockAdminStaff(page, { onAssignOwner: () => (assigned += 1) })
    await openAdmins(page)

    await page.locator("tbody").getByText("Редактор журнала").click()
    await page.getByRole("button", { name: /назначить владельцем/i }).click()

    await expect(page.getByText(/шаг 1 из 2/i)).toBeVisible()
    expect(assigned).toBe(0)

    await page.getByRole("button", { name: /продолжить/i }).click()
    await expect(page.getByText(/шаг 2 из 2/i)).toBeVisible()

    const confirm = page.getByRole("button", { name: /назначить владельцем/i }).last()
    await page.getByLabel(/e-mail служебной записи/i).fill("wrong@altera.test")
    await expect(confirm).toBeDisabled()
    expect(assigned).toBe(0)

    await page.getByLabel(/e-mail служебной записи/i).fill("redaktor@altera.test")
    await expect(confirm).toBeEnabled()
    await confirm.click()

    await expect.poll(() => assigned).toBe(1)
  })
})

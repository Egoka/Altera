import { expect, test, type Page, type Route } from "./helpers/test"
import { navigateOnClient } from "./helpers/hydration"

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

/** Карточка владельца: у неё другие кнопки действий, чем у обычной служебной записи (§26.7). */
const ownerCard = {
  ...staffRows[1],
  email: "owner@altera.test",
  emailMasked: false,
  sessionCount: 1,
  roleHistory: [],
  exceptions: []
}

const staffCards: Record<string, unknown> = { "staff-editor": staffCard, "staff-owner": ownerCard }

/** Поле ответа мутации: composable считает действие выполненным только по своему полю. */
const MUTATION_FIELDS: Record<string, string> = {
  CreateStaff: "createStaff",
  ChangeStaffRole: "changeStaffRole",
  RevokeStaffRole: "revokeStaffRole",
  RevokeOwner: "revokeOwner",
  DeactivateOwner: "deactivateOwner",
  ArchiveStaffAccount: "archiveStaffAccount",
  RestoreStaffAccount: "restoreStaffAccount"
}

/** Extensions отказа: словарь ошибок отдаёт `requestId` только у части кодов. */
interface MutationError {
  code: string
  entity?: string
  field?: string
  rule?: string
  requestId?: string
}

interface MockOptions {
  role?: "admin" | "owner"
  rows?: unknown[]
  listError?: { code: string; requestId: string }
  mutationError?: MutationError
  assignError?: MutationError
  delayListMs?: number
  onAssignOwner?: () => void
  onList?: () => void
}

async function mockAdminStaff(page: Page, options: MockOptions = {}) {
  const role = options.role ?? "owner"

  await page.route("**/api/graphql", async (route: Route) => {
    const body = route.request().postDataJSON() as { query?: string; variables?: { id?: string } }
    const query = body.query ?? ""
    let payload: Record<string, unknown>

    if (query.includes("GetAdminSummary")) {
      payload = { data: { adminSummary: { role, cards: [] } } }
    } else if (query.includes("GetAdminStaffMember")) {
      // Карточка зависит от строки: у владельца в ней другие кнопки действий (§26.7).
      payload = { data: { adminStaffMember: staffCards[body.variables?.id ?? ""] ?? staffCard } }
    } else if (query.includes("GetAdminStaff")) {
      if (options.delayListMs) await new Promise((resolve) => setTimeout(resolve, options.delayListMs))
      options.onList?.()
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
              email: "o***r@altera.test",
              emailMasked: true,
              status: "active",
              assignedAt: "2026-09-12T00:00:00.000Z"
            }
          ]
        }
      }
    } else if (query.includes("AssignOwner")) {
      options.onAssignOwner?.()
      payload = options.assignError
        ? { data: null, errors: [{ message: "failed", extensions: options.assignError }] }
        : { data: { assignOwner: { id: "staff-editor" } } }
    } else {
      const operation = Object.keys(MUTATION_FIELDS).find((name) => query.includes(name))
      if (!operation) return route.continue()
      payload = options.mutationError
        ? { data: null, errors: [{ message: "failed", extensions: options.mutationError }] }
        : { data: { [MUTATION_FIELDS[operation]!]: { id: "staff-editor" } } }
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
  await navigateOnClient(page, "/admin/admins")
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
    // Список владельцев — тоже список: полного адреса в нём нет (журнал §28.7).
    const owners = page.locator("[data-staff-owners]")
    await expect(owners).toContainText("o***r@altera.test")
    await expect(owners).not.toContainText("owner@altera.test")
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

  test("перечитывает список после отказа мутации", async ({ page }) => {
    let lists = 0
    await mockAdminStaff(page, { mutationError: { code: "CONFLICT", entity: "user" }, onList: () => (lists += 1) })
    await openAdmins(page)
    const before = lists

    await page.locator("tbody").getByText("Редактор журнала").click()
    await page.getByRole("button", { name: /^сменить роль$/i }).click()
    await page.getByLabel(/^причина$/i).fill("Перевод")
    await page.getByRole("button", { name: /подтвердить/i }).click()

    await expect.poll(() => lists).toBeGreaterThan(before)
  })

  test("не показывает ограничений по лимиту: административные действия не лимитируются", async ({ page }) => {
    await mockAdminStaff(page)
    await openAdmins(page)

    await expect(page.getByText(/лимит|rate limit/i)).toHaveCount(0)
  })
})

// Строка состояния «Ошибка — мутация» (`admins.md` §9): свой текст на каждый код мутаций раздела.
test.describe("раздел «Администраторы»: ошибки действий", () => {
  const changeRole = async (page: Page) => {
    await page.locator("tbody").getByText("Редактор журнала").click()
    await page.getByRole("button", { name: /^сменить роль$/i }).click()
    await page.getByLabel(/^причина$/i).fill("Перевод")
    await page.getByRole("button", { name: /подтвердить/i }).click()
  }

  const revokeOwner = async (page: Page) => {
    await page.locator("tbody").getByText("Второй владелец").click()
    await page.getByRole("button", { name: /отозвать роль владельца/i }).click()
    await page.getByLabel(/^причина$/i).fill("Передал дела")
    await page.getByRole("button", { name: /подтвердить/i }).click()
  }

  const createStaff = async (page: Page) => {
    await page.getByRole("button", { name: /создать служебную запись/i }).click()
    await page.getByLabel(/^e-mail$/i).fill("reader@altera.test")
    await page.getByLabel(/служебное имя/i).fill("Редактор")
    await page
      .getByRole("button", { name: /создать служебную запись/i })
      .last()
      .click()
  }

  const failure = (page: Page, code: string) => page.locator(`[data-staff-failure="${code}"]`).first()

  test("показывает отказ прав на смене роли", async ({ page }) => {
    await mockAdminStaff(page, { mutationError: { code: "FORBIDDEN" } })
    await openAdmins(page)
    await changeRole(page)

    await expect(failure(page, "FORBIDDEN")).toContainText(/только владелец/i)
  })

  test("показывает исчезнувшую запись на смене роли", async ({ page }) => {
    await mockAdminStaff(page, { mutationError: { code: "NOT_FOUND", entity: "user" } })
    await openAdmins(page)
    await changeRole(page)

    await expect(failure(page, "NOT_FOUND")).toContainText(/не найдена/i)
  })

  test("показывает запрет на отзыв последнего владельца", async ({ page }) => {
    await mockAdminStaff(page, { mutationError: { code: "CONFLICT", entity: "owner" } })
    await openAdmins(page)
    await revokeOwner(page)

    await expect(failure(page, "CONFLICT")).toContainText(/последнего владельца/i)
  })

  test("показывает отказ проверки адреса при создании записи", async ({ page }) => {
    await mockAdminStaff(page, { mutationError: { code: "VALIDATION_ERROR", field: "email", rule: "not-an-account" } })
    await openAdmins(page)
    await createStaff(page)

    await expect(failure(page, "VALIDATION_ERROR")).toContainText(/читателя или автора/i)
  })

  test("показывает недоступность почты с кодом запроса", async ({ page }) => {
    await mockAdminStaff(page, {
      mutationError: { code: "PROVIDER_UNAVAILABLE", requestId: "req-staff-77" }
    })
    await openAdmins(page)
    await createStaff(page)

    const alert = failure(page, "PROVIDER_UNAVAILABLE")
    await expect(alert).toContainText(/почта недоступна/i)
    await expect(alert).toContainText("req-staff-77")
  })

  test("показывает архив записи на назначении владельцем", async ({ page }) => {
    await mockAdminStaff(page, { assignError: { code: "ARCHIVED", entity: "user" } })
    await openAdmins(page)

    await page.locator("tbody").getByText("Редактор журнала").click()
    await page.getByRole("button", { name: /назначить владельцем/i }).click()
    await page.getByRole("button", { name: /продолжить/i }).click()
    await page.getByLabel(/e-mail служебной записи/i).fill("redaktor@altera.test")
    await page
      .getByRole("button", { name: /назначить владельцем/i })
      .last()
      .click()

    await expect(failure(page, "ARCHIVED")).toContainText(/в архиве/i)
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

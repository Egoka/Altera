import { PlanTier, Prisma } from "../src/generated/prisma"
import { describe, expect, it } from "vitest"

const modelFields = (name: string) => {
  const model = Prisma.dmmf.datamodel.models.find((candidate) => candidate.name === name)
  expect(model, `Prisma model ${name} must exist`).toBeDefined()
  return new Map(model!.fields.map((field) => [field.name, field]))
}

describe("T-017 bookmark and base authorship schema", () => {
  it("exposes the plan cache and a lifelong standard grant for T-026", () => {
    expect(Object.values(PlanTier)).toEqual(["free", "standard", "pro"])

    const user = modelFields("User")
    expect(user.get("planTier")).toMatchObject({ type: "PlanTier", isRequired: true, hasDefaultValue: true })
    expect(user.get("planUntil")).toMatchObject({ type: "DateTime", isRequired: false })

    const grant = modelFields("PlanGrant")
    expect(grant.get("tier")).toMatchObject({ type: "PlanTier", isRequired: true })
    expect(grant.get("startsAt")).toMatchObject({ type: "DateTime", isRequired: true, hasDefaultValue: true })
    expect(grant.get("endsAt")).toMatchObject({ type: "DateTime", isRequired: false })
    expect(grant.get("grantedById")).toMatchObject({ type: "String", isRequired: false })
    expect(grant.get("revokedAt")).toMatchObject({ type: "DateTime", isRequired: false })
  })

  it("models a private bookmark as one user/article pair", () => {
    const bookmark = modelFields("Bookmark")

    expect(bookmark.get("userId")).toMatchObject({ type: "String", isRequired: true })
    expect(bookmark.get("articleId")).toMatchObject({ type: "String", isRequired: true })
    expect(bookmark.get("createdAt")).toMatchObject({ type: "DateTime", isRequired: true, hasDefaultValue: true })
    expect(bookmark.get("user")).toMatchObject({ type: "User", relationOnDelete: "Cascade" })
    expect(bookmark.get("article")).toMatchObject({ type: "Article", relationOnDelete: "Cascade" })
  })
})

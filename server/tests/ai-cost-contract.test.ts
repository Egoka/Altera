/**
 * T-048, критерий готовности 3: стоимость записывается так, что доступна только агрегатом.
 *
 * Контракт раздела «AI-процессы» (`docs/spec/40-admin/ai-processes.md` §3, журнал §27.4):
 * стоимость отдельной записи не показывается никому, финансовая информация идёт только
 * агрегированно. Поэтому поля стоимости нет ни в модели записи, ни в схеме API: показать её
 * отдельной строкой невозможно, а не «не предусмотрено интерфейсом».
 */

import { loadFilesSync } from "@graphql-tools/load-files"
import { mergeTypeDefs } from "@graphql-tools/merge"
import { buildASTSchema, isObjectType } from "graphql"
import { readFileSync } from "node:fs"
import path from "node:path"
import { describe, expect, it } from "vitest"
import { Prisma } from "../src/generated/prisma"

const schemaPath = path.resolve(__dirname, "../prisma/schema.prisma")

function prismaModelFields(model: string): string[] {
  const schema = readFileSync(schemaPath, "utf8")
  const start = schema.indexOf(`model ${model} {`)
  expect(start).toBeGreaterThan(-1)
  const end = schema.indexOf("\n}", start)
  return schema
    .slice(start, end)
    .split("\n")
    .slice(1)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("//") && !line.startsWith("///") && !line.startsWith("@@"))
    .map((line) => line.split(/\s+/)[0])
}

function graphqlSchema() {
  const typeDefs = loadFilesSync(path.resolve(__dirname, "../src/graphql"), { extensions: ["graphql"] })
  return buildASTSchema(mergeTypeDefs(typeDefs))
}

describe("контракт стоимости AI-процессов", () => {
  it("у записи AI-процесса нет поля стоимости", () => {
    const fields = prismaModelFields("AiProcess")

    expect(fields).toContain("verdict")
    expect(fields).toContain("promptVersion")
    expect(fields.filter((field) => /cost|price|amount|minor/i.test(field))).toEqual([])
    // Тот же контракт на уровне клиента Prisma: обновить несуществующее поле нельзя.
    expect(Object.keys(Prisma.AiProcessScalarFieldEnum).filter((field) => /cost/i.test(field))).toEqual([])
  })

  it("стоимость живёт только в агрегате по периоду", () => {
    const fields = prismaModelFields("AiCostAggregate")

    expect(fields).toContain("bucketStart")
    expect(fields).toContain("bucketEnd")
    expect(fields).toContain("totalCostMinor")
    expect(fields).toContain("processCount")
    // Агрегат не ссылается на отдельную запись: восстановить стоимость одной проверки по нему
    // нельзя даже при полном доступе к базе.
    expect(fields).not.toContain("aiProcessId")
    expect(fields).not.toContain("objectId")
  })

  it("схема API отдаёт стоимость только в агрегате, а не в записи или карточке", () => {
    const schema = graphqlSchema()
    const process = schema.getType("AdminAiProcess")
    const stats = schema.getType("AdminAiStats")
    const query = schema.getQueryType()
    const mutation = schema.getMutationType()

    expect(isObjectType(process)).toBe(true)
    expect(isObjectType(stats)).toBe(true)
    if (!isObjectType(process) || !isObjectType(stats)) return

    expect(Object.keys(process.getFields()).filter((field) => /cost|price|amount|minor/i.test(field))).toEqual([])
    expect(Object.keys(stats.getFields())).toContain("totalCostMinor")
    expect(Object.keys(stats.getFields())).toContain("processCount")
    expect(query?.getFields()).toMatchObject({
      adminAiRecords: expect.any(Object),
      adminAiRecord: expect.any(Object),
      aiStats: expect.any(Object)
    })
    expect(mutation?.getFields()).not.toHaveProperty("retryAiProcess")
    expect(mutation?.getFields()).not.toHaveProperty("runAiProcess")

    const costFields: string[] = []
    for (const type of Object.values(schema.getTypeMap())) {
      if (!isObjectType(type) || type.name.startsWith("__")) continue
      for (const field of Object.values(type.getFields())) {
        if (/cost|price/i.test(field.name)) costFields.push(`${type.name}.${field.name}`)
      }
    }
    // T-075 открыл только агрегированную стоимость раздела статистики. Граница остаётся строгой:
    // стоимость доступна у агрегата, но отдельного API-типа процесса по-прежнему нет.
    expect(costFields.filter((field) => /^Ai/.test(field))).toEqual(["AiStatistics.costMinor"])
    expect(schema.getType("AiProcess")).toBeUndefined()
  })
})

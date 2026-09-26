/**
 * Проверка документа перед сохранением.
 *
 * Сервер вызывает `validateDocument` при каждом сохранении и отклоняет недопустимый документ
 * с кодом `CONTENT_INVALID` (ADR-0029 п. 2). Проверяются форма JSON, состав узлов и марок по
 * каталогу (`schema.ts`), значения атрибутов, вложенность и размеры.
 */

import {
  ALLOWED_LINK_SCHEMES,
  MARK_SPECS,
  NODE_SPECS,
  isKnownMarkType,
  isKnownNodeType,
  type AttrSpec,
  type NodeSpec
} from "./schema"
import { CONTENT_SCHEMA_VERSION } from "./migrate"
import type { ContentDocument, ContentNode } from "./types"

/** Код ошибки API для недопустимого документа (ADR-0029 п. 2, словарь ошибок ADR-0032). */
export const CONTENT_INVALID = "CONTENT_INVALID"

export type ValidationCode =
  | "not_an_object"
  | "not_a_document"
  | "unsupported_schema_version"
  | "unknown_node"
  | "unexpected_node"
  | "missing_content"
  | "empty_text"
  | "text_not_allowed"
  | "content_not_allowed"
  | "unknown_attribute"
  | "forbidden_attribute"
  | "missing_attribute"
  | "invalid_attribute"
  | "unknown_mark"
  | "duplicate_mark"
  | "marks_not_allowed"
  | "unsafe_link"
  | "duplicate_node_id"
  | "too_deep"
  | "too_many_nodes"
  | "text_too_long"

export interface ValidationIssue {
  /** Путь к месту ошибки, например `doc.content[1].attrs.level`. */
  path: string
  code: ValidationCode
  message: string
}

/**
 * Ограничения глубины и размеров (ADR-0029 п. 1).
 *
 * Глубина 2 следует из ADR-0017 («глубина не более двух»). Число узлов и суммарная длина
 * текста — `[ДОПУЩЕНИЕ]`: владелец числовых порогов для документа не задавал, поэтому они
 * вынесены в параметры и заменяются без правки кода.
 */
export interface ValidationLimits {
  /** Максимальная глубина блочной вложенности: блок первого уровня — 1. */
  maxBlockDepth: number
  /** Максимальное число узлов в документе, включая текстовые. */
  maxNodes: number
  /** Максимальная суммарная длина текста документа в символах. */
  maxTextLength: number
}

export const DEFAULT_VALIDATION_LIMITS: ValidationLimits = {
  maxBlockDepth: 2,
  maxNodes: 5000,
  maxTextLength: 200000
}

export interface ValidationSuccess {
  valid: true
  document: ContentDocument
}

export interface ValidationFailure {
  valid: false
  code: typeof CONTENT_INVALID
  errors: ValidationIssue[]
}

export type ValidationResult = ValidationSuccess | ValidationFailure

export class ContentInvalidError extends Error {
  readonly code = CONTENT_INVALID
  readonly errors: ValidationIssue[]

  constructor(errors: ValidationIssue[]) {
    super(`${CONTENT_INVALID}: ${errors.map((issue) => `${issue.path} — ${issue.message}`).join("; ")}`)
    this.name = "ContentInvalidError"
    this.errors = errors
  }
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

interface Walker {
  errors: ValidationIssue[]
  limits: ValidationLimits
  nodeCount: number
  textLength: number
  seenIds: Set<string>
}

export function validateDocument(input: unknown, limits?: Partial<ValidationLimits>): ValidationResult {
  const walker: Walker = {
    errors: [],
    limits: { ...DEFAULT_VALIDATION_LIMITS, ...limits },
    nodeCount: 0,
    textLength: 0,
    seenIds: new Set()
  }

  if (!isPlainObject(input)) {
    return failure([issue("doc", "not_an_object", "документ должен быть объектом JSON")])
  }
  if (input.type !== "doc") {
    return failure([issue("doc", "not_a_document", `корневой узел должен быть doc, получен ${describe(input.type)}`)])
  }

  validateNode(input, "doc", 0, walker)

  if (walker.nodeCount > walker.limits.maxNodes) {
    walker.errors.push(
      issue("doc", "too_many_nodes", `в документе ${walker.nodeCount} узлов при пределе ${walker.limits.maxNodes}`)
    )
  }
  if (walker.textLength > walker.limits.maxTextLength) {
    walker.errors.push(
      issue(
        "doc",
        "text_too_long",
        `в документе ${walker.textLength} символов текста при пределе ${walker.limits.maxTextLength}`
      )
    )
  }

  if (walker.errors.length > 0) return failure(walker.errors)
  return { valid: true, document: input as unknown as ContentDocument }
}

/** То же самое, но недопустимый документ выбрасывается как `ContentInvalidError`. */
export function assertValidDocument(input: unknown, limits?: Partial<ValidationLimits>): ContentDocument {
  const result = validateDocument(input, limits)
  if (!result.valid) throw new ContentInvalidError(result.errors)
  return result.document
}

function validateNode(node: Record<string, unknown>, path: string, blockDepth: number, walker: Walker): void {
  walker.nodeCount += 1

  const type = node.type
  if (typeof type !== "string" || !isKnownNodeType(type)) {
    walker.errors.push(issue(path, "unknown_node", `узел ${describe(type)} не входит в каталог блоков`))
    return
  }

  const spec = NODE_SPECS[type]
  // Глубину считают только блоки каталога: `listItem` — служебная обвязка списка, а не блок,
  // поэтому абзац внутри пункта остаётся на втором уровне, как и абзац внутри цитаты (ADR-0017).
  if (spec.group === "block") {
    const depth = blockDepth + 1
    if (depth > walker.limits.maxBlockDepth) {
      walker.errors.push(
        issue(path, "too_deep", `вложенность ${depth} превышает предел ${walker.limits.maxBlockDepth}`)
      )
      return
    }
    blockDepth = depth
  }

  validateAttrs(node, path, type, spec, walker)
  validateMarks(node, path, spec, walker)
  validateText(node, path, type, walker)
  validateContent(node, path, type, spec, blockDepth, walker)
}

function validateAttrs(
  node: Record<string, unknown>,
  path: string,
  type: string,
  spec: NodeSpec,
  walker: Walker
): void {
  const raw = node.attrs
  if (raw !== undefined && !isPlainObject(raw)) {
    walker.errors.push(issue(`${path}.attrs`, "invalid_attribute", "attrs должен быть объектом"))
    return
  }
  const attrs: Record<string, unknown> = isPlainObject(raw) ? raw : {}

  for (const name of Object.keys(attrs)) {
    const forbidden = spec.forbiddenAttrs?.[name]
    if (forbidden) {
      walker.errors.push(
        issue(`${path}.attrs.${name}`, "forbidden_attribute", `узел ${type} не принимает ${name}: ${forbidden}`)
      )
      continue
    }
    if (!Object.prototype.hasOwnProperty.call(spec.attrs, name)) {
      walker.errors.push(issue(`${path}.attrs.${name}`, "unknown_attribute", `узел ${type} не имеет атрибута ${name}`))
    }
  }

  for (const [name, attrSpec] of Object.entries(spec.attrs)) {
    const value = attrs[name]
    const attrPath = `${path}.attrs.${name}`
    if (value === undefined || value === null) {
      if (attrSpec.required) {
        walker.errors.push(issue(attrPath, "missing_attribute", `узел ${type} требует атрибут ${name}`))
      }
      continue
    }
    const problem = checkAttrValue(value, attrSpec)
    if (problem) walker.errors.push(issue(attrPath, "invalid_attribute", problem))
  }

  if (type === "doc") {
    const version = attrs.schemaVersion
    if (typeof version === "number" && version !== CONTENT_SCHEMA_VERSION) {
      walker.errors.push(
        issue(
          `${path}.attrs.schemaVersion`,
          "unsupported_schema_version",
          `версия схемы ${version} не равна текущей ${CONTENT_SCHEMA_VERSION}: сначала примените migrateDocument`
        )
      )
    }
    return
  }

  const id = attrs.id
  if (typeof id === "string" && UUID_PATTERN.test(id)) {
    if (walker.seenIds.has(id)) {
      walker.errors.push(issue(`${path}.attrs.id`, "duplicate_node_id", `идентификатор блока ${id} уже встречался`))
    }
    walker.seenIds.add(id)
  }
}

function checkAttrValue(value: unknown, spec: AttrSpec): string | null {
  switch (spec.kind) {
    case "uuid":
      if (typeof value !== "string") return `ожидалась строка uuid, получено ${describe(value)}`
      if (!UUID_PATTERN.test(value)) return `значение ${describe(value)} не является uuid`
      return null
    case "string": {
      if (typeof value !== "string") return `ожидалась строка, получено ${describe(value)}`
      if (spec.min !== undefined && value.length < spec.min) return `строка короче ${spec.min} символов`
      if (spec.max !== undefined && value.length > spec.max) return `строка длиннее ${spec.max} символов`
      return null
    }
    case "int": {
      if (typeof value !== "number" || !Number.isInteger(value)) {
        return `ожидалось целое число, получено ${describe(value)}`
      }
      if (spec.min !== undefined && value < spec.min) return `число меньше ${spec.min}`
      if (spec.max !== undefined && value > spec.max) return `число больше ${spec.max}`
      return null
    }
    case "enum": {
      const values = spec.values ?? []
      if (!values.includes(value as string | number)) {
        return `значение ${describe(value)} не входит в набор ${values.join(", ")}`
      }
      return null
    }
  }
}

function validateMarks(node: Record<string, unknown>, path: string, spec: NodeSpec, walker: Walker): void {
  const marks = node.marks
  if (marks === undefined) return
  if (!Array.isArray(marks)) {
    walker.errors.push(issue(`${path}.marks`, "marks_not_allowed", "marks должен быть массивом"))
    return
  }
  if (!spec.marks && marks.length > 0) {
    walker.errors.push(issue(`${path}.marks`, "marks_not_allowed", `узел ${String(node.type)} не принимает марки`))
    return
  }

  const seen = new Set<string>()
  marks.forEach((mark, index) => {
    const markPath = `${path}.marks[${index}]`
    if (!isPlainObject(mark)) {
      walker.errors.push(issue(markPath, "unknown_mark", "марка должна быть объектом"))
      return
    }
    const markType = mark.type
    if (typeof markType !== "string" || !isKnownMarkType(markType)) {
      walker.errors.push(issue(markPath, "unknown_mark", `марка ${describe(markType)} не входит в каталог`))
      return
    }
    if (seen.has(markType)) {
      walker.errors.push(issue(markPath, "duplicate_mark", `марка ${markType} указана дважды`))
      return
    }
    seen.add(markType)

    const markSpec = MARK_SPECS[markType]
    const rawAttrs = mark.attrs
    if (rawAttrs !== undefined && !isPlainObject(rawAttrs)) {
      walker.errors.push(issue(`${markPath}.attrs`, "invalid_attribute", "attrs должен быть объектом"))
      return
    }
    const attrs: Record<string, unknown> = isPlainObject(rawAttrs) ? rawAttrs : {}

    for (const name of Object.keys(attrs)) {
      if (!Object.prototype.hasOwnProperty.call(markSpec.attrs, name)) {
        walker.errors.push(
          issue(`${markPath}.attrs.${name}`, "unknown_attribute", `марка ${markType} не имеет атрибута ${name}`)
        )
      }
    }
    for (const [name, attrSpec] of Object.entries(markSpec.attrs)) {
      const value = attrs[name]
      const attrPath = `${markPath}.attrs.${name}`
      if (value === undefined || value === null) {
        if (attrSpec.required) {
          walker.errors.push(issue(attrPath, "missing_attribute", `марка ${markType} требует атрибут ${name}`))
        }
        continue
      }
      const problem = checkAttrValue(value, attrSpec)
      if (problem) {
        walker.errors.push(issue(attrPath, "invalid_attribute", problem))
        continue
      }
      if (markType === "link" && name === "href" && !isSafeLink(value as string)) {
        walker.errors.push(
          issue(
            attrPath,
            "unsafe_link",
            `ссылка ${describe(value)} недопустима: разрешены ${ALLOWED_LINK_SCHEMES.join(", ")} и путь от корня сайта`
          )
        )
      }
    }
  })
}

function validateText(node: Record<string, unknown>, path: string, type: string, walker: Walker): void {
  if (type === "text") {
    const text = node.text
    if (typeof text !== "string") {
      walker.errors.push(
        issue(`${path}.text`, "empty_text", `текстовый узел требует строку, получено ${describe(text)}`)
      )
      return
    }
    if (text.length === 0) {
      walker.errors.push(issue(`${path}.text`, "empty_text", "пустой текстовый узел недопустим"))
      return
    }
    walker.textLength += text.length
    return
  }
  if (node.text !== undefined) {
    walker.errors.push(issue(`${path}.text`, "text_not_allowed", `узел ${type} не хранит текст`))
  }
}

function validateContent(
  node: Record<string, unknown>,
  path: string,
  type: string,
  spec: NodeSpec,
  blockDepth: number,
  walker: Walker
): void {
  const content = node.content
  if (spec.content === null) {
    if (Array.isArray(content) && content.length > 0) {
      walker.errors.push(issue(`${path}.content`, "content_not_allowed", `узел ${type} не имеет содержимого`))
    }
    return
  }
  if (content === undefined) {
    if (spec.content.min > 0) {
      walker.errors.push(
        issue(`${path}.content`, "missing_content", `узел ${type} требует не менее ${spec.content.min} дочерних узлов`)
      )
    }
    return
  }
  if (!Array.isArray(content)) {
    walker.errors.push(issue(`${path}.content`, "missing_content", "content должен быть массивом"))
    return
  }
  if (content.length < spec.content.min) {
    walker.errors.push(
      issue(`${path}.content`, "missing_content", `узел ${type} требует не менее ${spec.content.min} дочерних узлов`)
    )
  }

  const allowed = spec.content.nodes
  content.forEach((child, index) => {
    const childPath = `${path}.content[${index}]`
    if (!isPlainObject(child)) {
      walker.errors.push(issue(childPath, "unknown_node", "узел должен быть объектом"))
      return
    }
    const childType = child.type
    if (typeof childType === "string" && isKnownNodeType(childType) && !allowed.includes(childType)) {
      walker.errors.push(
        issue(
          childPath,
          "unexpected_node",
          `узел ${childType} недопустим внутри ${type}: ожидались ${allowed.join(", ")}`
        )
      )
      return
    }
    validateNode(child, childPath, blockDepth, walker)
  })
}

const SCHEME_PATTERN = /^([a-zA-Z][a-zA-Z0-9+.-]*):/
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/

/**
 * Ссылка допустима, если это путь от корня сайта или абсолютный адрес разрешённой схемы.
 *
 * Схема разбирается регулярным выражением, а не `URL`: пакет не зависит ни от Node, ни от DOM,
 * и приёмы вроде `java\nscript:` не проходят разбор вовсе. Протокольно-относительная форма
 * `//host` отклоняется: она наследует схему страницы.
 */
export function isSafeLink(href: string): boolean {
  if (href.length === 0) return false
  if (href.trim() !== href) return false
  if (CONTROL_CHARACTERS.test(href)) return false
  if (href.startsWith("//")) return false
  if (href.startsWith("/")) return true
  const match = SCHEME_PATTERN.exec(href)
  if (!match) return false
  return (ALLOWED_LINK_SCHEMES as readonly string[]).includes(`${(match[1] ?? "").toLowerCase()}:`)
}

function failure(errors: ValidationIssue[]): ValidationFailure {
  return { valid: false, code: CONTENT_INVALID, errors }
}

function issue(path: string, code: ValidationCode, message: string): ValidationIssue {
  return { path, code, message }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function describe(value: unknown): string {
  if (typeof value === "string") return JSON.stringify(value)
  if (value === undefined) return "undefined"
  if (value === null) return "null"
  if (Array.isArray(value)) return "массив"
  if (typeof value === "object") return "объект"
  return String(value)
}

/** Узкий помощник для потребителей: документ ли это без полного разбора ошибок. */
export function isContentDocument(input: unknown): input is ContentNode {
  return isPlainObject(input) && input.type === "doc"
}

import type { Plugin } from "graphql-yoga"
import { isForwardedByBff } from "../observability/request-tracing"
import { resolveRateLimitAddress } from "./client-address"
import type { RateLimiter } from "./limiter"
import { middlewareRulesForField } from "./policy"

/**
 * Одно middleware API применяет корзины по адресу до резолвера (`rate-limits.md` §2 п. 13):
 * проверка идёт до аутентификации и до чтения базы, поэтому перебор адресов входа не доходит
 * до создания записей. Пользовательские корзины применяет хелпер в резолвере — после прав
 * (`permission-checks.md` §2 п. 3).
 */
interface RateLimitedContext {
  requestId: string
  requestMeta?: { ip: string | null }
  rateLimiter: RateLimiter
}

/*
 * Узлы документа описаны здесь своей формой, а не типами пакета `graphql`: контракт
 * `server/tests/error-contract.test.ts` держит импорт из `graphql` внутри границы ошибок
 * `errors/graphql-error.ts`, чтобы `GraphQLError` нельзя было собрать мимо словаря. Формы ниже —
 * узлы запроса из спецификации GraphQL, читаются только на чтение.
 */
interface NamedNode {
  readonly value: string
}

interface SelectionSetNode {
  readonly selections: readonly SelectionNode[]
}

type SelectionNode =
  | { readonly kind: "Field"; readonly name: NamedNode }
  | { readonly kind: "InlineFragment"; readonly selectionSet: SelectionSetNode }
  | { readonly kind: "FragmentSpread"; readonly name: NamedNode }

interface DefinitionNode {
  readonly kind: string
  readonly name?: NamedNode
  readonly selectionSet?: SelectionSetNode
}

export interface QueryDocument {
  readonly definitions: readonly DefinitionNode[]
}

/** Корневые поля операции, включая раскрытые на верхнем уровне фрагменты. */
export function rootFieldNames(document: QueryDocument, operationName?: string | null): readonly string[] {
  const fragments = new Map<string, DefinitionNode>()
  for (const definition of document.definitions) {
    if (definition.kind === "FragmentDefinition" && definition.name) {
      fragments.set(definition.name.value, definition)
    }
  }

  const operations = document.definitions.filter((definition) => definition.kind === "OperationDefinition")
  const operation = operationName
    ? operations.find((candidate) => candidate.name?.value === operationName)
    : operations[0]
  if (!operation?.selectionSet) return []

  const names = new Set<string>()
  const seenFragments = new Set<string>()
  const collect = (selectionSet: SelectionSetNode): void => {
    for (const selection of selectionSet.selections) {
      if (selection.kind === "Field") {
        names.add(selection.name.value)
        continue
      }
      if (selection.kind === "InlineFragment") {
        collect(selection.selectionSet)
        continue
      }
      const fragment = fragments.get(selection.name.value)
      if (fragment?.selectionSet && !seenFragments.has(selection.name.value)) {
        seenFragments.add(selection.name.value)
        collect(fragment.selectionSet)
      }
    }
  }
  collect(operation.selectionSet)

  return [...names]
}

export function createRateLimitPlugin(options: { forwardedByBff?: () => boolean } = {}): Plugin {
  const forwardedByBff = options.forwardedByBff ?? isForwardedByBff

  return {
    async onExecute({ args }) {
      const context = args.contextValue as unknown as RateLimitedContext | undefined
      if (!context?.rateLimiter) return

      const address = resolveRateLimitAddress(context.requestMeta?.ip, forwardedByBff())
      if (address.kind === "internal") return

      const document = args.document as unknown as QueryDocument
      for (const field of rootFieldNames(document, args.operationName)) {
        for (const rule of middlewareRulesForField(field)) {
          await context.rateLimiter.enforce(rule.bucket, address.key, {
            requestId: context.requestId,
            ip: address.kind === "client" ? address.key : null
          })
        }
      }
    }
  }
}

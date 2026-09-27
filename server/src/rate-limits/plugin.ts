import type { Plugin } from "graphql-yoga"
import { isForwardedByBff } from "../observability/request-tracing"
import { resolveRateLimitAddress } from "./client-address"
import type { RateLimiter } from "./limiter"
import { middlewareRulesForField, type RateLimitBucket } from "./policy"

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

/**
 * Сколько раз операция вызывает каждое корневое поле, включая раскрытые на верхнем уровне
 * фрагменты. Считается каждое вхождение, а не уникальное имя: под алиасами одно и то же поле
 * исполняется столько раз, сколько раз названо (`a: requestMagicLink b: requestMagicLink` — два
 * письма), и столько же обращений корзины оно обязано израсходовать. Уникальные имена дали бы
 * ровно один счёт на любой документ и сняли бы лимит целиком.
 */
export function rootFieldCounts(document: QueryDocument, operationName?: string | null): ReadonlyMap<string, number> {
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

  const counts = new Map<string, number>()
  if (!operation?.selectionSet) return counts

  // Путь разворота, а не список увиденных фрагментов: один фрагмент, названный дважды, исполняется
  // дважды и считается дважды, а цикл (валидация его отклоняет) не уводит разбор в бесконечность.
  const expanding = new Set<string>()
  const collect = (selectionSet: SelectionSetNode): void => {
    for (const selection of selectionSet.selections) {
      if (selection.kind === "Field") {
        counts.set(selection.name.value, (counts.get(selection.name.value) ?? 0) + 1)
        continue
      }
      if (selection.kind === "InlineFragment") {
        collect(selection.selectionSet)
        continue
      }
      const name = selection.name.value
      const fragment = fragments.get(name)
      if (fragment?.selectionSet && !expanding.has(name)) {
        expanding.add(name)
        collect(fragment.selectionSet)
        expanding.delete(name)
      }
    }
  }
  collect(operation.selectionSet)

  return counts
}

export function createRateLimitPlugin(options: { forwardedByBff?: () => boolean } = {}): Plugin {
  const forwardedByBff = options.forwardedByBff ?? isForwardedByBff

  return {
    async onExecute({ args }) {
      const context = args.contextValue as unknown as RateLimitedContext | undefined
      if (!context?.rateLimiter) return

      const address = resolveRateLimitAddress(context.requestMeta?.ip, forwardedByBff())

      const document = args.document as unknown as QueryDocument
      // Стоимость складывается по корзинам до применения: документ с тысячей алиасов остаётся
      // одним обращением к хранилищу счётчиков, а не тысячей, и считается как тысяча обращений.
      const cost = new Map<RateLimitBucket, number>()
      for (const [field, calls] of rootFieldCounts(document, args.operationName)) {
        for (const rule of middlewareRulesForField(field)) {
          cost.set(rule.bucket, (cost.get(rule.bucket) ?? 0) + calls)
        }
      }

      // Превышение бросает `RATE_LIMITED` и отклоняет весь документ, а не одно его поле.
      for (const [bucket, calls] of cost) {
        await context.rateLimiter.enforce(
          bucket,
          address.key,
          {
            requestId: context.requestId,
            ip: address.kind === "client" ? address.key : null
          },
          calls
        )
      }
    }
  }
}

import type { TypedDocumentNode } from "@graphql-typed-document-node/core"
import { print, type ExecutionResult } from "graphql"

export const useGraphQL = <TResult, TVariables>(
  document: TypedDocumentNode<TResult, TVariables>,
  variables?: TVariables
) => {
  const requestFetch = useRequestFetch()

  return requestFetch<ExecutionResult<TResult>>("/api/graphql", {
    method: "POST",
    body: {
      query: print(document),
      variables
    }
  })
}

import { ref } from "vue"

export type BrokenLinkReportState = "idle" | "sending" | "sent" | "limited" | "failed"

/**
 * Обращение «битая ссылка» со страницы 404 (журнал §20.15, `not-found.md` §4, §7).
 *
 * Операция написана строкой, а не взята из `~/query`: резолвер `createSupportRequest`
 * входит в T-059 вместе со страницей `/contact` (`T-059` §3), поэтому в схеме её ещё нет
 * и codegen такой документ не соберёт. Когда резолвер появится, документ переезжает в
 * `web/app/graphql/operations/` без изменения этого состояния формы.
 */
const CREATE_SUPPORT_REQUEST = `
  mutation CreateBrokenLinkReport($topic: SupportTopic!, $path: String!, $message: String) {
    createSupportRequest(topic: $topic, path: $path, message: $message) {
      ok
    }
  }
`

interface GraphQLEnvelope {
  data?: { createSupportRequest?: { ok?: boolean } | null } | null
  errors?: readonly { extensions?: Readonly<Record<string, unknown>> }[]
}

const codeOf = (envelope: GraphQLEnvelope): string | undefined => {
  const value = envelope.errors?.[0]?.extensions?.code
  return typeof value === "string" ? value : undefined
}

/** Путь без query: чужая ссылка может нести в параметрах персональные данные (§4). */
export const reportablePath = (fullPath: string): string => fullPath.split("?")[0] ?? "/"

export const useBrokenLinkReport = () => {
  const state = ref<BrokenLinkReportState>("idle")

  const send = async (path: string, message: string) => {
    if (state.value === "sending" || state.value === "sent") return

    state.value = "sending"
    try {
      const envelope = await $fetch<GraphQLEnvelope>("/api/graphql", {
        method: "POST",
        body: {
          query: CREATE_SUPPORT_REQUEST,
          variables: {
            topic: "broken_link",
            path: reportablePath(path),
            message: message.trim() ? message.trim() : null
          }
        }
      })

      if (envelope.data?.createSupportRequest?.ok) {
        state.value = "sent"
        return
      }

      state.value = codeOf(envelope) === "RATE_LIMITED" ? "limited" : "failed"
    } catch {
      state.value = "failed"
    }
  }

  return { state, send }
}

import { ref } from "vue"
import { print } from "graphql"
import { CreateBrokenLinkReportDocument } from "~/graphql/generated/graphql"

export type BrokenLinkReportState = "idle" | "sending" | "sent" | "limited" | "failed"

/**
 * Обращение «битая ссылка» со страницы 404 (журнал §20.15, `not-found.md` §4, §7). Мутация —
 * та же, что у `/contact` (T-059): операция `CreateBrokenLinkReport` в
 * `graphql/operations/pages/contact.graphql`. Адреса анонимная кнопка не просит.
 */
const CREATE_SUPPORT_REQUEST = print(CreateBrokenLinkReportDocument)

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

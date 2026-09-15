import { AsyncLocalStorage } from "node:async_hooks"
import { createHmac, randomUUID, timingSafeEqual } from "node:crypto"
import type { Plugin } from "graphql-yoga"
import type { AppLogger } from "./logger"

interface RequestUserSnapshot {
  id: string
  role: string
}

interface RequestTraceState {
  requestId: string
  startedAt: number
  user: RequestUserSnapshot | null
}

interface RequestTracingOptions {
  logger: AppLogger
  now?: () => number
  requestIdFactory?: () => string
  forwardedRequestSecret?: string
}

const requestTraceStorage = new AsyncLocalStorage<RequestTraceState>()
const uuidV4Pattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const sha256HexPattern = /^[0-9a-f]{64}$/i

function hasValidForwardedSignature(requestId: string, signature: string | null, secret: string | undefined): boolean {
  if (!secret || !signature || !sha256HexPattern.test(signature)) return false

  const expected = createHmac("sha256", secret).update(requestId).digest()
  const received = Buffer.from(signature, "hex")
  return received.length === expected.length && timingSafeEqual(received, expected)
}

export function getRequestId(): string {
  return requestTraceStorage.getStore()?.requestId ?? randomUUID()
}

export function setRequestUserSnapshot(user: RequestUserSnapshot | null): void {
  const state = requestTraceStorage.getStore()
  if (state) state.user = user
}

export function createRequestTracingPlugin(options: RequestTracingOptions): Plugin {
  const now = options.now ?? Date.now
  const requestIdFactory = options.requestIdFactory ?? randomUUID

  return {
    instrumentation: {
      request({ request }, wrapped) {
        const forwardedRequestId = request.headers.get("x-request-id")
        const forwardedSignature = request.headers.get("x-request-id-signature")
        const requestId =
          forwardedRequestId &&
          uuidV4Pattern.test(forwardedRequestId) &&
          hasValidForwardedSignature(forwardedRequestId, forwardedSignature, options.forwardedRequestSecret)
            ? forwardedRequestId
            : requestIdFactory()

        return requestTraceStorage.run({ requestId, startedAt: now(), user: null }, wrapped)
      }
    },
    onResponse({ request, response }) {
      const state = requestTraceStorage.getStore()
      if (!state) return

      response.headers.set("x-request-id", state.requestId)
      options.logger.log({
        level: "info",
        event: "http.request",
        requestId: state.requestId,
        message: "HTTP request completed",
        route: new URL(request.url).pathname,
        status: response.status,
        durationMs: Math.max(0, now() - state.startedAt),
        userId: state.user?.id ?? null,
        role: state.user?.role ?? null
      })
    }
  }
}

import type { IncomingMessage, RequestListener, ServerResponse } from "node:http"
import type { PublicAccessResolver } from "./access"
import { isStorageKey } from "./keys"
import type { LocalStorage } from "./local"

// Раздача `/media/<key>` для локальной реализации — модель поведения CDN в разработке и CI
// (`access-and-signed-urls.md` п. 1–3): с верной подписью — любой объект; без подписи — только
// публичный вариант; закрытое — 404, чтобы не раскрывать существование; плохая подпись — 403.
// Query-строка с подписью не логируется (п. 7): этот обработчик ничего не пишет в логи.

const PREFIX = "/media/"

function reply(response: ServerResponse, status: number, text: string): void {
  response.statusCode = status
  response.setHeader("content-type", "text/plain; charset=utf-8")
  response.setHeader("cache-control", "no-store")
  response.end(text)
}

async function serve(
  request: IncomingMessage,
  response: ServerResponse,
  storage: LocalStorage,
  key: string,
  cacheControl: string
): Promise<void> {
  const object = await storage.get(key)
  if (!object) return reply(response, 404, "Not Found")
  response.statusCode = 200
  response.setHeader("content-type", object.contentType)
  response.setHeader("content-length", object.body.length)
  response.setHeader("cache-control", cacheControl)
  response.setHeader("x-content-type-options", "nosniff")
  response.end(request.method === "HEAD" ? undefined : object.body)
}

export async function handleMediaRequest(
  request: IncomingMessage,
  response: ServerResponse,
  options: { storage: LocalStorage; resolvePublicAccess: PublicAccessResolver; now?: () => Date }
): Promise<void> {
  const url = new URL(request.url ?? "/", "http://media.local")
  let key: string
  try {
    key = decodeURIComponent(url.pathname.slice(PREFIX.length))
  } catch {
    return reply(response, 404, "Not Found")
  }
  if (!isStorageKey(key)) return reply(response, 404, "Not Found")

  try {
    const expires = url.searchParams.get("expires")
    const signature = url.searchParams.get("signature")
    if (expires !== null || signature !== null) {
      const check = options.storage.verifySignature(key, expires, signature, options.now?.())
      if (check !== "valid") return reply(response, 403, "Forbidden")
      return await serve(request, response, options.storage, key, "private, no-store")
    }
    // Публичный вариант перепроверяется при каждом запросе: архив закрывает его сразу (п. 3).
    if ((await options.resolvePublicAccess(key)) !== "public") return reply(response, 404, "Not Found")
    return await serve(request, response, options.storage, key, "public, no-cache")
  } catch {
    if (!response.headersSent) reply(response, 503, "Service Unavailable")
  }
}

export const withMedia =
  (
    fallback: RequestListener,
    options: { storage: LocalStorage; resolvePublicAccess: PublicAccessResolver }
  ): RequestListener =>
  (request, response) => {
    const path = request.url?.split("?", 1)[0] ?? ""
    if ((request.method !== "GET" && request.method !== "HEAD") || !path.startsWith(PREFIX)) {
      fallback(request, response)
      return
    }
    void handleMediaRequest(request, response, options)
  }

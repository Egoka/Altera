import { randomUUID } from "node:crypto"

export default defineEventHandler((event) => {
  const requestId = randomUUID()
  event.context.requestId = requestId
  setResponseHeader(event, "x-request-id", requestId)
})

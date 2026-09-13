// Доверенный HTTPS CONNECT proxy: только точные домены и публичные IPv4.
// У proxy нет checkout, credentials, Docker socket или host RPC.
import dns from "node:dns/promises"
import http from "node:http"
import net from "node:net"
import { pathToFileURL } from "node:url"

const allowed = new Set([
  "api.openai.com",
  "chatgpt.com",
  "auth.openai.com",
  "api.anthropic.com",
  "claude.ai",
  "console.anthropic.com",
  "platform.claude.com"
])

export function authority(value) {
  const match = /^([a-z0-9.-]+):443$/.exec(value)
  if (!match || !allowed.has(match[1])) throw new Error("destination_denied")
  return match[1]
}

export function publicAddress(value) {
  if (net.isIP(value) !== 4) return false
  const [a, b, c] = value.split(".").map(Number)
  return !(
    a === 0 ||
    a === 10 ||
    a === 127 ||
    a >= 224 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 192 && b === 0 && (c === 0 || c === 2)) ||
    (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) ||
    (a === 203 && b === 0 && c === 113)
  )
}

export function serve() {
  const server = http.createServer((_request, response) => {
    response.writeHead(405)
    response.end()
  })
  server.on("connect", async (request, client, head) => {
    client.on("error", () => {})
    client.setTimeout(60000, () => client.destroy())
    try {
      const hostname = authority(request.url)
      const answers = await dns.lookup(hostname, { all: true, family: 4 })
      if (!answers.length || answers.some(({ address }) => !publicAddress(address))) {
        throw new Error("nonpublic_dns")
      }
      // Подключение к уже проверенному IP исключает повторное DNS разрешение.
      const upstream = net.connect({ host: answers[0].address, port: 443 })
      upstream.setTimeout(60000, () => upstream.destroy())
      upstream.on("error", () => client.destroy())
      client.on("close", () => upstream.destroy())
      upstream.on("connect", () => {
        client.write("HTTP/1.1 200 Connection Established\r\n\r\n")
        if (head.length) upstream.write(head)
        client.pipe(upstream)
        upstream.pipe(client)
      })
    } catch {
      client.end("HTTP/1.1 403 Forbidden\r\nContent-Length: 0\r\n\r\n")
    }
  })
  server.listen(8080, "0.0.0.0", () => process.stdout.write("PROXY_READY\n"))
  return server
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) serve()

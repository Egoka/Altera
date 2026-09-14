import { execFileSync, spawn, spawnSync } from "node:child_process"
import { once } from "node:events"
import { describe, expect, it } from "vitest"

describe("production smoke script", () => {
  it("fails before launch when the requested port is already serving HTTP", async () => {
    const server = spawn(
      process.execPath,
      [
        "-e",
        "const http=require('node:http');const server=http.createServer((_req,res)=>res.end('unrelated server'));server.listen(0,'127.0.0.1',()=>console.log(server.address().port))"
      ],
      { stdio: ["ignore", "pipe", "inherit"] }
    )

    try {
      const port = await new Promise<string>((resolve, reject) => {
        server.once("error", reject)
        server.stdout.once("data", (chunk: Buffer) => resolve(chunk.toString().trim()))
      })

      const result = spawnSync("bash", ["scripts/smoke.sh"], {
        cwd: process.cwd(),
        encoding: "utf8",
        env: { ...process.env, PORT: port }
      })

      expect(result.status).toBe(1)
      expect(result.stdout).toContain(`порт ${port} уже занят`)
      expect(execFileSync("curl", ["-sS", `http://127.0.0.1:${port}`], { encoding: "utf8" })).toBe("unrelated server")
    } finally {
      server.kill()
      await once(server, "exit")
    }
  })
})

// Synthetic OS-denial probe: успешная запрещённая мутация проваливает проверку.
import fs from "node:fs"
import path from "node:path"

const results = []
for (const base of [process.cwd(), path.join(process.cwd(), ".git"), "/runtime/policy"]) {
  for (const [operation, action] of [
    ["create", () => fs.writeFileSync(path.join(base, "created"), "mutation")],
    ["overwrite", () => fs.writeFileSync(path.join(base, "canary"), "mutation")],
    ["delete", () => fs.unlinkSync(path.join(base, "delete-canary"))],
    ["rename", () => fs.renameSync(path.join(base, "rename-canary"), path.join(base, "renamed"))],
    ["symlink", () => fs.symlinkSync("canary", path.join(base, "new-link"))],
    ["alternate-path", () => fs.writeFileSync(path.join(base, "alias"), "mutation")]
  ]) {
    try {
      action()
      results.push({ base, operation, denied: false })
    } catch (error) {
      results.push({ base, operation, denied: ["EROFS", "EACCES", "EPERM"].includes(error.code), errno: error.code })
    }
  }
}
fs.writeFileSync("/runtime/evidence/new-evidence.json", JSON.stringify(results, null, 2))
const privatePaths = ["/var/run/docker.sock", "/run/docker.sock", path.join(process.cwd(), ".env")]
const privatePathsAbsent = privatePaths.every((item) => !fs.existsSync(item))
const tokenAbsent = process.env.MULTICA_TOKEN === undefined
const report = { results, evidenceWritten: true, privatePathsAbsent, tokenAbsent }
process.stdout.write(JSON.stringify(report) + "\n")
process.exit(results.every((item) => item.denied) && privatePathsAbsent && tokenAbsent ? 0 : 41)

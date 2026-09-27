// Проверка типов веба: каждый проект из `references` в `tsconfig.json` проверяется отдельным
// `vue-tsc --noEmit -p`, после чего печатается сводка по всем проектам.
//
// Раньше здесь был `vue-tsc -b --noEmit`. Он проверяет те же проекты, но печатает их ошибки одним
// потоком без указания проекта, и последней идёт ошибка node-проекта (`nuxt.config.ts`): в конце
// вывода по нему не видно, что проект app тоже упал. Кроме того, `-b` пишет tsbuildinfo в `.nuxt`
// и по его состоянию решает, какие проекты пересобирать. Здесь каждый проект проверяется заново,
// ошибка одного не останавливает остальные, а сводка по всем проектам печатается последней.
import { spawnSync } from "node:child_process"
import { createRequire } from "node:module"
import path from "node:path"
import { fileURLToPath } from "node:url"

const vueTsc = createRequire(import.meta.url).resolve("vue-tsc/bin/vue-tsc.js")
// У web нет своей зависимости на typescript: берётся тот же пакет, с которым работает vue-tsc.
const ts = createRequire(vueTsc)("typescript")
const webDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")

// `tsconfig.json` содержит комментарии, поэтому читается парсером TypeScript, а не `JSON.parse`.
const { config, error } = ts.readConfigFile(path.join(webDir, "tsconfig.json"), ts.sys.readFile)
if (error) {
  console.error(`✗ tsconfig.json не прочитан: ${ts.flattenDiagnosticMessageText(error.messageText, "\n")}`)
  process.exit(1)
}

const projects = (config.references ?? []).map((reference) => reference.path)
if (projects.length === 0) {
  console.error("✗ в tsconfig.json нет references — проверять нечего")
  process.exit(1)
}

const results = projects.map((project) => {
  console.log(`→ vue-tsc --noEmit -p ${project}`)
  const run = spawnSync(process.execPath, [vueTsc, "--noEmit", "--pretty", "false", "-p", project], {
    cwd: webDir,
    encoding: "utf8"
  })
  const output = `${run.stdout ?? ""}${run.stderr ?? ""}`
  process.stdout.write(output)
  if (run.error) {
    console.error(run.error.message)
  }
  // Каждая диагностика в режиме `--pretty false` начинается со строки с `error TS<код>`;
  // строки пояснений идут с отступом и кода не содержат.
  const errors = output.match(/error TS\d+/g)?.length ?? 0
  return { project, status: run.status, errors }
})

console.log("\nСводка typecheck:")
for (const { project, status, errors } of results) {
  const mark = status === 0 ? "✓" : "✗"
  console.log(`${mark} ${project}: exit ${status ?? "—"}, ошибок ${errors}`)
}

process.exit(results.every(({ status }) => status === 0) ? 0 : 1)

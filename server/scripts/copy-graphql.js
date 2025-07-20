const fs = require("fs")
const path = require("path")

const srcDir = path.resolve("src/graphql")
const destDir = path.resolve("dist/graphql")

function copyGraphQLFiles(src, dest) {
  if (!fs.existsSync(dest)) fs.mkdirSync(dest, { recursive: true })

  for (const item of fs.readdirSync(src)) {
    const srcPath = path.join(src, item)
    const destPath = path.join(dest, item)

    if (fs.statSync(srcPath).isDirectory()) {
      copyGraphQLFiles(srcPath, destPath)
    } else if (item.endsWith(".graphql")) {
      fs.copyFileSync(srcPath, destPath)
    }
  }
}

copyGraphQLFiles(srcDir, destDir)

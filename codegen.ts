import type { CodegenConfig } from "@graphql-codegen/cli"

const config: CodegenConfig = {
  schema: "server/src/graphql/**/*.graphql",
  documents: "web/app/graphql/**/*.graphql",
  ignoreNoDocuments: true,
  generates: {
    "web/app/graphql/generated/": {
      preset: "client",
      presetConfig: {
        fragmentMasking: false
      },
      config: {
        enumsAsTypes: true,
        useTypeImports: true,
        defaultScalarType: "unknown",
        scalars: {
          JSON: {
            input: "unknown",
            output: "unknown"
          }
        }
      }
    }
  }
}

export default config

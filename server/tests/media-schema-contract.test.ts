import path from "node:path"
import { loadFilesSync } from "@graphql-tools/load-files"
import { mergeTypeDefs } from "@graphql-tools/merge"
import { buildASTSchema, parse, validate } from "graphql"
import { createSchema, createYoga } from "graphql-yoga"
import { describe, expect, it, vi } from "vitest"
import mediaResolver from "../src/graphql/media/resolver"
import type { MediaAssetRecord, MediaService } from "../src/media"
import type { GraphQLContext } from "../src/prisma"
import { createTestRateLimiter } from "./helpers/rate-limit"

// Контракт точки входа: подпись `uploadMedia` совпадает со спецификацией
// (`30-account/author/article-edit.md` §4), а скалярный тип `File` принимает настоящий файл
// multipart-запроса — тот же путь, которым его передаёт Yoga.

const graphqlRoot = path.resolve(__dirname, "../src/graphql")

const mergedSchema = buildASTSchema(mergeTypeDefs(loadFilesSync(graphqlRoot, { extensions: ["graphql"] })))

const UPLOAD_MEDIA = /* GraphQL */ `
  mutation UploadMedia($translationId: ID!, $file: File!, $license: MediaLicense!, $attribution: String!) {
    uploadMedia(translationId: $translationId, file: $file, license: $license, attribution: $attribution) {
      id
      processingStatus
      mimeType
      byteSize
      width
      height
      alt
      attribution
      license
      variants
      createdAt
    }
  }
`

const asset: MediaAssetRecord = {
  id: "asset-1",
  ownerId: "author-1",
  processingStatus: "queued",
  storageKey: "quarantine/00000000-0000-4000-8000-000000000001.upload",
  mimeType: "image/jpeg",
  byteSize: 7,
  width: null,
  height: null,
  sha256: "checksum",
  attribution: "Иван Петров",
  license: "own",
  licenseNote: null,
  alt: null,
  caption: null,
  variants: [],
  deletedAt: null,
  createdAt: new Date("2026-09-28T10:00:00.000Z")
}

describe("T-063 контракт uploadMedia", () => {
  it("операция подписи спецификации проходит валидацию против собранной схемы", () => {
    expect(validate(mergedSchema, parse(UPLOAD_MEDIA)).map((error) => error.message)).toEqual([])
  })

  it("схема не принимает `alt` аргументом: его создаёт конвейер", () => {
    const withAlt = /* GraphQL */ `
      mutation {
        uploadMedia(translationId: "t", file: null, license: own, attribution: "a", alt: "описание") {
          id
        }
      }
    `
    expect(validate(mergedSchema, parse(withAlt)).map((error) => error.message)).toContain(
      'Unknown argument "alt" on field "Mutation.uploadMedia".'
    )
  })

  it("скаляр File принимает файл multipart-запроса и отдаёт его байты конвейеру", async () => {
    // Сборка и исполнение те же, что в процессе API: `createSchema` и `createYoga` из graphql-yoga,
    // а запрос — настоящий multipart по спецификации загрузки файлов GraphQL.
    const bytes = Buffer.from("jpeg-ok")
    const upload = vi.fn(async () => asset)
    const context = {
      currentUser: {
        id: "author-1",
        role: "author",
        archivedAt: null,
        planTier: "standard",
        planUntil: null,
        permissionExceptions: []
      },
      requestId: "req-contract",
      requestMeta: { ip: null, userAgent: null },
      logger: { log: vi.fn(), metric: vi.fn() },
      rateLimiter: createTestRateLimiter(),
      media: {
        uploadEnabled: true,
        translations: {
          findTranslationOwner: async () => ({
            translationId: "translation-1",
            authorId: "author-1",
            isEditorial: false
          })
        },
        upload
      } as unknown as MediaService
    } as unknown as GraphQLContext

    const yoga = createYoga<GraphQLContext>({
      schema: createSchema<GraphQLContext>({
        typeDefs: mergeTypeDefs([
          "scalar JSON\ntype Query { _empty: String }\ntype Mutation { _empty: String }",
          loadFilesSync(path.join(graphqlRoot, "media"), { extensions: ["graphql"] })
        ]),
        resolvers: mediaResolver
      }),
      context: () => context,
      logging: false,
      graphqlEndpoint: "/"
    })

    const form = new FormData()
    form.append(
      "operations",
      JSON.stringify({
        query: UPLOAD_MEDIA,
        variables: { translationId: "translation-1", file: null, license: "own", attribution: "Иван Петров" }
      })
    )
    form.append("map", JSON.stringify({ "0": ["variables.file"] }))
    form.append("0", new File([bytes], "photo.jpg", { type: "image/jpeg" }))

    const response = await yoga.fetch("http://media.local/", { method: "POST", body: form })
    const payload = (await response.json()) as { data?: { uploadMedia?: Record<string, unknown> }; errors?: unknown }

    expect(payload.errors).toBeUndefined()
    expect(payload.data?.uploadMedia).toMatchObject({
      id: "asset-1",
      processingStatus: "queued",
      mimeType: "image/jpeg",
      byteSize: 7,
      alt: null,
      license: "own",
      createdAt: "2026-09-28T10:00:00.000Z"
    })
    // Конвейер получает именно байты файла, а не его имя и не объявленный тип.
    const source = upload.mock.calls[0][0].file
    expect(source.size).toBe(bytes.length)
    await expect(source.bytes()).resolves.toEqual(bytes)
  })
})

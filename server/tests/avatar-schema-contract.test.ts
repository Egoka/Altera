import path from "node:path"
import { loadFilesSync } from "@graphql-tools/load-files"
import { mergeTypeDefs } from "@graphql-tools/merge"
import { buildASTSchema, parse, validate } from "graphql"
import { describe, expect, it } from "vitest"

// Контракт точек входа аватара: подписи спецификации (`30-account/reader/profile-edit.md` §4,
// `85-media-and-binary/upload-pipeline.md` п. 1) проходят валидацию против собранной схемы.

const mergedSchema = buildASTSchema(
  mergeTypeDefs(loadFilesSync(path.resolve(__dirname, "../src/graphql"), { extensions: ["graphql"] }))
)

const errorsOf = (document: string) => validate(mergedSchema, parse(document)).map((error) => error.message)

describe("T-065 контракт мутаций аватара", () => {
  it("подпись `uploadAvatar(file)` спецификации валидна и без кадра", () => {
    expect(
      errorsOf(/* GraphQL */ `
        mutation UploadAvatar($file: File!) {
          uploadAvatar(file: $file) {
            assetId
            url
            variants
          }
        }
      `)
    ).toEqual([])
  })

  it("кадр передаётся отдельным аргументом", () => {
    expect(
      errorsOf(/* GraphQL */ `
        mutation UploadCroppedAvatar($file: File!, $crop: AvatarCropInput) {
          uploadAvatar(file: $file, crop: $crop) {
            assetId
            url
          }
        }
      `)
    ).toEqual([])
  })

  it("`removeAvatar` ответа не требует, `revertAvatar` принимает аккаунт и причину", () => {
    expect(
      errorsOf(/* GraphQL */ `
        mutation ManageAvatar($userId: ID!, $reason: String) {
          removeAvatar {
            assetId
          }
          revertAvatar(userId: $userId, reason: $reason) {
            assetId
            url
          }
        }
      `)
    ).toEqual([])
  })

  it("свой аватар и предыдущая версия читаются через `me`", () => {
    expect(
      errorsOf(/* GraphQL */ `
        query MyAvatar {
          me {
            avatar {
              assetId
              url
              variants
            }
            previousAvatar {
              assetId
            }
          }
        }
      `)
    ).toEqual([])
  })

  it("публичный профиль аватара наружу отдаёт только адрес — без записи медиа", () => {
    expect(
      errorsOf(/* GraphQL */ `
        query PublicAuthor($handle: String!) {
          author(handle: $handle) {
            avatar
          }
        }
      `)
    ).toEqual([])
    expect(
      errorsOf(/* GraphQL */ `
        query PublicAuthorAsset($handle: String!) {
          author(handle: $handle) {
            avatar {
              assetId
            }
          }
        }
      `)
    ).not.toEqual([])
  })
})

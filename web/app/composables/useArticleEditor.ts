import { print } from "graphql"
import type { ContentDocument } from "@altera/content"
import {
  GetAuthoringTaxonomyDocument,
  GetEditorMediaAssetDocument,
  GetEditorTranslationDocument,
  GetTranslationRevisionsDocument,
  RestoreTranslationRevisionDocument,
  SaveTranslationDocument,
  SetEditorArticleCoverDocument,
  SetTranslationSlugDocument,
  SetTranslationTaxonomyDocument,
  SubmitTranslationDocument,
  UploadEditorMediaDocument,
  WithdrawTranslationDocument,
  type GetAuthoringTaxonomyQuery,
  type GetEditorTranslationQuery,
  type GetTranslationRevisionsQuery,
  type MediaLicense
} from "~/graphql/generated/graphql"
import {
  conflictRevisionId,
  documentBlocks,
  emptyBody,
  errorCodeOf,
  isReadOnly,
  missingForSubmit,
  primaryAction,
  saveErrorKey,
  withAppendedParagraph,
  withBlockText,
  withoutBlock,
  type EditorReadOnlyReason
} from "~/utils/articleEditor"

/**
 * Обвязка редактора версии (`docs/spec/30-account/author/article-edit.md`).
 *
 * Автосохранение идёт каждые 10 с при изменениях (§4 `[ДОПУЩЕНИЕ]`), ручное — снимком по кнопке.
 * Базовая ревизия сверяется сервером: устаревшая отвечает `CONFLICT`, и редактор предлагает
 * открыть свежую версию или сохранить свой текст копией (ADR-0033).
 */

/** Период автосохранения (`article-edit.md` §4 `[ДОПУЩЕНИЕ]`). */
export const AUTOSAVE_INTERVAL_MS = 10_000
/** Опрос обработки загруженного файла (§4 `[ДОПУЩЕНИЕ]`: задание опрашивается раз в 3 с). */
export const MEDIA_POLL_INTERVAL_MS = 3_000
const MEDIA_POLL_ATTEMPTS = 40

export type EditorTranslation = NonNullable<GetEditorTranslationQuery["translation"]>
export type EditorTaxonomy = GetAuthoringTaxonomyQuery["authoringTaxonomy"]
export type EditorRevision = GetTranslationRevisionsQuery["revisions"]["items"][number]

export type SaveState = "idle" | "saving" | "saved" | "error" | "conflict"

export interface EditorForm {
  title: string
  lead: string
  body: ContentDocument
  seoDescription: string
}

interface Envelope<T> {
  data?: T | null
  errors?: readonly { message?: string; extensions?: Record<string, unknown> | null }[]
}

const formOf = (translation: EditorTranslation): EditorForm => ({
  title: translation.title,
  lead: translation.lead ?? "",
  body: (translation.body as ContentDocument | null) ?? emptyBody(),
  seoDescription: translation.seo.description ?? ""
})

export const useArticleEditor = (translationId: string) => {
  // Версия, справочник и форма читаются на сервере и переносятся в браузер снимком состояния:
  // без этого страница после гидратации осталась бы пустой, а 404 и 500 не были бы ответом
  // навигации (`article-edit.md` §8, строки «Не найдено» и «Ошибка данных»).
  const translation = useState<EditorTranslation | null>(`editor:${translationId}:translation`, () => null)
  const taxonomy = useState<EditorTaxonomy>("editor:taxonomy", () => ({ sections: [], formats: [] }))
  const form = useState<EditorForm>(`editor:${translationId}:form`, () => ({
    title: "",
    lead: "",
    body: emptyBody(),
    seoDescription: ""
  }))

  const baseRevisionId = useState(`editor:${translationId}:base`, () => "")
  const dirty = ref(false)
  const saveState = ref<SaveState>("idle")
  const saveErrorKeyRef = ref<string | null>(null)
  const savedAt = ref<string | null>(null)
  /** Свежая ревизия из отказа `CONFLICT`: по ней решается, чем закончить правку двух вкладок. */
  const conflictRevision = ref<string | null>(null)
  const offline = ref(false)
  const revisions = ref<EditorRevision[]>([])
  const coverBusy = ref(false)
  const coverErrorKey = ref<string | null>(null)

  const readOnlyReason = computed<EditorReadOnlyReason>(
    () => (translation.value?.readOnlyReason as EditorReadOnlyReason | undefined) ?? "none"
  )
  const readOnly = computed(() => isReadOnly(readOnlyReason.value))
  const blocks = computed(() => documentBlocks(form.value.body))
  const missing = computed(() =>
    missingForSubmit({
      title: form.value.title,
      body: form.value.body,
      sectionId: translation.value?.article.section?.id ?? null,
      coverAssetId: translation.value?.article.cover?.assetId ?? null
    })
  )
  const canSubmit = computed(() => !readOnly.value && missing.value.length === 0 && saveState.value !== "saving")
  const action = computed(() => primaryAction(translation.value?.status ?? "draft", readOnlyReason.value))

  const apply = (next: EditorTranslation) => {
    translation.value = next
    form.value = formOf(next)
    baseRevisionId.value = next.currentRevisionId
    dirty.value = false
    conflictRevision.value = null
    saveState.value = "idle"
    saveErrorKeyRef.value = null
  }

  /**
   * Чтение версии. Переход страница делает сама: `navigateTo` из обработчика `useAsyncData`
   * ответом навигации не становится, поэтому загрузчик только называет адрес.
   */
  const load = async (): Promise<{ redirect: string | null }> => {
    const response = (await useGraphQL(GetEditorTranslationDocument, {
      id: translationId
    })) as Envelope<GetEditorTranslationQuery>
    const found = response.data?.translation
    if (!found) {
      const code = errorCodeOf(response.errors)
      if (code === "UNAUTHENTICATED") {
        return { redirect: `/login?next=${encodeURIComponent(`/me/articles/${translationId}/edit`)}` }
      }
      // Ограниченная сессия снятого аккаунта уходит на своё состояние (§8 «Заблокирован»).
      if (code === "FORBIDDEN") return { redirect: "/me/archived" }
      // Чужая и неизвестная версия отвечают одинаково: страница «не найдено» (§3, §8).
      throw createError({
        statusCode: code === "NOT_FOUND" ? 404 : 500,
        statusMessage: "Translation is unavailable",
        fatal: true
      })
    }
    apply(found)
    return { redirect: null }
  }

  const loadTaxonomy = async () => {
    const response = (await useGraphQL(GetAuthoringTaxonomyDocument)) as Envelope<GetAuthoringTaxonomyQuery>
    if (response.data?.authoringTaxonomy) taxonomy.value = response.data.authoringTaxonomy
  }

  const loadRevisions = async () => {
    const response = (await useGraphQL(GetTranslationRevisionsDocument, {
      translationId,
      limit: 20
    })) as Envelope<GetTranslationRevisionsQuery>
    revisions.value = response.data?.revisions.items ?? []
  }

  const save = async (kind: "autosave" | "manual") => {
    if (readOnly.value || saveState.value === "saving") return
    saveState.value = "saving"
    saveErrorKeyRef.value = null

    let response: Envelope<{ saveTranslation: { revisionId: string; savedAt: string } }>
    try {
      response = (await useGraphQL(SaveTranslationDocument, {
        id: translationId,
        baseRevisionId: baseRevisionId.value,
        patch: {
          title: form.value.title,
          lead: form.value.lead,
          body: form.value.body,
          seoDescription: form.value.seoDescription
        },
        kind
      })) as Envelope<{ saveTranslation: { revisionId: string; savedAt: string } }>
    } catch {
      // Сети нет: текст остаётся в форме, следующий тик попробует снова (`offline.md`).
      offline.value = true
      saveState.value = "error"
      saveErrorKeyRef.value = "offline"
      return
    }

    offline.value = false
    const saved = response.data?.saveTranslation
    if (!saved) {
      const conflict = conflictRevisionId(response.errors)
      if (conflict) {
        conflictRevision.value = conflict
        saveState.value = "conflict"
        return
      }
      saveState.value = "error"
      saveErrorKeyRef.value = saveErrorKey(response.errors)
      return
    }

    baseRevisionId.value = saved.revisionId
    savedAt.value = saved.savedAt
    dirty.value = false
    saveState.value = "saved"
  }

  /** «Открыть свежую»: правка другой вкладки становится текущей, своя — теряется осознанно. */
  const reloadFresh = async () => {
    conflictRevision.value = null
    await load()
  }

  /** «Сохранить копию как ревизию»: свой текст ложится снимком поверх свежей базовой ревизии. */
  const saveAsCopy = async () => {
    const fresh = conflictRevision.value
    if (!fresh) return
    baseRevisionId.value = fresh
    conflictRevision.value = null
    await save("manual")
  }

  const submit = async () => {
    if (dirty.value) await save("manual")
    if (saveState.value === "conflict" || saveState.value === "error") return

    const response = (await useGraphQL(SubmitTranslationDocument, { id: translationId })) as Envelope<{
      submitTranslation: EditorTranslation
    }>
    const next = response.data?.submitTranslation
    if (!next) {
      saveState.value = "error"
      saveErrorKeyRef.value = saveErrorKey(response.errors)
      return
    }
    apply(next)
  }

  const withdraw = async () => {
    const response = (await useGraphQL(WithdrawTranslationDocument, { id: translationId })) as Envelope<{
      withdrawTranslation: EditorTranslation
    }>
    const next = response.data?.withdrawTranslation
    if (!next) {
      saveState.value = "error"
      saveErrorKeyRef.value = saveErrorKey(response.errors)
      return
    }
    apply(next)
  }

  const saveTaxonomy = async (next: { sectionId: string | null; formatId: string | null; tagIds: string[] }) => {
    const articleId = translation.value?.article.id
    if (!articleId || readOnly.value) return
    const response = (await useGraphQL(SetTranslationTaxonomyDocument, { articleId, ...next })) as Envelope<{
      setTaxonomy: { section: unknown; format: unknown; tags: unknown[] }
    }>
    const updated = response.data?.setTaxonomy
    if (!updated || !translation.value) {
      saveErrorKeyRef.value = saveErrorKey(response.errors)
      return
    }
    translation.value = {
      ...translation.value,
      article: {
        ...translation.value.article,
        section: updated.section as EditorTranslation["article"]["section"],
        format: updated.format as EditorTranslation["article"]["format"],
        tags: updated.tags as EditorTranslation["article"]["tags"]
      }
    }
  }

  const saveSlug = async (slug: string) => {
    const response = (await useGraphQL(SetTranslationSlugDocument, { translationId, slug })) as Envelope<{
      setSlug: EditorTranslation["seo"]
    }>
    const updated = response.data?.setSlug
    if (!updated || !translation.value) {
      saveErrorKeyRef.value = saveErrorKey(response.errors)
      return
    }
    translation.value = { ...translation.value, seo: updated }
  }

  const restore = async (revisionId: string) => {
    const response = (await useGraphQL(RestoreTranslationRevisionDocument, { translationId, revisionId })) as Envelope<{
      restoreRevision: { revisionId: string }
    }>
    if (!response.data?.restoreRevision) {
      saveErrorKeyRef.value = saveErrorKey(response.errors)
      return
    }
    await load()
    await loadRevisions()
  }

  /**
   * Загрузка обложки. Файл уходит multipart-запросом GraphQL: `useGraphQL` шлёт JSON, поэтому
   * конверт собирается здесь, а BFF пропускает его к API без разбора.
   */
  const uploadCover = async (file: File, license: MediaLicense, attribution: string) => {
    if (readOnly.value) return
    coverBusy.value = true
    coverErrorKey.value = null
    try {
      const envelope = new FormData()
      envelope.append(
        "operations",
        JSON.stringify({
          query: print(UploadEditorMediaDocument),
          variables: { translationId, file: null, license, attribution }
        })
      )
      envelope.append("map", JSON.stringify({ "0": ["variables.file"] }))
      envelope.append("0", file)

      const uploaded = await $fetch<Envelope<{ uploadMedia: { id: string; processingStatus: string } }>>(
        "/api/graphql",
        { method: "POST", body: envelope }
      )
      const asset = uploaded.data?.uploadMedia
      if (!asset) {
        coverErrorKey.value = saveErrorKey(uploaded.errors)
        return
      }

      const ready = await waitForMedia(asset.id, asset.processingStatus)
      if (!ready) {
        coverErrorKey.value = "coverProcessing"
        return
      }
      await setCover(asset.id, null)
    } catch {
      coverErrorKey.value = "offline"
    } finally {
      coverBusy.value = false
    }
  }

  /** Конвейер доводит файл до готовой записи заданием очереди (`upload-pipeline.md` п. 4). */
  const waitForMedia = async (assetId: string, initial: string): Promise<boolean> => {
    let status = initial
    for (let attempt = 0; attempt < MEDIA_POLL_ATTEMPTS && status !== "ready" && status !== "failed"; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, MEDIA_POLL_INTERVAL_MS))
      const response = (await useGraphQL(GetEditorMediaAssetDocument, { assetId })) as Envelope<{
        mediaAsset: { processingStatus: string } | null
      }>
      status = response.data?.mediaAsset?.processingStatus ?? status
    }
    return status === "ready"
  }

  const setCover = async (assetId: string | null, focal: { x: number; y: number } | null) => {
    const articleId = translation.value?.article.id
    if (!articleId || !translation.value) return
    const response = (await useGraphQL(SetEditorArticleCoverDocument, { articleId, assetId, focal })) as Envelope<{
      setArticleCover: EditorTranslation["article"]["cover"]
    }>
    if (response.errors?.length) {
      coverErrorKey.value = saveErrorKey(response.errors)
      return
    }
    translation.value = {
      ...translation.value,
      article: { ...translation.value.article, cover: response.data?.setArticleCover ?? null }
    }
  }

  const touch = () => {
    dirty.value = true
    if (saveState.value === "saved" || saveState.value === "error") saveState.value = "idle"
  }

  const setBlockText = (id: string, text: string) => {
    form.value = { ...form.value, body: withBlockText(form.value.body, id, text) }
    touch()
  }
  const addBlock = () => {
    form.value = { ...form.value, body: withAppendedParagraph(form.value.body) }
    touch()
  }
  const removeBlock = (id: string) => {
    form.value = { ...form.value, body: withoutBlock(form.value.body, id) }
    touch()
  }

  let timer: ReturnType<typeof setInterval> | null = null
  const startAutosave = () => {
    if (timer || import.meta.server) return
    timer = setInterval(() => {
      if (dirty.value && !readOnly.value) void save("autosave")
    }, AUTOSAVE_INTERVAL_MS)
  }
  const stopAutosave = () => {
    if (!timer) return
    clearInterval(timer)
    timer = null
  }

  return {
    translation,
    taxonomy,
    form,
    blocks,
    revisions,
    baseRevisionId,
    dirty,
    saveState,
    saveErrorKey: saveErrorKeyRef,
    savedAt,
    conflictRevision,
    offline,
    coverBusy,
    coverErrorKey,
    readOnlyReason,
    readOnly,
    missing,
    canSubmit,
    action,
    load,
    loadTaxonomy,
    loadRevisions,
    save,
    reloadFresh,
    saveAsCopy,
    submit,
    withdraw,
    saveTaxonomy,
    saveSlug,
    restore,
    uploadCover,
    setCover,
    touch,
    setBlockText,
    addBlock,
    removeBlock,
    startAutosave,
    stopAutosave
  }
}

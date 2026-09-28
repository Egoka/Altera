<script setup lang="ts">
  import type { MediaLicense } from "~/graphql/generated/graphql"

  /**
   * Обложка материала (`docs/spec/85-media-and-binary/article-covers.md`, `article-edit.md` §6).
   *
   * Обложка обязательна перед публикацией и индивидуальна (журнал §29.1). Лицензия и атрибуция
   * обязательны при загрузке (ADR-0008); `alt` автор не задаёт — его создаёт конвейер
   * (журнал §29.13). Кадр выбирается фокусной точкой, и предпросмотр повторяет её через
   * `object-position`: сервер режет кадр по той же арифметике (T-066).
   */
  interface Cover {
    assetId: string
    url: string
    alt?: string | null
    focal: { x: number; y: number }
  }

  const props = defineProps<{
    cover: Cover | null
    busy: boolean
    readOnly: boolean
    errorKey: string | null
  }>()
  const emit = defineEmits<{
    upload: [file: File, license: MediaLicense, attribution: string]
    focal: [focal: { x: number; y: number }]
    remove: []
  }>()

  const { t } = useI18n()

  const licenses: MediaLicense[] = ["own", "cc_by", "cc_by_sa", "cc_by_nc", "cc0", "public_domain", "permission"]
  const license = ref<MediaLicense>("own")
  const attribution = ref("")
  const file = ref<File | null>(null)

  const focalX = computed(() => props.cover?.focal.x ?? 0.5)
  const focalY = computed(() => props.cover?.focal.y ?? 0.5)
  const objectPosition = computed(() => `${focalX.value * 100}% ${focalY.value * 100}%`)
  const canUpload = computed(() => !props.readOnly && !props.busy && file.value !== null && attribution.value.trim())

  const onFile = (event: Event) => {
    file.value = (event.target as HTMLInputElement).files?.[0] ?? null
  }

  const onUpload = () => {
    if (!file.value || !canUpload.value) return
    emit("upload", file.value, license.value, attribution.value.trim())
    file.value = null
  }

  const onFocal = (axis: "x" | "y", event: Event) => {
    const value = Number((event.target as HTMLInputElement).value) / 100
    emit("focal", axis === "x" ? { x: value, y: focalY.value } : { x: focalX.value, y: value })
  }
</script>

<template>
  <section class="grid gap-4" data-testid="editor-cover">
    <h2 class="text-sm font-semibold uppercase tracking-[0.18em] text-zinc-500 dark:text-zinc-400">
      {{ t("myArticles.editor.cover.title") }}
    </h2>

    <figure v-if="cover" class="grid gap-3">
      <img
        :src="cover.url"
        :alt="cover.alt ?? ''"
        data-testid="editor-cover-preview"
        class="aspect-[3/2] w-full bg-zinc-100 object-cover dark:bg-zinc-900"
        :style="{ objectPosition }" />
      <figcaption class="text-sm text-zinc-600 dark:text-zinc-300">
        {{ cover.alt || t("myArticles.editor.cover.altPending") }}
      </figcaption>

      <div v-if="!readOnly" class="grid gap-2 sm:grid-cols-2">
        <label class="grid gap-1 text-sm">
          <span>{{ t("myArticles.editor.cover.focalX") }}</span>
          <input type="range" min="0" max="100" :value="Math.round(focalX * 100)" @change="onFocal('x', $event)" />
        </label>
        <label class="grid gap-1 text-sm">
          <span>{{ t("myArticles.editor.cover.focalY") }}</span>
          <input type="range" min="0" max="100" :value="Math.round(focalY * 100)" @change="onFocal('y', $event)" />
        </label>
      </div>

      <button
        v-if="!readOnly"
        type="button"
        class="justify-self-start text-sm text-zinc-600 underline underline-offset-4 dark:text-zinc-300"
        @click="emit('remove')">
        {{ t("myArticles.editor.cover.remove") }}
      </button>
    </figure>

    <!-- Заполнитель показывается только в кабинете автора: в лентах дефолтных изображений нет
         (`article-covers.md` п. 4). -->
    <p
      v-else
      data-testid="editor-cover-placeholder"
      class="bg-zinc-100 px-4 py-6 text-sm text-zinc-700 dark:bg-zinc-900 dark:text-zinc-200">
      {{ t("myArticles.editor.cover.empty") }}
    </p>

    <div v-if="!readOnly" class="grid gap-3">
      <label class="grid gap-1 text-sm">
        <span>{{ t("myArticles.editor.cover.file") }}</span>
        <input type="file" accept="image/*" data-testid="editor-cover-file" @change="onFile" />
      </label>
      <label class="grid gap-1 text-sm">
        <span>{{ t("myArticles.editor.cover.license") }}</span>
        <select
          v-model="license"
          data-testid="editor-cover-license"
          class="bg-white px-3 py-2 ring-1 ring-zinc-300 dark:bg-zinc-950 dark:ring-zinc-700">
          <option v-for="value in licenses" :key="value" :value="value">
            {{ t(`myArticles.editor.cover.licenses.${value}`) }}
          </option>
        </select>
      </label>
      <label class="grid gap-1 text-sm">
        <span>{{ t("myArticles.editor.cover.attribution") }}</span>
        <input
          v-model="attribution"
          type="text"
          data-testid="editor-cover-attribution"
          class="bg-white px-3 py-2 ring-1 ring-zinc-300 dark:bg-zinc-950 dark:ring-zinc-700" />
      </label>
      <button
        type="button"
        data-testid="editor-cover-upload"
        :disabled="!canUpload"
        class="justify-self-start bg-zinc-950 px-4 py-2 text-sm font-semibold text-white disabled:opacity-40 dark:bg-zinc-50 dark:text-zinc-950"
        @click="onUpload">
        {{ busy ? t("myArticles.editor.cover.uploading") : t("myArticles.editor.cover.upload") }}
      </button>
      <p v-if="errorKey" data-testid="editor-cover-error" class="text-sm text-red-700 dark:text-red-300">
        {{ t(`myArticles.editor.errors.${errorKey}`) }}
      </p>
    </div>
  </section>
</template>

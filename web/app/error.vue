<script setup lang="ts">
  import { computed } from "vue"
  import type { NuxtError } from "#app"
  import { serviceRequestId } from "~/utils/serviceError"

  /**
   * Единственный обработчик ошибок Nuxt: 404 — страница #21 (`not-found.md`), всё остальное —
   * страница 500 (#23, `error.md`). 410 сюда не попадает: снятый с публикации адрес остаётся
   * внутри своей страницы (`publicFeed.ts`, T-027/T-056).
   *
   * Обе страницы — `noindex` и вне `sitemap.xml` (§10 обеих спецификаций); ответ 500 ещё и
   * `no-store`, чтобы CDN и браузер не закешировали ошибку (ADR-0019, `error.md` §10).
   */
  const props = defineProps<{ error: NuxtError }>()
  const { t } = useI18n()

  const statusCode = computed(() => props.error?.statusCode ?? 500)
  const isNotFound = computed(() => statusCode.value === 404)

  /**
   * `useState` переносит серверное значение в разметку: заголовок `x-request-id` клиентскому
   * коду недоступен. На 404 значение остаётся пустым — журнал §28.4 оставил код запроса
   * техническим сбоям, а положить его в полезную нагрузку значит показать его в исходнике.
   */
  const requestId = useState<string | null>("service.requestId", () =>
    serviceRequestId(props.error, import.meta.server ? useRequestEvent()?.context.requestId : undefined)
  )

  // Статус ответа выставляет сам обработчик ошибок Nuxt по `statusCode`; `no-store` для 5xx
  // добавляет `web/server/plugins/error-cache-control.ts` — заголовок нужно поставить после
  // рендера, иначе его перекрывает `no-cache` обработчика ошибок (`error.md` §10, ADR-0019).
  useSeoMeta({ robots: "noindex" })
  useHead(() => ({
    title: isNotFound.value ? t("service.notFoundMetaTitle") : t("service.serverErrorMetaTitle")
  }))
</script>

<template>
  <Html class="scroll-pt-16 font-sans antialiased">
    <Body class="bg-zinc-50 dark:bg-zinc-950">
      <NuxtRouteAnnouncer />
      <ServiceNotFound v-if="isNotFound" />
      <ServiceServerError v-else :request-id="requestId" />
    </Body>
  </Html>
</template>

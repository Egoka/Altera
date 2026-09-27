<script setup lang="ts">
  import { computed, onMounted, ref, watch } from "vue"
  import type { NuxtError } from "#app"
  import { serviceRequestId } from "~/utils/serviceError"

  /**
   * Единственный обработчик ошибок Nuxt: 404 — страница #21 (`not-found.md`), 403 — отказ в
   * доступе (`40-admin/dashboard.md` §2, журнал §25.2), всё остальное — страница 500 (#23,
   * `error.md`). 410 сюда не попадает: снятый с публикации адрес остаётся внутри своей страницы
   * (`publicFeed.ts`, T-027/T-056).
   *
   * Клиентский статус страницей 500 не показывается (T-130): «нет доступа» — это не сбой у нас,
   * и `requestId` на нём не выводится (журнал §28.4).
   *
   * Все три страницы — `noindex` и вне `sitemap.xml` (§10 спецификаций); ответ 500 ещё и
   * `no-store`, чтобы CDN и браузер не закешировали ошибку (ADR-0019, `error.md` §10).
   */
  const props = defineProps<{ error: NuxtError }>()
  const { t } = useI18n()

  const statusCode = computed(() => props.error?.statusCode ?? 500)
  const isNotFound = computed(() => statusCode.value === 404)
  const isForbidden = computed(() => statusCode.value === 403)

  /**
   * `useState` переносит серверное значение в разметку: заголовок `x-request-id` клиентскому
   * коду недоступен. Но принадлежит оно ровно тому отказу, который отрисовал сервер: экземпляр
   * страницы забирает его один раз при создании и отпускает после гидратации, иначе следующая
   * ошибка той же SPA-сессии показала бы чужой код (T-130).
   */
  const transferred = useState<string | null>("service.requestId", () =>
    import.meta.server ? serviceRequestId(props.error, useRequestEvent()?.context.requestId) : null
  )
  const inherited = ref(transferred.value)
  onMounted(() => {
    transferred.value = null
  })
  watch(
    () => props.error,
    () => {
      inherited.value = null
    }
  )

  const requestId = computed(() => serviceRequestId(props.error) ?? inherited.value)

  // Статус ответа выставляет сам обработчик ошибок Nuxt по `statusCode`; `no-store` для 5xx
  // добавляет `web/server/plugins/error-cache-control.ts` — заголовок нужно поставить после
  // рендера, иначе его перекрывает `no-cache` обработчика ошибок (`error.md` §10, ADR-0019).
  useSeoMeta({ robots: "noindex" })
  useHead(() => ({
    title: isNotFound.value
      ? t("service.notFoundMetaTitle")
      : isForbidden.value
        ? t("service.forbiddenMetaTitle")
        : t("service.serverErrorMetaTitle")
  }))
</script>

<template>
  <Html class="scroll-pt-16 font-sans antialiased">
    <Body class="bg-zinc-50 dark:bg-zinc-950">
      <NuxtRouteAnnouncer />
      <ServiceNotFound v-if="isNotFound" />
      <ServiceForbidden v-else-if="isForbidden" />
      <ServiceServerError v-else :request-id="requestId" />
    </Body>
  </Html>
</template>

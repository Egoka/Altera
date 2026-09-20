<script setup lang="ts">
  import { computed } from "vue"

  // `title` и `description` переопределяют редакционный текст ошибки: страницам вроде «Цены и
  // планы» нужен свой заголовок состояния («планы временно недоступны», `pricing.md` §8).
  const props = withDefaults(
    defineProps<{ requestId?: string; contactTo?: string; title?: string; description?: string }>(),
    {
      contactTo: "/contact",
      title: undefined,
      description: undefined
    }
  )
  const { t } = useI18n()

  const heading = computed(() => props.title ?? t("reading.loadErrorTitle"))
  const explanation = computed(() => props.description ?? t("reading.loadErrorDescription"))
</script>

<template>
  <section class="border-y border-red-200 py-12 text-center dark:border-red-950" role="alert">
    <h2 class="font-waterway text-3xl tracking-wide text-zinc-950 dark:text-zinc-100">
      {{ heading }}
    </h2>
    <p class="mt-3 font-garamond-libre text-lg text-zinc-600 dark:text-zinc-400">
      {{ explanation }}
    </p>
    <p v-if="requestId" class="mt-2 font-mono text-xs text-zinc-500">
      {{ t("reading.requestCode", { requestId }) }}
    </p>
    <NuxtLink
      :to="contactTo"
      class="mt-6 inline-flex border-b-2 border-orange-600 pb-1 font-serif font-semibold text-zinc-950 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-orange-600 dark:text-zinc-100">
      {{ t("reading.contactEditorial") }}
    </NuxtLink>
  </section>
</template>

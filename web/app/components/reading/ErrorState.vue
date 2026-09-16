<script setup lang="ts">
  withDefaults(defineProps<{ requestId?: string; contactTo?: string }>(), { contactTo: "/contact" })
  const { t } = useI18n()
</script>

<template>
  <section class="border-y border-red-200 py-12 text-center dark:border-red-950" role="alert">
    <h2 class="font-waterway text-3xl tracking-wide text-zinc-950 dark:text-zinc-100">
      {{ t("reading.loadErrorTitle") }}
    </h2>
    <p class="mt-3 font-garamond-libre text-lg text-zinc-600 dark:text-zinc-400">
      {{ t("reading.loadErrorDescription") }}
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

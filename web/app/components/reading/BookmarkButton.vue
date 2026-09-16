<script setup lang="ts">
  const props = withDefaults(
    defineProps<{
      bookmarked?: boolean
      busy?: boolean
      guest?: boolean
      loginPath?: string
    }>(),
    { bookmarked: false, busy: false, guest: false, loginPath: "/login" }
  )

  const emit = defineEmits<{ toggle: [bookmarked: boolean] }>()
  const { t } = useI18n()
</script>

<template>
  <NuxtLink
    v-if="guest"
    :to="loginPath"
    :aria-label="t('reading.loginToBookmark')"
    :title="t('reading.loginToBookmark')"
    class="inline-flex size-10 items-center justify-center rounded-full border border-zinc-300 bg-white text-zinc-800 transition-colors hover:border-orange-600 hover:text-orange-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-orange-600 motion-reduce:transition-none dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-200">
    <span aria-hidden="true">☆</span>
  </NuxtLink>
  <button
    v-else
    type="button"
    :disabled="busy"
    :aria-busy="busy || undefined"
    :aria-pressed="bookmarked"
    :aria-label="bookmarked ? t('reading.removeBookmark') : t('reading.addBookmark')"
    class="inline-flex size-10 items-center justify-center rounded-full border border-zinc-300 bg-white text-lg text-zinc-800 transition-colors hover:border-orange-600 hover:text-orange-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-orange-600 disabled:cursor-wait disabled:opacity-60 motion-reduce:transition-none dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-200"
    @click="emit('toggle', !props.bookmarked)">
    <span aria-hidden="true">{{ bookmarked ? "★" : "☆" }}</span>
  </button>
</template>

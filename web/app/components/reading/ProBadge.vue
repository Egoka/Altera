<script setup lang="ts">
  const { t } = useI18n()
</script>

<template>
  <span
    class="inline-flex items-center rounded-full bg-orange-600 px-1.5 py-0.5 font-sans text-[0.625rem] font-bold uppercase tracking-[0.12em] text-white"
    :aria-label="t('reading.proAuthor')">
    pro
  </span>
</template>

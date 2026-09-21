<script setup lang="ts">
  /**
   * Dev-маршрут `/test-error` (`docs/spec/20-public/error.md` §3, `routes.md` #69): вызывает
   * страницу 500 намеренно. Из production-сборки удаляется хуком `pages:extend` в
   * `nuxt.config.ts`, поэтому проверять её отдельно в проде нечем и незачем.
   */
  throw createError({ statusCode: 500, statusMessage: "INTERNAL_ERROR", fatal: true })
</script>

<template>
  <div />
</template>

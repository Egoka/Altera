<script setup lang="ts">
  // Правила публикации (`docs/spec/20-public/legal-content-rules.md`, реестр страниц #17). Якоря
  // разделов (`#rights`, `#forbidden`, `#review`, …) задаёт сам текст; неизвестный якорь открывает
  // действующую редакцию сверху (§8).
  definePageMeta({ layout: "default" })
</script>

<template>
  <LegalPage kind="content_rules" />
</template>

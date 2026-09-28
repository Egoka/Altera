<script setup lang="ts">
  /**
   * Заглушка `/me/articles/{id}`: собственной строки в реестре маршрутов у неё нет
   * (`00-registries/routes.md` #34–38), и кабинет ведёт с неё в редактор. Лежит файлом
   * `index.vue`, а не `[id].vue`: соседний `[id].vue` сделал бы редактор вложенным маршрутом,
   * и `/me/articles/{id}/edit` рисовал бы эту заглушку вместо него.
   */
  definePageMeta({
    i18n: false,
    layout: "auth",
    requiresAuth: true
  })
</script>

<template>
  <div>/me/articles/:id</div>
</template>

<style scoped></style>

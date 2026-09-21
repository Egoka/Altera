<script setup lang="ts"></script>

<template>
  <!-- Печатная версия страницы — без шапки и футера (`legal-terms.md` §9). -->
  <AppHeader class="print:hidden" />
  <AppMain>
    <slot />
  </AppMain>
  <AppFooter class="print:hidden" />
</template>

<style scoped></style>

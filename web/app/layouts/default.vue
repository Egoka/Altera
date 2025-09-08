<script setup lang="ts"></script>

<template>
  <AppHeader />
  <main
    :class="[
      'pt-14 mx-auto max-w-7xl',
      'min-h-[calc(100vh-854px)]',
      'sm:min-h-[calc(100vh-902px)]',
      'md:min-h-[calc(100vh-709px)]',
      'lg:min-h-[calc(100vh-757px)]',
      'xl:min-h-[calc(100vh-549px)]'
    ]">
    <slot />
  </main>
  <AppFooter />
</template>

<style scoped></style>

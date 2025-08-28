<script setup lang="ts"></script>

<template>
  <div class="min-h-screen transition-all duration-300">
    <!-- Тестовый контент для скролла -->
    <PagesStartFeatured />
    <div class="mt-10 h-screen bg-gradient-to-b from-blue-50 to-blue-100 flex items-center justify-center">
      <div class="text-center">
        <h1 class="font-bergamasco text-6xl text-blue-900 mb-4">Altera Спорт Sport</h1>
        <p class="text-xl text-blue-700">Прокрутите вниз, чтобы увидеть анимацию логотипа</p>
      </div>
    </div>
    <DemoScreenSizeIndicator />
  </div>
</template>

<template>
  <div class="font-showcase p-8 max-w-4xl mx-auto">
    <h1 class="text-4xl font-bold mb-8 text-center">Демонстрация шрифтов</h1>

    <!-- Inter Font -->
    <section class="mb-12">
      <h2 class="text-2xl font-bold mb-6 text-inter">Inter Font</h2>
      <div class="space-y-4">
        <div class="text-inter font-light text-xl">Light (300) - Inter Light</div>
        <div class="text-inter font-normal text-xl">Regular (400) - Inter Regular</div>
        <div class="text-inter font-medium text-xl">Medium (500) - Inter Medium</div>
        <div class="text-inter font-semibold text-xl">Semibold (600) - Inter Semibold</div>
        <div class="text-inter font-bold text-xl">Bold (700) - Inter Bold</div>
        <div class="text-inter font-normal italic text-xl">Italic - Inter Italic</div>
      </div>
    </section>

    <!-- Poppins Font -->
    <section class="mb-12">
      <h2 class="text-2xl font-bold mb-6 text-poppins">Poppins Font</h2>
      <div class="space-y-4">
        <div class="text-poppins font-light text-xl">Light (300) - Poppins Light</div>
        <div class="text-poppins font-normal text-xl">Regular (400) - Poppins Regular</div>
        <div class="text-poppins font-medium text-xl">Medium (500) - Poppins Medium</div>
        <div class="text-poppins font-semibold text-xl">Semibold (600) - Poppins Semibold</div>
        <div class="text-poppins font-bold text-xl">Bold (700) - Poppins Bold</div>
        <div class="text-poppins font-normal italic text-xl">Italic - Poppins Italic</div>
      </div>
    </section>

    <!-- Roboto Font -->
    <section class="mb-12">
      <h2 class="text-2xl font-bold mb-6 text-roboto">Roboto Font</h2>
      <div class="space-y-4">
        <div class="text-roboto font-light text-xl">Light (300) - Roboto Light</div>
        <div class="text-roboto font-normal text-xl">Regular (400) - Roboto Regular</div>
        <div class="text-roboto font-medium text-xl">Medium (500) - Roboto Medium</div>
        <div class="text-roboto font-bold text-xl">Bold (700) - Roboto Bold</div>
        <div class="text-roboto font-normal italic text-xl">Italic - Roboto Italic</div>
      </div>
    </section>

    <!-- Open Sans Font -->
    <section class="mb-12">
      <h2 class="text-2xl font-bold mb-6 text-open-sans">Open Sans Font</h2>
      <div class="space-y-4">
        <div class="text-open-sans font-light text-xl">Light (300) - Open Sans Light</div>
        <div class="text-open-sans font-normal text-xl">Regular (400) - Open Sans Regular</div>
        <div class="text-open-sans font-medium text-xl">Medium (500) - Open Sans Medium</div>
        <div class="text-open-sans font-semibold text-xl">Semibold (600) - Open Sans Semibold</div>
        <div class="text-open-sans font-bold text-xl">Bold (700) - Open Sans Bold</div>
        <div class="text-open-sans font-normal italic text-xl">Italic - Open Sans Italic</div>
      </div>
    </section>
    <section class="mb-12">
      <!-- Разные веса -->
      <h1 class="font-bergamasco font-thin">Thin (100)</h1>
      <h2 class="font-bergamasco font-light">Light (300)</h2>
      <h3 class="font-bergamasco font-normal">Regular (400)</h3>
      <h4 class="font-bergamasco font-medium">Medium (500)</h4>
      <h5 class="font-bergamasco font-semibold">Semibold (600)</h5>
      <h6 class="font-bergamasco font-bold">Bold (700)</h6>

      <!-- Курсив -->
      <p class="font-bergamasco italic font-light">Light Italic</p>
      <p class="font-bergamasco italic font-normal">Regular Italic</p>
      <p class="font-bergamasco italic font-bold">Bold Italic</p>
    </section>

    <!-- Примеры использования -->
    <section class="mb-12">
      <h2 class="text-2xl font-bold mb-6">Примеры использования</h2>

      <div class="space-y-6">
        <!-- Заголовок с Georgia (временно вместо Bergamasco) -->
        <div>
          <h3 class="text-bergamasco text-3xl font-bold mb-2">Заголовок статьи</h3>
          <p class="text-inter text-lg">Этот текст написан шрифтом Inter для лучшей читаемости основного контента.</p>
        </div>

        <!-- Навигация с Inter -->
        <div>
          <nav class="text-inter font-medium space-x-4">
            <a href="#" class="hover:text-secondary-600">Главная</a>
            <a href="#" class="hover:text-secondary-600">Статьи</a>
            <a href="#" class="hover:text-secondary-600">О нас</a>
            <a href="#" class="hover:text-secondary-600">Контакты</a>
          </nav>
        </div>

        <!-- Кнопка с Poppins -->
        <div>
          <button
            class="text-poppins font-semibold bg-secondary-500 text-white px-6 py-3 rounded-lg hover:bg-secondary-600 transition-colors">
            Кнопка действия
          </button>
        </div>

        <!-- Цитата с Roboto -->
        <div class="bg-neutral-100 p-6 rounded-lg">
          <blockquote class="text-roboto font-medium text-lg italic">
            "Это пример цитаты, оформленной шрифтом Roboto для выделения важной информации."
          </blockquote>
        </div>
      </div>
    </section>
  </div>
</template>

<script setup lang="ts">
  // Компонент для демонстрации шрифтов
</script>

<style scoped>
  .font-showcase {
    font-family: var(--font-inter);
  }

  .text-bergamasco {
    font-family: var(--font-bergamasco);
  }

  .text-inter {
    font-family: var(--font-inter);
  }

  .text-poppins {
    font-family: var(--font-poppins);
  }

  .text-roboto {
    font-family: var(--font-roboto);
  }

  .text-open-sans {
    font-family: var(--font-open-sans);
  }
</style>

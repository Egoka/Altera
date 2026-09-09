<template>
  <div class="min-h-screen">
    <div class="container mx-auto px-4 py-8">
      <!-- Заголовок -->
      <div class="text-center mb-12">
        <h1 class="text-4xl md:text-6xl font-bold text-neutral-900 dark:text-neutral-100 mb-4">Демонстрация шрифтов</h1>
        <p class="text-lg text-neutral-600 dark:text-neutral-400 max-w-2xl mx-auto">
          Полная коллекция стандартных шрифтов Tailwind CSS и кастомных шрифтов проекта Altera
        </p>
      </div>

      <!-- Поле для кастомного текста -->
      <div class="rounded-xl shadow-lg p-6 mb-8">
        <h2 class="text-2xl font-semibold text-neutral-900 dark:text-neutral-100 mb-4">
          Кастомный текст для демонстрации
        </h2>
        <div class="flex flex-col md:flex-row gap-4">
          <input
            v-model="customText"
            type="text"
            placeholder="Введите текст для демонстрации..."
            class="flex-1 px-4 py-3 border border-neutral-300 dark:border-neutral-600 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent bg-white dark:bg-neutral-700 text-neutral-900 dark:text-neutral-100 placeholder-neutral-500 dark:placeholder-neutral-400" />
          <button
            @click="resetText"
            class="px-6 py-3 bg-primary-500 hover:bg-primary-600 text-white rounded-lg font-medium transition-colors duration-200">
            Сбросить
          </button>
        </div>
      </div>

      <!-- Кастомные шрифты -->
      <div class="mb-12">
        <h2 class="text-3xl font-bold text-neutral-900 dark:text-neutral-100 mb-8 text-center">
          Кастомные шрифты проекта
        </h2>

        <div class="grid gap-8">
          <!-- Bergamasco -->
          <div class="rounded-xl shadow-lg p-6">
            <h3 class="text-xl font-semibold text-neutral-900 dark:text-neutral-100 mb-4">Bergamasco (Serif)</h3>
            <div class="space-y-4">
              <div class="text-4xl font-thin" style="font-family: var(--font-bergamasco)">
                {{ displayText }} - Thin (100)
              </div>
              <div class="text-4xl font-light" style="font-family: var(--font-bergamasco)">
                {{ displayText }} - Light (300)
              </div>
              <div class="text-4xl font-normal" style="font-family: var(--font-bergamasco)">
                {{ displayText }} - Regular (400)
              </div>
              <div class="text-4xl font-medium" style="font-family: var(--font-bergamasco)">
                {{ displayText }} - Medium (500)
              </div>
              <div class="text-4xl font-semibold" style="font-family: var(--font-bergamasco)">
                {{ displayText }} - Semibold (600)
              </div>
              <div class="text-4xl font-bold" style="font-family: var(--font-bergamasco)">
                {{ displayText }} - Bold (700)
              </div>
            </div>
          </div>

          <!-- Cormorant SC -->
          <div class="rounded-xl shadow-lg p-6">
            <h3 class="text-xl font-semibold text-neutral-900 dark:text-neutral-100 mb-4">Cormorant SC (Serif)</h3>
            <div class="space-y-4">
              <div class="text-4xl font-light" style="font-family: var(--font-cormorant)">
                {{ displayText }} - Light (300)
              </div>
              <div class="text-4xl font-normal" style="font-family: var(--font-cormorant)">
                {{ displayText }} - Regular (400)
              </div>
              <div class="text-4xl font-medium" style="font-family: var(--font-cormorant)">
                {{ displayText }} - Medium (500)
              </div>
              <div class="text-4xl font-semibold" style="font-family: var(--font-cormorant)">
                {{ displayText }} - Semibold (600)
              </div>
              <div class="text-4xl font-bold" style="font-family: var(--font-cormorant)">
                {{ displayText }} - Bold (700)
              </div>
            </div>
          </div>

          <!-- Waterway -->
          <div class="rounded-xl shadow-lg p-6">
            <h3 class="text-xl font-semibold text-neutral-900 dark:text-neutral-100 mb-4">Waterway (Display)</h3>
            <div class="space-y-4">
              <div class="text-5xl" style="font-family: var(--font-waterway)">{{ displayText }} - Display Font</div>
            </div>
          </div>

          <!-- Garamond Libre -->
          <div class="rounded-xl shadow-lg p-6">
            <h3 class="text-xl font-semibold text-neutral-900 dark:text-neutral-100 mb-4">Garamond Libre (Serif)</h3>
            <div class="space-y-4">
              <div class="text-4xl font-normal" style="font-family: var(--font-garamond-libre)">
                {{ displayText }} - Regular (400)
              </div>
              <div class="text-4xl font-bold" style="font-family: var(--font-garamond-libre)">
                {{ displayText }} - Bold (700)
              </div>
              <div class="text-4xl font-normal italic" style="font-family: var(--font-garamond-libre)">
                {{ displayText }} - Italic (400)
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- Стандартные шрифты Tailwind -->
      <div class="mb-12">
        <h2 class="text-3xl font-bold text-neutral-900 dark:text-neutral-100 mb-8 text-center">
          Стандартные шрифты Tailwind CSS
        </h2>

        <div class="grid gap-8">
          <!-- Sans-serif шрифты -->
          <div class="rounded-xl shadow-lg p-6">
            <h3 class="text-xl font-semibold text-neutral-900 dark:text-neutral-100 mb-4">Sans-serif шрифты</h3>
            <div class="space-y-4">
              <!-- Inter -->
              <div class="border-l-4 border-primary-500 pl-4">
                <h4 class="text-lg font-medium text-neutral-700 dark:text-neutral-300 mb-2">Inter</h4>
                <div class="space-y-2">
                  <div class="text-2xl font-thin font-sans">{{ displayText }} - Thin (100)</div>
                  <div class="text-2xl font-light font-sans">{{ displayText }} - Light (300)</div>
                  <div class="text-2xl font-normal font-sans">{{ displayText }} - Regular (400)</div>
                  <div class="text-2xl font-medium font-sans">{{ displayText }} - Medium (500)</div>
                  <div class="text-2xl font-semibold font-sans">{{ displayText }} - Semibold (600)</div>
                  <div class="text-2xl font-bold font-sans">{{ displayText }} - Bold (700)</div>
                  <div class="text-2xl font-extrabold font-sans">{{ displayText }} - Extra Bold (800)</div>
                  <div class="text-2xl font-black font-sans">{{ displayText }} - Black (900)</div>
                </div>
              </div>

              <!-- System UI -->
              <div class="border-l-4 border-secondary-500 pl-4">
                <h4 class="text-lg font-medium text-neutral-700 dark:text-neutral-300 mb-2">System UI</h4>
                <div class="space-y-2">
                  <div class="text-2xl font-thin font-sans">{{ displayText }} - Thin (100)</div>
                  <div class="text-2xl font-light font-sans">{{ displayText }} - Light (300)</div>
                  <div class="text-2xl font-normal font-sans">{{ displayText }} - Regular (400)</div>
                  <div class="text-2xl font-medium font-sans">{{ displayText }} - Medium (500)</div>
                  <div class="text-2xl font-semibold font-sans">{{ displayText }} - Semibold (600)</div>
                  <div class="text-2xl font-bold font-sans">{{ displayText }} - Bold (700)</div>
                </div>
              </div>
            </div>
          </div>

          <!-- Serif шрифты -->
          <div class="rounded-xl shadow-lg p-6">
            <h3 class="text-xl font-semibold text-neutral-900 dark:text-neutral-100 mb-4">Serif шрифты</h3>
            <div class="space-y-4">
              <div class="border-l-4 border-accent-500 pl-4">
                <h4 class="text-lg font-medium text-neutral-700 dark:text-neutral-300 mb-2">Serif</h4>
                <div class="space-y-2">
                  <div class="text-2xl font-thin font-serif">{{ displayText }} - Thin (100)</div>
                  <div class="text-2xl font-light font-serif">{{ displayText }} - Light (300)</div>
                  <div class="text-2xl font-normal font-serif">{{ displayText }} - Regular (400)</div>
                  <div class="text-2xl font-medium font-serif">{{ displayText }} - Medium (500)</div>
                  <div class="text-2xl font-semibold font-serif">{{ displayText }} - Semibold (600)</div>
                  <div class="text-2xl font-bold font-serif">{{ displayText }} - Bold (700)</div>
                </div>
              </div>
            </div>
          </div>

          <!-- Monospace шрифты -->
          <div class="rounded-xl shadow-lg p-6">
            <h3 class="text-xl font-semibold text-neutral-900 dark:text-neutral-100 mb-4">Monospace шрифты</h3>
            <div class="space-y-4">
              <div class="border-l-4 border-success-500 pl-4">
                <h4 class="text-lg font-medium text-neutral-700 dark:text-neutral-300 mb-2">Monospace</h4>
                <div class="space-y-2">
                  <div class="text-2xl font-thin font-mono">{{ displayText }} - Thin (100)</div>
                  <div class="text-2xl font-light font-mono">{{ displayText }} - Light (300)</div>
                  <div class="text-2xl font-normal font-mono">{{ displayText }} - Regular (400)</div>
                  <div class="text-2xl font-medium font-mono">{{ displayText }} - Medium (500)</div>
                  <div class="text-2xl font-semibold font-mono">{{ displayText }} - Semibold (600)</div>
                  <div class="text-2xl font-bold font-mono">{{ displayText }} - Bold (700)</div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- Размеры шрифтов -->
      <div class="mb-12">
        <h2 class="text-3xl font-bold text-neutral-900 dark:text-neutral-100 mb-8 text-center">
          Размеры шрифтов Tailwind CSS
        </h2>

        <div class="rounded-xl shadow-lg p-6">
          <div class="space-y-4">
            <div class="text-xs font-sans">{{ displayText }} - text-xs (12px)</div>
            <div class="text-sm font-sans">{{ displayText }} - text-sm (14px)</div>
            <div class="text-base font-sans">{{ displayText }} - text-base (16px)</div>
            <div class="text-lg font-sans">{{ displayText }} - text-lg (18px)</div>
            <div class="text-xl font-sans">{{ displayText }} - text-xl (20px)</div>
            <div class="text-2xl font-sans">{{ displayText }} - text-2xl (24px)</div>
            <div class="text-3xl font-sans">{{ displayText }} - text-3xl (30px)</div>
            <div class="text-4xl font-sans">{{ displayText }} - text-4xl (36px)</div>
            <div class="text-5xl font-sans">{{ displayText }} - text-5xl (48px)</div>
            <div class="text-6xl font-sans">{{ displayText }} - text-6xl (60px)</div>
            <div class="text-7xl font-sans">{{ displayText }} - text-7xl (72px)</div>
            <div class="text-8xl font-sans">{{ displayText }} - text-8xl (96px)</div>
            <div class="text-9xl font-sans">{{ displayText }} - text-9xl (128px)</div>
          </div>
        </div>
      </div>

      <!-- Дополнительные стили -->
      <div class="mb-12">
        <h2 class="text-3xl font-bold text-neutral-900 dark:text-neutral-100 mb-8 text-center">
          Дополнительные стили текста
        </h2>

        <div class="rounded-xl shadow-lg p-6">
          <div class="space-y-4">
            <div class="text-2xl font-sans">{{ displayText }} - Обычный текст</div>
            <div class="text-2xl font-sans italic">{{ displayText }} - Курсив (italic)</div>
            <div class="text-2xl font-sans underline">{{ displayText }} - Подчеркнутый (underline)</div>
            <div class="text-2xl font-sans line-through">{{ displayText }} - Зачеркнутый (line-through)</div>
            <div class="text-2xl font-sans no-underline">{{ displayText }} - Без подчеркивания (no-underline)</div>
            <div class="text-2xl font-sans uppercase">{{ displayText }} - Верхний регистр (uppercase)</div>
            <div class="text-2xl font-sans lowercase">{{ displayText }} - Нижний регистр (lowercase)</div>
            <div class="text-2xl font-sans capitalize">{{ displayText }} - Первая буква заглавная (capitalize)</div>
            <div class="text-2xl font-sans tracking-tight">
              {{ displayText }} - Узкий межбуквенный интервал (tracking-tight)
            </div>
            <div class="text-2xl font-sans tracking-normal">
              {{ displayText }} - Обычный межбуквенный интервал (tracking-normal)
            </div>
            <div class="text-2xl font-sans tracking-wide">
              {{ displayText }} - Широкий межбуквенный интервал (tracking-wide)
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
  import { ref, computed } from "vue"

  // Реактивные данные
  const customText = ref("")

  // Вычисляемое свойство для отображаемого текста
  const displayText = computed(() => {
    return customText.value || "The quick brown fox jumps over the lazy dog"
  })

  // Функция сброса текста
  const resetText = () => {
    customText.value = ""
  }

  // Мета-информация страницы
  useHead({
    title: "Демонстрация шрифтов - Altera",
    meta: [
      {
        name: "description",
        content: "Полная демонстрация всех шрифтов проекта Altera, включая кастомные и стандартные шрифты Tailwind CSS"
      }
    ]
  })
</script>

<script setup lang="ts">
  /**
   * Шапка ленты рубрики (`section-feed.md` §5 зона 2): название, описание и число
   * материалов локали. Описания может не быть — тогда зона показывает одно название.
   *
   * Кнопки подписки здесь нет: подписка на автора — F-10, и на рубрику она не
   * распространяется; прежняя кнопка ничего не меняла и обещала несуществующее действие.
   * Описание выводится текстом, а не разметкой: публичная страница не исполняет HTML
   * из административного поля.
   */
  defineProps<{
    section: { name: string; description?: string | null; articleCount?: number }
    countLabel?: string
  }>()
</script>

<template>
  <header class="w-full border-b border-zinc-200 dark:border-zinc-800">
    <div class="w-full pt-12 pb-8 sm:pt-10 sm:pb-6 md:pt-14 md:pb-10">
      <div class="flex flex-col items-center gap-4">
        <h1
          class="font-waterway text-center text-3xl font-bold tracking-widest text-zinc-900 sm:text-4xl md:text-5xl dark:text-zinc-100">
          {{ section.name }}
        </h1>

        <p
          v-if="section.description?.trim()"
          class="max-w-3xl text-center font-garamond-libre text-xl leading-relaxed text-zinc-600 dark:text-zinc-300">
          {{ section.description }}
        </p>

        <p v-if="countLabel" class="font-sans text-xs font-bold uppercase text-zinc-500 dark:text-zinc-500">
          {{ countLabel }}
        </p>
      </div>
    </div>
  </header>
</template>

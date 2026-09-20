<script setup lang="ts">
  /**
   * Пагинация лент и каталогов: страницами, без бесконечной прокрутки
   * (`section-feed.md` §5). Одна страница — компонент не рендерится.
   *
   * Ссылки настоящие: листание меняет адрес, поэтому страница делится, открывается
   * в новой вкладке и читается поисковой системой.
   */
  const props = defineProps<{ page: number; totalPages: number; to: (page: number) => string; label: string }>()

  /** Окно номеров вокруг текущей страницы: длинный каталог не растягивает панель. */
  const WINDOW = 2
  const numbers = computed(() => {
    const first = Math.max(1, props.page - WINDOW)
    const last = Math.min(props.totalPages, props.page + WINDOW)
    return Array.from({ length: last - first + 1 }, (_, index) => first + index)
  })
</script>

<template>
  <nav v-if="totalPages > 1" :aria-label="label" class="flex flex-wrap items-center justify-center gap-2 py-12">
    <NuxtLink
      v-if="page > 1"
      :to="to(page - 1)"
      rel="prev"
      class="px-3 py-2 font-sans text-xs font-bold uppercase text-zinc-600 hover:text-red-700 dark:text-zinc-400">
      ‹
    </NuxtLink>
    <NuxtLink
      v-for="number in numbers"
      :key="number"
      :to="to(number)"
      :aria-current="number === page ? 'page' : undefined"
      :class="[
        'px-3 py-2 font-sans text-sm transition-colors duration-300',
        number === page
          ? 'font-bold text-zinc-950 underline underline-offset-8 dark:text-zinc-100'
          : 'text-zinc-600 hover:text-red-700 dark:text-zinc-400 dark:hover:text-red-400'
      ]">
      {{ number }}
    </NuxtLink>
    <NuxtLink
      v-if="page < totalPages"
      :to="to(page + 1)"
      rel="next"
      class="px-3 py-2 font-sans text-xs font-bold uppercase text-zinc-600 hover:text-red-700 dark:text-zinc-400">
      ›
    </NuxtLink>
  </nav>
</template>

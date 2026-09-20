<script setup lang="ts">
  /**
   * Карточка автора каталога: аватар или инициалы, имя, бейдж уровня, хэндл, первое
   * предложение «о себе», число материалов и две последние публикации
   * (`authors-index.md` §5). Плана, срока и e-mail в публичном типе нет (ADR-0018);
   * подписка — F-10, в этой странице её нет.
   */
  const props = defineProps<{
    author: {
      handle: string
      name: string
      avatar?: string | null
      grade: "standard" | "pro"
      bioShort?: string | null
      publishedCount: number
      isEditorial: boolean
      recent: readonly { title: string; path: string }[]
    }
    countLabel: string
  }>()

  const initials = computed(() =>
    props.author.name
      .split(/\s+/)
      .slice(0, 2)
      .map((part) => part.charAt(0).toLocaleUpperCase())
      .join("")
  )
</script>

<template>
  <article class="flex flex-col gap-3">
    <NuxtLink :to="`/authors/${author.handle}`" class="flex items-center gap-4">
      <NuxtImg v-if="author.avatar" :src="author.avatar" :alt="author.name" class="size-16 rounded-full object-cover" />
      <span
        v-else
        aria-hidden="true"
        class="flex size-16 items-center justify-center rounded-full bg-zinc-100 font-waterway text-xl text-zinc-500 dark:bg-zinc-900 dark:text-zinc-400">
        {{ initials }}
      </span>
      <span>
        <span class="flex items-center gap-2">
          <span class="font-waterway text-xl tracking-wide text-zinc-950 dark:text-zinc-100">{{ author.name }}</span>
          <ReadingProBadge v-if="author.grade === 'pro'" />
        </span>
        <span class="block font-sans text-xs text-zinc-500 dark:text-zinc-500">@{{ author.handle }}</span>
      </span>
    </NuxtLink>

    <p v-if="author.bioShort" class="line-clamp-2 font-garamond-libre text-lg text-zinc-600 dark:text-zinc-400">
      {{ author.bioShort }}
    </p>
    <p class="font-sans text-xs font-bold uppercase text-zinc-500 dark:text-zinc-500">{{ countLabel }}</p>

    <ul v-if="author.recent.length" class="space-y-2 border-t border-zinc-200 pt-3 dark:border-zinc-800">
      <li v-for="article in author.recent" :key="article.path">
        <NuxtLink
          :to="article.path"
          class="font-garamond-libre text-base text-zinc-700 transition-colors duration-300 hover:text-red-700 dark:text-zinc-300 dark:hover:text-red-400">
          {{ article.title }}
        </NuxtLink>
      </li>
    </ul>
  </article>
</template>

<script setup lang="ts">
  /**
   * Панель ленты и каталога: словесная подпись принципа порядка и ряды значений
   * фильтров ссылками (`section-feed.md` §6). Переключателя сортировки «по рейтингу»
   * до запуска движка нет (журнал §20.4) — подпись объясняет порядок словами.
   *
   * Фильтр без значений скрывается: пустой ряд ничего не сообщает.
   */
  import type { FeedControlGroup } from "~/types/reading"

  defineProps<{ caption?: string; groups: readonly FeedControlGroup[]; resetLabel?: string; resetTo?: string }>()
</script>

<template>
  <section class="space-y-4 border-b border-zinc-200 py-6 dark:border-zinc-800">
    <p v-if="caption" class="font-sans text-xs uppercase tracking-wide text-zinc-500 dark:text-zinc-500">
      {{ caption }}
    </p>

    <div v-for="group in groups" :key="group.label" class="flex flex-wrap items-baseline gap-x-2 gap-y-2 sm:gap-x-4">
      <span class="font-sans text-xs font-bold uppercase text-zinc-500 dark:text-zinc-500">{{ group.label }}</span>
      <NuxtLink
        v-for="option in group.options"
        :key="option.slug"
        :to="group.to(group.active === option.slug ? null : option.slug)"
        :aria-current="group.active === option.slug ? 'true' : undefined"
        :class="[
          'font-garamond-libre text-lg transition-colors duration-300',
          group.active === option.slug
            ? 'font-semibold text-zinc-950 underline underline-offset-4 dark:text-zinc-100'
            : 'text-zinc-600 hover:text-red-700 dark:text-zinc-400 dark:hover:text-red-400'
        ]">
        {{ option.name }}
      </NuxtLink>
    </div>

    <NuxtLink
      v-if="resetLabel && resetTo"
      :to="resetTo"
      class="inline-flex font-sans text-xs font-bold uppercase text-zinc-600 underline underline-offset-4 hover:text-red-700 dark:text-zinc-400">
      {{ resetLabel }}
    </NuxtLink>
  </section>
</template>

<script setup lang="ts">
  import type { PublicNavigationSection, PublicNavigationTag } from "~/composables/usePublicNavigation"

  withDefaults(
    defineProps<{
      isOpen: boolean
      sections?: readonly PublicNavigationSection[]
      popularTags?: readonly PublicNavigationTag[]
      loading?: boolean
    }>(),
    { sections: () => [], popularTags: () => [], loading: false }
  )

  defineEmits<{ close: [] }>()
  const { t } = useI18n()
</script>

<template>
  <Transition
    enter-active-class="transition duration-200 ease-out motion-reduce:transition-none"
    enter-from-class="-translate-y-2 opacity-0"
    leave-active-class="transition duration-150 ease-in motion-reduce:transition-none"
    leave-to-class="-translate-y-2 opacity-0">
    <div
      v-if="isOpen"
      id="public-navigation-menu"
      class="absolute inset-x-0 top-full border-y border-zinc-200 bg-white shadow-xl dark:border-zinc-800 dark:bg-zinc-950">
      <div class="mx-auto grid max-w-7xl gap-10 px-4 py-8 sm:px-6 lg:grid-cols-[1fr_18rem] lg:px-8">
        <nav :aria-label="t('navigation.sections')">
          <p class="mb-5 font-cormorant-sc text-xs font-semibold uppercase tracking-[0.18em] text-zinc-500">
            {{ t("navigation.sections") }}
          </p>
          <p v-if="loading" class="font-garamond-libre text-lg text-zinc-500" aria-live="polite">
            {{ t("navigation.sectionsLoading") }}
          </p>
          <p v-else-if="sections.length === 0" class="font-garamond-libre text-lg text-zinc-500">
            {{ t("navigation.sectionsEmpty") }}
          </p>
          <ul
            v-else
            class="grid grid-cols-1 gap-x-8 border-t border-zinc-200 sm:grid-cols-2 lg:grid-cols-3 dark:border-zinc-800">
            <li v-for="section in sections" :key="section.id" class="border-b border-zinc-200 dark:border-zinc-800">
              <NuxtLink
                :to="`/${section.slug}`"
                class="group flex min-h-16 items-center justify-between gap-4 py-3 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-orange-600"
                @click="$emit('close')">
                <span
                  class="font-garamond-libre text-xl font-semibold text-zinc-950 group-hover:text-orange-700 dark:text-zinc-100 dark:group-hover:text-orange-400">
                  {{ section.name }}
                </span>
                <span
                  class="font-sans text-xs tabular-nums text-zinc-400"
                  :aria-label="t('navigation.articleCount', { count: section.articleCount })">
                  {{ section.articleCount }}
                </span>
              </NuxtLink>
            </li>
          </ul>
        </nav>

        <aside class="border-t border-zinc-200 pt-6 lg:border-l lg:border-t-0 lg:pl-8 lg:pt-0 dark:border-zinc-800">
          <p class="font-cormorant-sc text-xs font-semibold uppercase tracking-[0.18em] text-zinc-500">
            {{ t("navigation.trending") }}
          </p>
          <div v-if="popularTags.length" class="mt-4 flex flex-wrap gap-2">
            <NuxtLink
              v-for="tag in popularTags"
              :key="tag.slug"
              :to="`/tags/${tag.slug}`"
              class="border border-zinc-300 px-3 py-1.5 font-sans text-sm text-zinc-700 hover:border-orange-600 hover:text-orange-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-orange-600 dark:border-zinc-700 dark:text-zinc-300"
              @click="$emit('close')">
              {{ tag.name }}
            </NuxtLink>
          </div>
          <NuxtLink
            to="/sections"
            class="mt-6 inline-flex border-b border-orange-600 pb-1 font-serif font-semibold text-zinc-950 dark:text-zinc-100"
            @click="$emit('close')">
            {{ t("navigation.allSections") }}
          </NuxtLink>
        </aside>
      </div>
    </div>
  </Transition>
</template>

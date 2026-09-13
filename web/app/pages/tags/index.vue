<script setup lang="ts">
  import { DEMO_TAGS } from "~/utils/demoTags"

  // Состояние поиска
  const searchQuery = ref("")

  // Фильтрация тегов по поисковому запросу
  const filteredTags = computed(() => {
    if (!searchQuery.value) {
      return DEMO_TAGS
    }

    return DEMO_TAGS.filter((tag) => tag.name.toLowerCase().includes(searchQuery.value.toLowerCase()))
  })
</script>

<template>
  <div class="min-h-[calc(100vh-60px)] py-8">
    <div>
      <Input
        v-model="searchQuery"
        mode="underlined"
        class="ring-0 border-b bg-transparent dark:bg-transparent border-zinc-200 dark:border-zinc-800"
        class-input="!font-garamond-libre text-zinc-600 text-3xl text-center h-max"
        height="90px"
        placeholder="Найти..."></Input>
      <TransitionGroup
        name="tag-list"
        tag="div"
        class="flex flex-wrap justify-center items-center gap-5 sm:gap-10 p-3"
        :class="[filteredTags.length < 20 ? 'my-15 sm:my-70' : '']">
        <NuxtLink
          v-for="tag in filteredTags"
          :key="tag.slug"
          :to="`/tags/${tag.slug}`"
          class="group px-8 py-4 sm:px-10 sm:py-6 transition-all duration-200">
          <span
            :class="[
              'font-garamond-libre text-xl font-light leading-tight',
              'text-zinc-500 group-hover:text-zinc-900 dark:text-zinc-500 group-hover:dark:text-zinc-100',
              'transition-all duration-300',
              'inline-block group-hover:scale-150',
              filteredTags.length === 1 ? 'scale-250 group-hover:scale-250' : ''
            ]"
            style="transform-origin: center">
            {{ tag.name }}
          </span>
        </NuxtLink>
      </TransitionGroup>
    </div>
  </div>
</template>

<style scoped>
  /* Анимации для TransitionGroup */
  .tag-list-enter-active,
  .tag-list-leave-active {
    transition: all 0.6s ease;
  }

  .tag-list-enter-from {
    opacity: 0;
    transform: scale(0.8) translateY(-20px);
  }

  .tag-list-leave-to {
    opacity: 0;
    transform: scale(0.8) translateY(20px);
  }

  .tag-list-move {
    transition: transform 0.6s ease;
  }

  /* Обеспечиваем правильное позиционирование для flex-wrap */
  .tag-list-enter-active,
  .tag-list-leave-active {
    position: absolute;
  }

  .tag-list-leave-active {
    position: absolute;
    z-index: 0;
  }

  .tag-list-enter-active {
    position: relative;
    z-index: 1;
  }
</style>

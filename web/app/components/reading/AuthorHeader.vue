<script setup lang="ts">
  /**
   * Шапка страницы автора (`docs/spec/20-public/author.md` §5 зона 2): аватар или инициалы,
   * имя, бейдж уровня, хэндл, «о себе», ссылки на соцсети, «публикуется с {месяц год}» и
   * число материалов. Плана, срока, роли и e-mail публичный тип не содержит (ADR-0018).
   *
   * Подписки здесь нет: кнопка и число подписчиков — этап 3 и F-10 (§1, §6).
   *
   * «О себе» выводится текстом, а не разметкой: описание приходит из профиля автора, и
   * доверять ему как HTML нельзя.
   */
  const props = defineProps<{
    author: {
      handle: string
      name: string
      avatar?: string | null
      bio?: string | null
      grade: "standard" | "pro"
      links: readonly { kind: string; url: string }[]
    }
    /** «Публикуется с {месяц год}»; пусто, если даты первой публикации нет. */
    sinceLabel?: string | null
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
  <header class="w-full border-b border-zinc-200 pb-8 pt-12 sm:pb-6 sm:pt-10 md:pb-10 md:pt-14 dark:border-zinc-800">
    <div class="flex flex-col items-center gap-6 text-center md:flex-row md:items-start md:gap-10 md:text-left">
      <NuxtImg
        v-if="author.avatar"
        :src="author.avatar"
        :alt="author.name"
        width="128"
        height="128"
        class="size-32 shrink-0 rounded-full object-cover" />
      <span
        v-else
        aria-hidden="true"
        class="flex size-32 shrink-0 items-center justify-center rounded-full bg-zinc-100 font-waterway text-3xl text-zinc-500 dark:bg-zinc-900 dark:text-zinc-400">
        {{ initials }}
      </span>

      <div class="flex flex-1 flex-col gap-3">
        <div class="flex flex-col items-center gap-2 md:flex-row md:items-baseline">
          <h1 class="font-waterway text-3xl font-bold tracking-widest text-zinc-900 md:text-4xl dark:text-zinc-100">
            {{ author.name }}
          </h1>
          <ReadingProBadge v-if="author.grade === 'pro'" />
          <span class="font-sans text-xs text-zinc-500 dark:text-zinc-500">@{{ author.handle }}</span>
        </div>

        <p v-if="author.bio" class="max-w-3xl font-garamond-libre text-lg text-zinc-600 dark:text-zinc-400">
          {{ author.bio }}
        </p>

        <p class="font-sans text-xs font-bold uppercase tracking-wider text-zinc-500 dark:text-zinc-500">
          <span>{{ countLabel }}</span>
          <span v-if="sinceLabel"> · {{ sinceLabel }}</span>
        </p>

        <!-- Ссылки автора уводят с сайта и заполняются им самим: без передачи веса и
             реферера (`50-access/visibility.md` п. 4 о чужих адресах). -->
        <ul v-if="author.links.length" class="flex flex-wrap justify-center gap-4 md:justify-start">
          <li v-for="link in author.links" :key="link.kind">
            <a
              :href="link.url"
              target="_blank"
              rel="nofollow noopener noreferrer"
              class="font-sans text-xs font-bold uppercase tracking-wider text-zinc-600 underline underline-offset-4 transition-colors duration-300 hover:text-red-700 dark:text-zinc-400 dark:hover:text-red-400">
              {{ link.kind }}
            </a>
          </li>
        </ul>
      </div>
    </div>
  </header>
</template>

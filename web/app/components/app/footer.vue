<script setup lang="ts">
  const links = [
    { label: "О проекте", to: "/about" },
    { label: "Правила публикации", to: "/legal/content-rules" },
    { label: "Оферта", to: "/legal/paid-services" },
    { label: "Политика персональных данных", to: "/legal/privacy" },
    { label: "Возвраты", to: "/legal/refunds" },
    { label: "Реквизиты", to: "/legal/paid-services#requisites" },
    { label: "Контакты", to: "/contact" },
    { label: "RSS", to: "/rss.xml" }
  ] as const
</script>

<template>
  <footer class="border-t border-zinc-300 bg-zinc-100 dark:border-zinc-800 dark:bg-zinc-950">
    <div class="mx-auto max-w-7xl px-4 py-12 sm:px-6 lg:px-8 lg:py-16">
      <div class="grid gap-10 lg:grid-cols-[18rem_1fr] lg:gap-20">
        <div>
          <NuxtLink
            to="/"
            class="inline-flex focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-orange-600">
            <span class="sr-only">Altera — на главную</span>
            <VisualLogo />
          </NuxtLink>
          <p class="mt-5 max-w-xs font-garamond-libre text-lg leading-relaxed text-zinc-600 dark:text-zinc-400">
            Журнал о культуре, искусстве, спорте, музыке, фотографии, путешествиях и человеческой мысли.
          </p>
        </div>

        <nav aria-label="Ссылки в подвале">
          <ul class="grid grid-cols-1 border-t border-zinc-300 sm:grid-cols-2 lg:grid-cols-3 dark:border-zinc-800">
            <li v-for="link in links" :key="link.to" class="border-b border-zinc-300 dark:border-zinc-800">
              <NuxtLink
                :to="link.to"
                class="flex min-h-12 items-center py-2 font-sans text-sm font-medium text-zinc-700 hover:text-orange-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-orange-600 dark:text-zinc-300 dark:hover:text-orange-400">
                {{ link.label }}
              </NuxtLink>
            </li>
          </ul>
        </nav>
      </div>

      <p class="mt-12 border-t border-zinc-300 pt-6 font-sans text-xs text-zinc-500 dark:border-zinc-800">
        © 2026 Altera
      </p>
    </div>
  </footer>
</template>

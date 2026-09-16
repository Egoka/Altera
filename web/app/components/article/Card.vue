<script setup lang="ts">
  import { computed } from "vue"
  import type { ArticleCardMedia, ArticleCardVariant, ReadingArticle } from "~/types/reading"
  import ReadingBookmarkButton from "~/components/reading/BookmarkButton.vue"
  import ReadingByline from "~/components/reading/Byline.vue"
  import ReadingDateStamp from "~/components/reading/DateStamp.vue"
  import ReadingProBadge from "~/components/reading/ProBadge.vue"
  import ReadingSectionKicker from "~/components/reading/SectionKicker.vue"

  const props = withDefaults(
    defineProps<{
      article: ReadingArticle
      variant?: ArticleCardVariant
      media?: ArticleCardMedia
      rank?: number
      bookmarked?: boolean
      bookmarkBusy?: boolean
      canBookmark?: boolean
      guest?: boolean
      loginPath?: string
      locale?: "ru" | "en"
    }>(),
    {
      variant: "large",
      media: "above",
      rank: 1,
      bookmarked: false,
      bookmarkBusy: false,
      canBookmark: false,
      guest: false,
      loginPath: "/login",
      locale: "ru"
    }
  )

  const emit = defineEmits<{ bookmark: [bookmarked: boolean] }>()
  const { t } = useI18n()
  const articlePath = computed(() =>
    props.article.section ? `/${props.article.section.slug}/${props.article.slug}` : ""
  )
  const showsBookmark = computed(() => props.canBookmark || props.guest)
  const showImage = computed(() => props.variant !== "rank" && Boolean(props.article.featuredImage))
  const isBeside = computed(() => props.variant === "small" || (props.variant === "large" && props.media === "beside"))
</script>

<template>
  <article
    v-if="articlePath"
    :data-variant="variant"
    :class="[
      'group relative border-zinc-200 dark:border-zinc-800',
      variant === 'rank' ? 'grid grid-cols-[3.5rem_1fr] gap-4 border-t py-5' : '',
      isBeside ? 'grid grid-cols-[minmax(0,1fr)_7rem] gap-5 sm:grid-cols-2' : ''
    ]">
    <div
      v-if="variant === 'rank'"
      class="font-waterway text-right text-5xl leading-none text-zinc-300 dark:text-zinc-700">
      {{ rank }}
    </div>

    <figure
      v-if="showImage"
      :class="[
        'overflow-hidden bg-zinc-100 dark:bg-zinc-900',
        variant === 'lede' ? 'mb-8 aspect-square sm:aspect-2/1' : '',
        variant === 'large' && !isBeside ? 'mb-5 aspect-3/2' : '',
        isBeside ? 'order-2 aspect-3/2 self-start' : ''
      ]">
      <NuxtLink
        :to="articlePath"
        class="block h-full focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-orange-600">
        <NuxtImg
          :src="article.featuredImage ?? undefined"
          :alt="article.title"
          class="h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.02] motion-reduce:transition-none motion-reduce:group-hover:scale-100" />
      </NuxtLink>
    </figure>

    <div :class="[isBeside ? 'order-1' : '', variant === 'lede' ? 'mx-auto max-w-4xl text-center' : '']">
      <div
        v-if="article.section || article.isTranslation"
        :class="['mb-2 flex flex-wrap items-center gap-2', variant === 'lede' ? 'justify-center' : '']">
        <ReadingSectionKicker v-if="article.section" :name="article.section.name" :slug="article.section.slug" />
        <span
          v-if="article.isTranslation"
          class="font-sans text-[0.6875rem] font-semibold uppercase tracking-wider text-zinc-500">
          {{ t("reading.translation") }}
        </span>
      </div>

      <h2
        :class="[
          'font-garamond-libre font-bold text-zinc-950 dark:text-zinc-100',
          variant === 'lede' ? 'text-title md:text-lede' : '',
          variant === 'large' ? 'text-card md:text-title' : '',
          variant === 'small' ? 'text-card leading-tight' : '',
          variant === 'rank' ? 'text-xl leading-tight' : ''
        ]">
        <NuxtLink
          :to="articlePath"
          class="underline-offset-4 transition-colors hover:text-orange-700 hover:underline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-orange-600 motion-reduce:transition-none dark:hover:text-orange-400">
          {{ article.title }}
        </NuxtLink>
      </h2>

      <p
        v-if="article.dek && (variant === 'lede' || variant === 'large')"
        :class="[
          'mt-2 line-clamp-2 font-garamond-libre text-zinc-600 dark:text-zinc-400',
          variant === 'lede' ? 'text-card-dek md:text-title-compact' : 'text-card-dek'
        ]">
        {{ article.dek }}
      </p>

      <div :class="['mt-4 flex flex-wrap items-center gap-x-2 gap-y-1', variant === 'lede' ? 'justify-center' : '']">
        <ReadingByline :name="article.author.name" :slug="article.author.slug" />
        <ReadingProBadge v-if="article.author.grade === 'pro'" />
        <span v-if="article.publishedAt" aria-hidden="true" class="text-zinc-400">·</span>
        <ReadingDateStamp v-if="article.publishedAt" :time="article.publishedAt" :locale="locale" />
      </div>
    </div>

    <ReadingBookmarkButton
      v-if="showsBookmark"
      class="absolute right-2 top-2"
      :bookmarked="bookmarked"
      :busy="bookmarkBusy"
      :guest="guest"
      :login-path="loginPath"
      @toggle="emit('bookmark', $event)" />
  </article>
</template>

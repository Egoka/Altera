<script setup lang="ts">
  import { AddBookmarkDocument, GetMyBookmarkDocument, RemoveBookmarkDocument } from "~/graphql/generated/graphql"
  import { getArticleBookmarkState, type ArticleBookmarkState } from "~/utils/bookmarkState"
  import ReadingBookmarkButton from "~/components/reading/BookmarkButton.vue"

  const props = defineProps<{ articleId: string; loginPath?: string }>()

  const state = ref<ArticleBookmarkState>({ kind: "hidden" })
  const busy = ref(false)

  const { data } = await useAsyncData(
    () => `article-bookmark:${props.articleId}`,
    async () => getArticleBookmarkState(await useGraphQL(GetMyBookmarkDocument, { articleId: props.articleId })),
    { server: false, watch: [() => props.articleId] }
  )

  watch(data, (next) => (state.value = next ?? { kind: "hidden" }), { immediate: true })

  const toggle = async (next: boolean) => {
    if (busy.value || state.value.kind !== "owner") return
    busy.value = true
    try {
      const result = next
        ? await useGraphQL(AddBookmarkDocument, { articleId: props.articleId })
        : await useGraphQL(RemoveBookmarkDocument, { articleId: props.articleId })
      if (result.errors?.length) return
      state.value = { kind: "owner", bookmarked: next }
    } finally {
      busy.value = false
    }
  }
</script>

<template>
  <ReadingBookmarkButton
    v-if="state.kind !== 'hidden'"
    data-testid="article-bookmark"
    :bookmarked="state.kind === 'owner' && state.bookmarked"
    :busy="busy"
    :guest="state.kind === 'guest'"
    :login-path="loginPath ?? '/login'"
    @toggle="toggle" />
</template>

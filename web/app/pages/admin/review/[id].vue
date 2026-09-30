<script setup lang="ts">
  import { reactive, ref } from "vue"
  import type { ReviewAction } from "~/composables/useAdminReview"

  const { t } = useI18n()
  const route = useRoute()
  const id = String(route.params.id)
  const { item, pending, failed, canDecide, errorCode, requestId, actionPending, refresh, runAction, reply, note } =
    useAdminReviewCard(id)
  const reload = () => refresh()

  definePageMeta({ i18n: false, layout: "admin", middleware: ["admin", "admin-review"] })
  useHead({ meta: [{ name: "robots", content: "noindex,nofollow" }] })

  const activeAction = ref<ReviewAction | null>(null)
  const actionText = ref("")
  const validation = ref(false)
  const actionError = ref(false)
  const replies = reactive<Record<string, string>>({})
  const noteDraft = reactive({ revisionId: "", blockId: "", text: "" })

  const openAction = (action: ReviewAction) => {
    activeAction.value = action
    actionText.value = ""
    validation.value = false
    actionError.value = false
  }

  const submitAction = async () => {
    if (!activeAction.value) return
    if (["rework", "unpublish"].includes(activeAction.value) && !actionText.value.trim()) {
      validation.value = true
      return
    }
    validation.value = false
    actionError.value = false
    const ok = await runAction(activeAction.value, actionText.value)
    if (!ok) {
      actionError.value = true
      return
    }
    activeAction.value = null
    actionText.value = ""
  }

  const sendReply = async (decisionId: string) => {
    const text = replies[decisionId]?.trim()
    if (!text || !(await reply(decisionId, text))) return
    replies[decisionId] = ""
  }

  const addNote = async () => {
    if (!item.value || !noteDraft.revisionId || !noteDraft.blockId.trim() || !noteDraft.text.trim()) return
    const ok = await note({
      translationId: item.value.id,
      revisionId: noteDraft.revisionId,
      blockId: noteDraft.blockId.trim(),
      text: noteDraft.text.trim()
    })
    if (ok) Object.assign(noteDraft, { revisionId: "", blockId: "", text: "" })
  }
</script>

<template>
  <section
    class="min-h-full overflow-y-auto bg-zinc-50 px-4 py-6 dark:bg-zinc-950 sm:px-6 lg:px-8"
    aria-labelledby="review-card-title">
    <NuxtLink to="/admin/review" class="font-sans text-sm text-zinc-500 underline underline-offset-4"
      >← {{ t("admin.review.back") }}</NuxtLink
    >

    <div v-if="pending" data-review-state="loading" aria-busy="true" class="mt-6 space-y-4">
      <div class="h-10 w-2/3 animate-pulse bg-zinc-200 dark:bg-zinc-800" />
      <div class="h-48 animate-pulse bg-zinc-200 dark:bg-zinc-800" />
    </div>
    <div
      v-else-if="failed"
      data-review-state="error"
      class="mt-6 border border-red-300 bg-red-50 p-5 dark:border-red-800 dark:bg-red-950">
      <p>{{ t("admin.review.cardError") }}</p>
      <p v-if="requestId" class="mt-1 font-mono text-xs">{{ requestId }}</p>
      <button type="button" class="mt-4 min-h-11 border border-zinc-950 px-4 dark:border-white" @click="reload">
        {{ t("common.retry") }}
      </button>
    </div>

    <template v-else-if="item">
      <header class="mt-6 border-b border-zinc-200 pb-6 dark:border-zinc-800">
        <div class="mb-3 flex flex-wrap items-center gap-2 font-mono text-xs uppercase tracking-wider text-zinc-500">
          <span>{{ item.locale }}</span
          ><span>·</span><span>{{ t(`admin.review.state.${item.state ?? item.status}`) }}</span
          ><span>·</span><span>{{ item.readCount }} {{ t("admin.review.readsShort") }}</span>
        </div>
        <h1
          id="review-card-title"
          class="max-w-4xl font-serif text-3xl leading-tight text-zinc-950 dark:text-zinc-50 sm:text-5xl">
          {{ item.title }}
        </h1>
        <p class="mt-3 font-sans text-sm text-zinc-600 dark:text-zinc-300">
          {{ item.author.name }} · @{{ item.author.handle }}
        </p>
      </header>

      <p
        v-if="!canDecide"
        data-review-readonly
        class="mt-5 border-l-2 border-amber-600 bg-amber-50 px-4 py-3 text-sm dark:bg-amber-950">
        {{ t("admin.review.readOnly") }}
      </p>

      <div v-if="errorCode === 'CONFLICT'" class="mt-5 border border-amber-500 bg-amber-50 p-4 dark:bg-amber-950">
        <p>{{ t("admin.review.conflict") }}</p>
        <button
          data-review-conflict-refresh
          type="button"
          class="mt-3 min-h-11 border border-zinc-950 px-4 dark:border-white"
          @click="reload">
          {{ t("admin.review.refresh") }}
        </button>
      </div>

      <div v-if="canDecide" data-review-actions class="mt-6 flex flex-wrap gap-2">
        <button
          v-if="item.state === 'queued'"
          type="button"
          class="min-h-11 bg-zinc-950 px-4 text-white dark:bg-white dark:text-zinc-950"
          @click="runAction('claim')">
          {{ t("admin.review.claim") }}
        </button>
        <button
          v-if="item.reviewer?.mine"
          type="button"
          class="min-h-11 border border-zinc-400 px-4"
          @click="runAction('release')">
          {{ t("admin.review.release") }}
        </button>
        <template v-if="item.reviewer?.mine">
          <button
            data-review-open-action="rework"
            type="button"
            class="min-h-11 border border-amber-700 px-4 text-amber-800 dark:text-amber-300"
            @click="openAction('rework')">
            {{ t("admin.review.rework") }}
          </button>
          <button
            data-review-open-action="publish"
            type="button"
            class="min-h-11 bg-emerald-700 px-4 text-white"
            @click="openAction('publish')">
            {{ t("admin.review.publish") }}
          </button>
          <button
            data-review-open-action="reject"
            type="button"
            class="min-h-11 border border-red-700 px-4 text-red-700"
            @click="openAction('reject')">
            {{ t("admin.review.finalReject") }}
          </button>
        </template>
        <button
          v-if="item.status === 'published'"
          data-review-open-action="unpublish"
          type="button"
          class="min-h-11 border border-red-700 px-4 text-red-700"
          @click="openAction('unpublish')">
          {{ t("admin.review.unpublish") }}
        </button>
      </div>

      <div class="mt-8 grid gap-6 xl:grid-cols-[minmax(0,1.5fr)_minmax(20rem,0.75fr)]">
        <article class="border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900">
          <h2 class="font-serif text-2xl">{{ t("admin.review.content") }}</h2>
          <pre
            class="mt-4 max-h-[36rem] overflow-auto whitespace-pre-wrap font-mono text-xs leading-6 text-zinc-700 dark:text-zinc-300"
            >{{ JSON.stringify(item.body, null, 2) }}</pre
          >
        </article>

        <aside class="space-y-6">
          <section class="border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900">
            <h2 class="font-serif text-xl">{{ t("admin.review.aiDecision") }}</h2>
            <p class="mt-2 font-mono text-sm">{{ item.aiDecision?.verdict ?? "—" }}</p>
            <pre
              v-if="item.aiDecision?.reasons"
              class="mt-3 whitespace-pre-wrap text-xs text-zinc-600 dark:text-zinc-300"
              >{{ JSON.stringify(item.aiDecision.reasons, null, 2) }}</pre
            >
          </section>

          <section class="border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900">
            <h2 class="font-serif text-xl">{{ t("admin.review.history") }}</h2>
            <p v-if="!item.decisions.length" class="mt-3 text-sm text-zinc-500">{{ t("admin.review.noHistory") }}</p>
            <ol v-else class="mt-4 space-y-5">
              <li
                v-for="decision in item.decisions"
                :key="decision.id"
                class="border-l-2 border-zinc-300 pl-4 dark:border-zinc-700">
                <p class="text-xs uppercase tracking-wide text-zinc-500">
                  {{ t(`admin.review.decision.${decision.kind}`) }}
                </p>
                <p v-if="decision.recommendations" class="mt-1 text-sm">{{ decision.recommendations }}</p>
                <p v-if="decision.text" class="mt-1 text-sm">{{ decision.text }}</p>
                <p
                  v-for="message in decision.replies"
                  :key="message.id"
                  class="mt-2 bg-zinc-100 p-2 text-sm dark:bg-zinc-800">
                  {{ message.text }}
                </p>
                <form v-if="canDecide" class="mt-3 flex gap-2" @submit.prevent="sendReply(decision.id)">
                  <input
                    v-model="replies[decision.id]"
                    class="min-h-11 min-w-0 flex-1 border border-zinc-300 bg-transparent px-3"
                    :aria-label="t('admin.review.reply')" />
                  <button type="submit" class="min-h-11 border border-zinc-950 px-3 dark:border-white">
                    {{ t("admin.review.send") }}
                  </button>
                </form>
              </li>
            </ol>
          </section>

          <form
            v-if="canDecide && item.revisions.length"
            class="border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900"
            @submit.prevent="addNote">
            <h2 class="font-serif text-xl">{{ t("admin.review.blockNote") }}</h2>
            <select
              v-model="noteDraft.revisionId"
              required
              class="mt-3 min-h-11 w-full border border-zinc-300 bg-transparent px-3">
              <option value="" disabled>{{ t("admin.review.revision") }}</option>
              <option v-for="revision in item.revisions" :key="revision.id" :value="revision.id">
                {{ revision.title }} · {{ revision.createdAt }}
              </option>
            </select>
            <input
              v-model="noteDraft.blockId"
              required
              class="mt-3 min-h-11 w-full border border-zinc-300 bg-transparent px-3"
              :placeholder="t('admin.review.blockId')" />
            <textarea
              v-model="noteDraft.text"
              required
              class="mt-3 min-h-24 w-full border border-zinc-300 bg-transparent p-3"
              :placeholder="t('admin.review.noteText')" />
            <button type="submit" class="mt-3 min-h-11 bg-zinc-950 px-4 text-white dark:bg-white dark:text-zinc-950">
              {{ t("admin.review.addNote") }}
            </button>
          </form>
        </aside>
      </div>

      <div
        v-if="activeAction"
        class="fixed inset-0 z-50 grid place-items-center bg-black/55 p-4"
        role="presentation"
        @click.self="activeAction = null">
        <section
          role="dialog"
          aria-modal="true"
          class="w-full max-w-lg border border-zinc-300 bg-white p-6 shadow-2xl dark:border-zinc-700 dark:bg-zinc-900">
          <h2 class="font-serif text-2xl">{{ t(`admin.review.action.${activeAction}`) }}</h2>
          <p
            v-if="activeAction === 'publish' && item.aiDecision?.verdict && item.aiDecision.verdict !== 'publish'"
            class="mt-3 border-l-2 border-amber-600 bg-amber-50 px-3 py-2 text-sm dark:bg-amber-950">
            {{ t("admin.review.aiOverrideWarning") }}
          </p>
          <textarea
            v-model="actionText"
            data-review-action-text
            class="mt-4 min-h-32 w-full border border-zinc-300 bg-transparent p-3"
            :placeholder="t(`admin.review.actionText.${activeAction}`)" />
          <p v-if="validation" data-review-validation class="mt-2 text-sm text-red-700">
            {{ t("admin.review.requiredText") }}
          </p>
          <p v-if="actionError" data-review-action-error class="mt-2 text-sm text-red-700">
            {{ t("admin.review.actionError") }}<span v-if="requestId"> · {{ requestId }}</span>
          </p>
          <div class="mt-5 flex justify-end gap-2">
            <button type="button" class="min-h-11 border border-zinc-400 px-4" @click="activeAction = null">
              {{ t("common.cancel") }}
            </button>
            <button
              data-review-submit
              type="button"
              :disabled="actionPending"
              class="min-h-11 bg-zinc-950 px-4 text-white disabled:opacity-50 dark:bg-white dark:text-zinc-950"
              @click="submitAction">
              {{ t("admin.review.confirm") }}
            </button>
          </div>
        </section>
      </div>
    </template>
  </section>
</template>

<script setup lang="ts">
  import { print } from "graphql"
  import {
    CheckHandleDocument,
    GetMyProfileDocument,
    RemoveAvatarDocument,
    UpdateProfileDocument,
    UploadAvatarDocument,
    type GetMyProfileQuery
  } from "~/graphql/generated/graphql"

  definePageMeta({ i18n: false, layout: "auth", requiresAuth: true })

  type Profile = NonNullable<GetMyProfileQuery["me"]>
  type PageState = "loading" | "data_error" | "forbidden" | "ready"
  interface GraphQLErrorLike {
    extensions?: Record<string, unknown> | null
  }

  const { t, locale } = useI18n()
  useHead({
    title: () => `${t("account.profile.pageTitle")} — Altera`,
    meta: [{ name: "robots", content: "noindex, nofollow" }]
  })

  const readProfile = async (): Promise<Profile | null> => {
    const result = await useGraphQL(GetMyProfileDocument)
    const error = result.errors?.[0] as GraphQLErrorLike | undefined
    if (!result.data?.me) {
      if (error?.extensions?.code === "UNAUTHENTICATED") {
        await navigateTo({ path: "/login", query: { next: "/me/settings" } }, { replace: true })
        return null
      }
      if (error?.extensions?.code === "FORBIDDEN") {
        await navigateTo("/me/archived", { replace: true })
        return null
      }
      throw createError({ statusCode: 500, statusMessage: "profile" })
    }
    if (result.data.me.archivedAt) {
      await navigateTo("/me/archived", { replace: true })
      return null
    }
    return result.data.me
  }

  const { data, error, status, refresh } = await useAsyncData("my-profile", readProfile, { server: false })
  const view = ref<Profile | null>(null)
  watch(data, (next) => (view.value = next ?? view.value), { immediate: true })

  const name = ref("")
  const handle = ref("")
  const bio = ref("")
  const site = ref("")
  const language = ref<"ru" | "en">("ru")
  const initialHandle = ref("")
  watch(
    view,
    (next) => {
      if (!next) return
      name.value = next.pendingName ?? next.name
      handle.value = next.handle
      initialHandle.value = next.handle
      bio.value = next.bio ?? ""
      site.value =
        typeof next.socialLinks === "object" && next.socialLinks && "site" in next.socialLinks
          ? String((next.socialLinks as { site?: unknown }).site ?? "")
          : ""
      language.value = next.locale
    },
    { immediate: true }
  )

  const pageState = computed<PageState>(() => {
    if (error.value) return "data_error"
    if (!view.value || status.value === "pending") return "loading"
    if (!(["reader", "author"] as string[]).includes(view.value.role)) return "forbidden"
    return "ready"
  })
  const publishReady = computed(() => Boolean(view.value?.name.trim() && view.value?.handleConfirmed))
  const initials = computed(() => (view.value?.name || view.value?.handle || "A").trim().slice(0, 1).toUpperCase())
  const handleState = ref<"idle" | "checking" | "available" | "taken" | "invalid">("idle")
  const busy = ref(false)
  const saved = ref(false)
  const mutationError = ref<string | null>(null)

  const checkChangedHandle = async () => {
    const candidate = handle.value.trim()
    if (candidate === initialHandle.value) {
      handleState.value = "available"
      return
    }
    if (!/^[a-z0-9-]{3,32}$/.test(candidate)) {
      handleState.value = "invalid"
      return
    }
    handleState.value = "checking"
    const result = await useGraphQL(CheckHandleDocument, { handle: candidate })
    handleState.value = result.data?.checkHandle.available ? "available" : "taken"
  }

  const applyProfile = (next: Partial<Profile> & Pick<Profile, "handle" | "locale">) => {
    view.value = { ...view.value!, ...next }
    initialHandle.value = next.handle
    locale.value = next.locale
  }

  const save = async () => {
    if (busy.value) return
    saved.value = false
    mutationError.value = null
    await checkChangedHandle()
    if (handleState.value === "taken" || handleState.value === "invalid") return
    busy.value = true
    try {
      const result = await useGraphQL(UpdateProfileDocument, {
        input: {
          name: name.value,
          handle: handle.value.trim(),
          bio: bio.value || null,
          socialLinks: site.value ? { site: site.value } : null,
          locale: language.value
        }
      })
      if (!result.data?.updateProfile) {
        const extension = (result.errors?.[0] as GraphQLErrorLike | undefined)?.extensions
        handleState.value = extension?.entity === "handle" ? "taken" : handleState.value
        mutationError.value = String(extension?.code ?? "INTERNAL_ERROR")
        return
      }
      applyProfile(result.data.updateProfile)
      saved.value = true
    } catch {
      mutationError.value = "INTERNAL_ERROR"
    } finally {
      busy.value = false
    }
  }

  const selectedAvatar = ref<File | null>(null)
  const avatarBusy = ref(false)
  const chooseAvatar = (event: Event) => {
    selectedAvatar.value = (event.target as HTMLInputElement).files?.[0] ?? null
  }
  const uploadAvatar = async () => {
    if (!selectedAvatar.value || avatarBusy.value) return
    avatarBusy.value = true
    try {
      const body = new FormData()
      body.set("operations", JSON.stringify({ query: print(UploadAvatarDocument), variables: { file: null } }))
      body.set("map", JSON.stringify({ 0: ["variables.file"] }))
      body.set("0", selectedAvatar.value)
      const result = await useRequestFetch()<{
        data?: { uploadAvatar?: { assetId: string; url: string } | null }
      }>("/api/graphql", { method: "POST", body })
      if (result.data?.uploadAvatar && view.value) {
        selectedAvatar.value = null
        await refresh()
      }
    } finally {
      avatarBusy.value = false
    }
  }
  const removeAvatar = async () => {
    if (avatarBusy.value) return
    avatarBusy.value = true
    try {
      const result = await useGraphQL(RemoveAvatarDocument)
      if (result.data) await refresh()
    } finally {
      avatarBusy.value = false
    }
  }
</script>

<template>
  <main class="mx-auto flex w-full max-w-3xl flex-col gap-10 px-4 py-16" :data-profile-state="pageState">
    <header class="flex flex-col gap-3 border-b border-zinc-200 pb-8 dark:border-zinc-800">
      <p class="font-sans text-xs font-semibold uppercase tracking-[0.18em] text-orange-700 dark:text-orange-400">
        {{ t("account.profile.eyebrow") }}
      </p>
      <h1 class="font-serif text-4xl text-zinc-950 dark:text-zinc-50">{{ t("account.profile.pageTitle") }}</h1>
      <p class="max-w-2xl font-sans text-base text-zinc-600 dark:text-zinc-400">{{ t("account.profile.lead") }}</p>
    </header>

    <div v-if="pageState === 'loading'" data-testid="profile-skeleton" class="grid gap-4">
      <span v-for="item in 4" :key="item" class="h-12 animate-pulse rounded bg-zinc-200 dark:bg-zinc-800" />
    </div>
    <div v-else-if="pageState === 'data_error'" role="alert" class="grid gap-3">
      <p>{{ t("account.profile.error.dataUnavailable") }}</p>
      <button class="justify-self-start underline" type="button" @click="refresh()">
        {{ t("account.profile.retry") }}
      </button>
    </div>
    <div v-else-if="pageState === 'forbidden'" role="alert">{{ t("account.profile.error.forbidden") }}</div>

    <template v-else-if="view">
      <aside class="grid gap-4 border-l-4 border-orange-600 bg-orange-50 p-5 dark:bg-orange-950/20">
        <div class="flex items-center gap-4">
          <img v-if="view.avatar" :src="view.avatar.url" alt="" class="size-16 rounded-full object-cover" />
          <span
            v-else
            class="grid size-16 place-items-center rounded-full bg-zinc-950 font-serif text-2xl text-white"
            >{{ initials }}</span
          >
          <div>
            <p class="font-serif text-2xl text-zinc-950 dark:text-zinc-50">{{ view.name }}</p>
            <p data-testid="profile-public-url" class="font-mono text-sm text-zinc-600 dark:text-zinc-400">
              @{{ view.handle }}
            </p>
          </div>
        </div>
        <p data-testid="profile-publish-ready" :data-ready="publishReady ? 'true' : 'false'" class="font-sans text-sm">
          {{ t(publishReady ? "account.profile.publishReady" : "account.profile.publishBlocked") }}
        </p>
      </aside>

      <section class="grid gap-4">
        <h2 class="font-serif text-2xl">{{ t("account.profile.avatarTitle") }}</h2>
        <p
          v-if="view.avatarCheckStatus === 'pending'"
          data-testid="profile-avatar-status"
          class="text-sm text-amber-700">
          {{ t("account.profile.status.avatarPending") }}
        </p>
        <p
          v-else-if="view.avatarCheckStatus === 'rejected'"
          data-testid="profile-avatar-status"
          class="text-sm text-red-700">
          {{ view.avatarCheckReason || t("account.profile.status.avatarRejected") }}
        </p>
        <div class="flex flex-wrap gap-3">
          <input
            data-testid="profile-avatar-file"
            type="file"
            accept="image/jpeg,image/png,image/webp"
            @change="chooseAvatar" />
          <button
            type="button"
            class="rounded-full bg-zinc-950 px-5 py-2 text-white"
            :disabled="!selectedAvatar || avatarBusy"
            @click="uploadAvatar">
            {{ t("account.profile.avatarUpload") }}
          </button>
          <button v-if="view.avatar" type="button" class="underline" :disabled="avatarBusy" @click="removeAvatar">
            {{ t("account.profile.avatarRemove") }}
          </button>
        </div>
      </section>

      <form data-testid="profile-form" class="grid gap-8" @submit.prevent="save">
        <label class="grid gap-2 font-sans text-sm font-semibold"
          >{{ t("account.profile.name")
          }}<input
            v-model="name"
            data-testid="profile-name"
            required
            class="min-h-11 border border-zinc-300 bg-transparent px-3 font-normal"
        /></label>
        <p
          v-if="view.nameCheckStatus === 'pending'"
          data-testid="profile-name-status"
          class="-mt-6 text-sm text-amber-700">
          {{ t("account.profile.status.namePending") }}
        </p>
        <p
          v-else-if="view.nameCheckStatus === 'rejected'"
          data-testid="profile-name-status"
          class="-mt-6 text-sm text-red-700">
          {{ view.nameCheckReason || t("account.profile.status.nameRejected") }}
        </p>

        <label class="grid gap-2 font-sans text-sm font-semibold"
          >{{ t("account.profile.handle")
          }}<span class="flex items-center border border-zinc-300 px-3"
            ><span class="text-zinc-500">@</span
            ><input
              v-model="handle"
              data-testid="profile-handle"
              required
              pattern="[a-z0-9-]{3,32}"
              class="min-h-11 flex-1 bg-transparent px-1 font-mono font-normal"
              @blur="checkChangedHandle" /></span
        ></label>
        <p
          v-if="handleState !== 'idle'"
          data-testid="profile-handle-status"
          class="-mt-6 text-sm"
          :class="handleState === 'taken' || handleState === 'invalid' ? 'text-red-700' : 'text-emerald-700'">
          {{ t(`account.profile.handle${handleState[0]!.toUpperCase()}${handleState.slice(1)}`) }}
        </p>

        <label class="grid gap-2 font-sans text-sm font-semibold"
          >{{ t("account.profile.bio")
          }}<textarea v-model="bio" rows="5" class="border border-zinc-300 bg-transparent p-3 font-normal" />
        </label>
        <label class="grid gap-2 font-sans text-sm font-semibold"
          >{{ t("account.profile.site")
          }}<input
            v-model="site"
            type="url"
            placeholder="https://"
            class="min-h-11 border border-zinc-300 bg-transparent px-3 font-normal"
        /></label>
        <label class="grid gap-2 font-sans text-sm font-semibold"
          >{{ t("account.profile.language")
          }}<select v-model="language" class="min-h-11 border border-zinc-300 bg-transparent px-3 font-normal">
            <option value="ru">{{ t("account.profile.languageRu") }}</option>
            <option value="en">{{ t("account.profile.languageEn") }}</option>
          </select></label
        >

        <p v-if="mutationError" role="alert" class="text-sm text-red-700">{{ t("account.profile.error.save") }}</p>
        <p v-if="saved" data-testid="profile-saved" class="text-sm text-emerald-700">
          {{ t("account.profile.saved") }}
        </p>
        <div
          class="sticky bottom-4 flex justify-end rounded-full bg-white/90 p-2 shadow-lg backdrop-blur dark:bg-zinc-950/90">
          <button
            type="submit"
            :disabled="busy"
            class="min-h-11 rounded-full bg-orange-600 px-7 font-sans font-semibold text-white disabled:opacity-50">
            {{ busy ? t("account.profile.saving") : t("account.profile.save") }}
          </button>
        </div>
      </form>

      <nav class="flex flex-wrap gap-x-6 gap-y-2 border-t border-zinc-200 pt-6 text-sm dark:border-zinc-800">
        <NuxtLink to="/me/email" class="underline">{{ t("account.dashboard.links.email") }}</NuxtLink>
        <NuxtLink to="/me/password" class="underline">{{ t("account.dashboard.links.password") }}</NuxtLink>
        <NuxtLink to="/me/sessions" class="underline">{{ t("account.dashboard.links.sessions") }}</NuxtLink>
      </nav>
    </template>
  </main>
</template>

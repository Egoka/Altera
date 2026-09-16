<template>
  <NuxtLink
    :to="targetPath"
    :aria-label="ariaLabel"
    class="px-2 py-3.5 text-sm/6 font-semibold text-zinc-900 dark:text-zinc-300">
    {{ compact ? targetLocale.toUpperCase() : targetName }}
  </NuxtLink>
</template>

<script setup lang="ts">
  import { computed } from "vue"
  import type { LocaleCode, PublishedSiblingPath } from "~/utils/localeRoute"
  import { resolveLocaleSwitchPath } from "~/utils/localeRoute"

  const props = withDefaults(
    defineProps<{
      compact?: boolean
      publishedSiblingPath?: PublishedSiblingPath
    }>(),
    { compact: false }
  )

  const { locale, locales, t } = useI18n()
  const switchLocalePath = useSwitchLocalePath()
  const targetLocale = computed<LocaleCode>(() => (locale.value === "ru" ? "en" : "ru"))
  const targetName = computed(() => {
    const target = locales.value.find((item) => (typeof item === "string" ? item : item.code) === targetLocale.value)

    if (typeof target === "object" && target.name) return target.name
    return targetLocale.value.toUpperCase()
  })
  const targetPath = computed(() =>
    resolveLocaleSwitchPath({
      targetLocale: targetLocale.value,
      publishedSiblingPath: props.publishedSiblingPath,
      staticLocalePath: switchLocalePath(targetLocale.value)
    })
  )
  const ariaLabel = computed(() => t("language.switchTo", { language: targetName.value }))
</script>

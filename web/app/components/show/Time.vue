<script setup lang="ts">
  import { format, parseISO } from "date-fns"

  const props = defineProps<{
    time: Date | string
    formatStr?: string
  }>()
  const formatDate = computed(() => props?.formatStr ?? "MMMM d, yyyy")
  const formattedDate = computed(() => {
    if (props.time) {
      return format(typeof props.time === "string" ? parseISO(props.time) : props.time, formatDate.value)
    }
    return ""
  })
</script>

<template>
  <time
    v-if="formattedDate"
    :class="['font-sans uppercase text-xs/6 font-bold', 'text-red-500/80 dark:text-red-600/80']"
    :time="formattedDate"
    :format-str="formatDate">
    {{ formattedDate }}
  </time>
</template>

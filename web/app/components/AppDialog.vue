<script setup lang="ts">
  import FishtDialog, { type DialogEmits, type DialogProps } from "fishtvue/dialog"
  import { computed } from "vue"

  defineOptions({ inheritAttrs: false })

  const props = defineProps<DialogProps>()
  const emit = defineEmits<DialogEmits>()

  // С fishtvue 1.0 `class` адресует корень диалога, а карточку — `classes.content`.
  // Токены `.app-dialog` (main.css) описывают именно карточку.
  const classes = computed(() => {
    const content = props.classes?.content
    return {
      ...props.classes,
      content: ["app-dialog", ...(Array.isArray(content) ? content : content ? [content] : [])]
    }
  })
</script>

<template>
  <FishtDialog
    v-bind="{ ...props, ...$attrs }"
    :classes="classes"
    data-app-dialog
    @update:model-value="emit('update:modelValue', $event)">
    <template v-for="(_, slotName) in $slots" #[slotName]="slotProps">
      <slot :name="slotName" v-bind="slotProps ?? {}" />
    </template>
  </FishtDialog>
</template>

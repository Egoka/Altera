<script setup lang="ts">
  import FishtDialog, { type DialogEmits, type DialogProps } from "fishtvue/dialog"

  defineOptions({ inheritAttrs: false })

  const props = defineProps<DialogProps>()
  const emit = defineEmits<DialogEmits>()
</script>

<template>
  <FishtDialog
    v-bind="{ ...props, ...$attrs }"
    :class="['app-dialog', ...(Array.isArray(props.class) ? props.class : props.class ? [props.class] : [])]"
    data-app-dialog
    @update:model-value="emit('update:modelValue', $event)">
    <template v-for="(_, slotName) in $slots" #[slotName]="slotProps">
      <slot :name="slotName" v-bind="slotProps ?? {}" />
    </template>
  </FishtDialog>
</template>

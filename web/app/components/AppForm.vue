<script setup lang="ts">
  import FishtForm, { type FormProps } from "fishtvue/form"

  defineOptions({ inheritAttrs: false })

  const props = defineProps<FormProps>()
</script>

<template>
  <div class="app-form" data-app-form>
    <FishtForm v-bind="{ ...props, ...$attrs }">
      <template v-for="(_, slotName) in $slots" #[slotName]="slotProps">
        <slot :name="slotName" v-bind="slotProps ?? {}" />
      </template>
    </FishtForm>
  </div>
</template>

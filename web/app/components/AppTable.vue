<script setup lang="ts">
  import FishtTable, { type TableProps } from "fishtvue/table"

  defineOptions({ inheritAttrs: false })

  const props = defineProps<TableProps>()
</script>

<template>
  <div class="app-table" data-app-table>
    <FishtTable v-bind="{ ...props, ...$attrs }">
      <template v-for="(_, slotName) in $slots" #[slotName]="slotProps">
        <slot :name="slotName" v-bind="slotProps ?? {}" />
      </template>
    </FishtTable>
  </div>
</template>

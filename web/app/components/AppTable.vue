<script setup lang="ts">
  import FishtTable, { type TableProps } from "fishtvue/table"
  import { computed, useSlots } from "vue"

  defineOptions({ inheritAttrs: false })

  const props = defineProps<TableProps>()
  const slots = useSlots()
  const { t } = useI18n()
  const forwardedSlotNames = computed(() => Object.keys(slots).filter((slotName) => slotName !== "empty"))
</script>

<template>
  <div class="app-table" data-app-table>
    <FishtTable v-bind="{ ...props, ...$attrs }">
      <template #empty>
        <slot name="empty">
          <div class="py-12 text-center space-y-1" data-app-table-empty>
            <p class="font-sans text-sm font-medium" style="color: var(--color-ink)">
              {{ t("admin.table.empty") }}
            </p>
            <p class="font-sans text-xs" style="color: var(--color-ink-muted)">
              {{ t("admin.table.emptyDesc") }}
            </p>
          </div>
        </slot>
      </template>
      <template v-for="slotName in forwardedSlotNames" #[slotName]="slotProps">
        <slot :name="slotName" v-bind="slotProps ?? {}" />
      </template>
    </FishtTable>
  </div>
</template>

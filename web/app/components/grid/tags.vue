<script setup lang="ts">
  interface Props {
    items: any[]
  }
  defineProps<Props>()
  // Определяем ширину окна для адаптивного макета
  const { width } = useWindowSize()

  // Вычисляем количество колонок в зависимости от ширины экрана
  const getColumnsCount = computed(() => {
    if (width.value < 768) return 1 // md breakpoint
    if (width.value < 1024) return 2 // lg breakpoint
    return 3
  })

  const getItemStyles = (index: number) => {
    const columnsCount = getColumnsCount.value
    const styles = ["pt-8"]

    // Границы между рядами
    styles.push("border-zinc-200 dark:border-zinc-800")

    // if (columnsCount === 1) {}

    if (columnsCount === 2) {
      if (index % 2 === 0) styles.push("mr-6")
      else styles.push("px-6 border-l")
    }

    if (columnsCount === 3) {
      const positionInRow = index % 3
      if (positionInRow === 0) styles.push("mr-6")
      else if (positionInRow === 1) styles.push("px-6 border-l")
      else styles.push("pl-6 border-l")
    }
    return styles
  }
</script>

<template>
  <div v-if="items.length" class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 max-w-7xl m-auto">
    <div v-for="(item, index) in items" :key="index" :class="getItemStyles(index)">
      <div
        :class="[
          'pb-8',
          'pb-8 border-b border-zinc-200 dark:border-zinc-800 hover:border-zinc-400 dark:hover:border-zinc-400',
          'transition-colors duration-500'
        ]">
        <slot :item="item" />
      </div>
    </div>
  </div>
</template>

<style scoped></style>

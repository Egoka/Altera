<script setup lang="ts">
  import type User from "~/types/user"

  interface Props {
    user: User
  }

  const props = defineProps<Props>()

  const isExpanded = ref(false)
  const shouldApplyLineClamp = ref(false)
  const showToggleButton = ref(false)

  // Состояние для отслеживания подписки
  const isFollowing = ref(false)

  // Реф для получения реальной высоты контента
  const bioContent = ref<HTMLElement>()
  const bioHeight = ref(0)

  const toggleExpanded = () => {
    if (isExpanded.value) {
      isExpanded.value = false
      shouldApplyLineClamp.value = true

      // Плавно прокручиваем страницу вверх при закрытии текста
      window.scrollTo({
        top: 0,
        behavior: "smooth"
      })
    } else {
      shouldApplyLineClamp.value = false
      isExpanded.value = true
    }
  }

  watch(isExpanded, (newValue) => {
    if (!newValue) {
      setTimeout(() => {
        shouldApplyLineClamp.value = false
      }, 1100)
    }
  })

  // Функция для переключения подписки
  const toggleFollow = () => {
    isFollowing.value = !isFollowing.value
  }

  // Функция для вычисления реальной высоты контента
  const calculateBioHeight = () => {
    if (bioContent.value) {
      // Временно убираем ограничения для измерения реальной высоты
      const tempStyle = bioContent.value.style
      const originalMaxHeight = tempStyle.maxHeight
      const originalOverflow = tempStyle.overflow

      tempStyle.maxHeight = "none"
      tempStyle.overflow = "visible"

      bioHeight.value = bioContent.value.scrollHeight

      showToggleButton.value = bioHeight.value > bioContent.value.offsetHeight

      // Восстанавливаем стили
      tempStyle.maxHeight = originalMaxHeight
      tempStyle.overflow = originalOverflow
    }
  }

  // Вычисляем высоту при загрузке компонента
  onMounted(() => {
    nextTick(() => {
      if (props.user.bio && props.user.bio.trim()) {
        calculateBioHeight()
      }
    })

    // Добавляем обработчик изменения размера окна
    window.addEventListener("resize", () => {
      if (props.user.bio && props.user.bio.trim()) {
        calculateBioHeight()
      }
    })
  })

  // Очищаем обработчик при размонтировании
  onUnmounted(() => {
    window.removeEventListener("resize", calculateBioHeight)
  })
</script>

<template>
  <header v-if="user" class="w-full border-b border-zinc-200 dark:border-zinc-800">
    <div class="w-full pb-8 pt-12 sm:pb-6 sm:pt-10 md:pb-10 md:pt-14">
      <div class="max-w-7xl mx-auto px-8 sm:px-10">
        <div class="flex flex-col items-center gap-6">
          <!-- Profile Image -->
          <div class="relative">
            <NuxtImg
              :alt="user.name + ' Icon'"
              class="block w-48 h-58 object-cover rounded-2xl border border-zinc-200 dark:border-zinc-700"
              :src="user.photoUrl"
              width="120"
              height="120" />
          </div>

          <!-- Name and Follow Button -->

          <h1
            class="font-waterway text-center tracking-widest text-5xl md:text-4xl sm:text-3xl font-bold text-zinc-900 dark:text-zinc-100">
            {{ user.name.toUpperCase() }}
          </h1>

          <!-- Bio Text -->
          <div v-if="user.bio && user.bio.trim()" class="max-w-3xl text-center">
            <div
              ref="bioContent"
              :class="[
                'relative overflow-hidden text-justify transition-all duration-1000',
                !(isExpanded || shouldApplyLineClamp) ? 'line-clamp-3' : ''
              ]"
              :style="{
                maxHeight: isExpanded ? `${bioHeight}px` : '5.75rem'
              }">
              <div
                class="font-garamond-libre text-xl text-zinc-600 dark:text-zinc-300 leading-relaxed"
                v-html="user.bio"></div>
            </div>

            <button
              v-show="showToggleButton"
              @click="toggleExpanded"
              class="mt-3 text-xs uppercase tracking-wide text-zinc-500 dark:text-zinc-500 font-serif hover:text-zinc-700 dark:hover:text-zinc-400 transition-colors">
              {{ isExpanded ? "read less -" : "read more +" }}
            </button>
          </div>

          <button
            @click.stop.prevent="toggleFollow"
            @mousedown.stop
            @mouseup.stop
            :class="[
              'flex items-center gap-2 pr-4 pl-3 py-1 rounded-md transition-all duration-300',
              isFollowing
                ? 'bg-zinc-100 dark:bg-zinc-800 border border-zinc-300 dark:border-zinc-600 hover:bg-zinc-200 dark:hover:bg-zinc-700'
                : 'bg-zinc-50 dark:bg-zinc-900 border border-red-500 dark:border-red-800 hover:bg-red-50 dark:hover:bg-red-950'
            ]">
            <Icon
              :name="isFollowing ? 'a-icon:round-remove-circle' : 'a-icon:round-add-circle'"
              :class="isFollowing ? 'text-zinc-600 dark:text-zinc-400' : 'text-red-500 dark:text-red-800'" />
            <span
              :class="[
                'font-serif font-medium tracking-wide',
                isFollowing ? 'text-zinc-600 dark:text-zinc-400' : 'text-red-500'
              ]">
              {{ isFollowing ? "Unfollow" : "Follow" }}
            </span>
          </button>
        </div>
      </div>
    </div>
  </header>
</template>

<style scoped></style>

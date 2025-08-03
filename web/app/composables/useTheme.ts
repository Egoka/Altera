export const useTheme = () => {
  const isDark = ref(false)

  // Инициализация темы при загрузке
  onMounted(() => {
    // Проверяем сохраненную тему в localStorage
    const savedTheme = localStorage.getItem("theme")
    if (savedTheme) {
      isDark.value = savedTheme === "dark"
    } else {
      // Если нет сохраненной темы, проверяем системную
      const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches
      isDark.value = prefersDark
    }
    applyTheme()
  })

  // Применение темы
  const applyTheme = () => {
    if (isDark.value) {
      document.documentElement.classList.add("dark")
    } else {
      document.documentElement.classList.remove("dark")
    }
    // Сохраняем в localStorage
    localStorage.setItem("theme", isDark.value ? "dark" : "light")
  }

  // Переключение темы
  const toggleTheme = () => {
    isDark.value = !isDark.value
    applyTheme()
  }

  // Установка конкретной темы
  const setTheme = (theme: "light" | "dark") => {
    isDark.value = theme === "dark"
    applyTheme()
  }

  return {
    isDark: readonly(isDark),
    toggleTheme,
    setTheme
  }
}

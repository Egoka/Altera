export const useAdminStore = defineStore("admin", {
  state: () => ({
    isMenuCollapsed: true
  }),

  getters: {
    getIsMenuCollapsed: (state) => state.isMenuCollapsed
  },

  actions: {
    setIsMenuCollapsed(value: boolean) {
      this.isMenuCollapsed = value
      // Сохраняем в localStorage
      if (import.meta.client) {
        localStorage.setItem("admin.menuCollapsed", JSON.stringify(value))
      }
    },

    toggleMenuCollapsed() {
      this.setIsMenuCollapsed(!this.isMenuCollapsed)
    },

    initFromLocalStorage() {
      if (import.meta.client) {
        const saved = localStorage.getItem("admin.menuCollapsed")
        if (saved !== null) {
          try {
            const parsed = JSON.parse(saved)
            this.isMenuCollapsed = parsed
          } catch {
            // Если не удалось распарсить, оставляем дефолтное значение
          }
        }
      }
    }
  }
})

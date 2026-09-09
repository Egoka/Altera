<script setup lang="ts">
  interface ErrorProps {
    error: {
      statusCode?: number
      statusMessage?: string
      message?: string
    }
  }

  const props = defineProps<ErrorProps>()

  const handleError = () => {
    clearError({ redirect: "/" })
  }

  const getErrorInfo = () => {
    const { error } = props

    if (error.statusCode === 404) {
      return {
        title: "Страница не найдена",
        message: "Запрашиваемая страница не существует или была перемещена.",
        icon: "🔍"
      }
    }

    if (error.statusCode === 500) {
      return {
        title: "Внутренняя ошибка сервера",
        message: "Произошла ошибка на сервере. Попробуйте обновить страницу.",
        icon: "⚙️"
      }
    }

    if (error.statusCode === 403) {
      return {
        title: "Доступ запрещен",
        message: "У вас нет прав для доступа к этой странице.",
        icon: "🚫"
      }
    }

    return {
      title: "Произошла ошибка",
      message: error.message || "Что-то пошло не так. Попробуйте обновить страницу.",
      icon: "⚠️"
    }
  }

  const errorInfo = getErrorInfo()
</script>

<template>
  <div class="error-page">
    <div class="error-container">
      <div class="error-icon">
        {{ errorInfo.icon }}
      </div>

      <h1 class="error-title">
        {{ errorInfo.title }}
      </h1>

      <p class="error-message">
        {{ errorInfo.message }}
      </p>

      <div class="error-actions">
        <button class="btn-primary" @click="handleError">Вернуться на главную</button>

        <button class="btn-secondary" @click="$router.go(-1)">Назад</button>
      </div>

      <div v-if="error.statusCode" class="error-code">Код ошибки: {{ error.statusCode }}</div>
    </div>
  </div>
</template>

<style scoped>
  .error-page {
    min-height: 100vh;
    display: flex;
    align-items: center;
    justify-content: center;
    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
    padding: 2rem;
  }

  .error-container {
    background: rgba(255, 255, 255, 0.95);
    backdrop-filter: blur(10px);
    border-radius: 20px;
    padding: 3rem;
    text-align: center;
    max-width: 500px;
    width: 100%;
    box-shadow: 0 20px 40px rgba(0, 0, 0, 0.1);
    border: 1px solid rgba(255, 255, 255, 0.2);
  }

  .error-icon {
    font-size: 4rem;
    margin-bottom: 1.5rem;
    animation: bounce 2s infinite;
  }

  .error-title {
    font-size: 2rem;
    font-weight: 700;
    color: #2d3748;
    margin-bottom: 1rem;
    line-height: 1.2;
  }

  .error-message {
    font-size: 1.1rem;
    color: #718096;
    margin-bottom: 2rem;
    line-height: 1.6;
  }

  .error-actions {
    display: flex;
    gap: 1rem;
    justify-content: center;
    margin-bottom: 2rem;
    flex-wrap: wrap;
  }

  .btn-primary {
    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
    color: white;
    border: none;
    padding: 0.75rem 1.5rem;
    border-radius: 10px;
    font-size: 1rem;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.3s ease;
    box-shadow: 0 4px 15px rgba(102, 126, 234, 0.4);
  }

  .btn-primary:hover {
    transform: translateY(-2px);
    box-shadow: 0 6px 20px rgba(102, 126, 234, 0.6);
  }

  .btn-secondary {
    background: transparent;
    color: #667eea;
    border: 2px solid #667eea;
    padding: 0.75rem 1.5rem;
    border-radius: 10px;
    font-size: 1rem;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.3s ease;
  }

  .btn-secondary:hover {
    background: #667eea;
    color: white;
    transform: translateY(-2px);
  }

  .error-code {
    font-size: 0.9rem;
    color: #a0aec0;
    font-family: "Courier New", monospace;
    padding: 0.5rem 1rem;
    background: #f7fafc;
    border-radius: 8px;
    display: inline-block;
  }

  @keyframes bounce {
    0%,
    20%,
    50%,
    80%,
    100% {
      transform: translateY(0);
    }
    40% {
      transform: translateY(-10px);
    }
    60% {
      transform: translateY(-5px);
    }
  }

  @media (max-width: 640px) {
    .error-container {
      padding: 2rem;
      margin: 1rem;
    }

    .error-title {
      font-size: 1.5rem;
    }

    .error-message {
      font-size: 1rem;
    }

    .error-actions {
      flex-direction: column;
      align-items: center;
    }

    .btn-primary,
    .btn-secondary {
      width: 100%;
      max-width: 200px;
    }
  }
</style>

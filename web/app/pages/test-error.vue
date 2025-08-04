<script setup lang="ts">
  // const router = useRouter()

  const testErrors = [
    {
      name: "404 - Страница не найдена",
      error: { statusCode: 404, message: "Запрашиваемая страница не существует" }
    },
    {
      name: "500 - Ошибка сервера",
      error: { statusCode: 500, message: "Внутренняя ошибка сервера" }
    },
    {
      name: "403 - Доступ запрещен",
      error: { statusCode: 403, message: "У вас нет прав для доступа" }
    },
    {
      name: "Общая ошибка",
      error: { message: "Что-то пошло не так" }
    }
  ]

  const showError = (error: any) => {
    throw createError(error)
  }
</script>

<template>
  <div class="test-page">
    <div class="container">
      <h1>Тестирование страницы ошибок</h1>
      <p>Выберите тип ошибки для демонстрации:</p>

      <div class="error-buttons">
        <button
          v-for="testError in testErrors"
          :key="testError.name"
          class="error-btn"
          @click="showError(testError.error)">
          {{ testError.name }}
        </button>
      </div>

      <div class="preview">
        <h2>Предварительный просмотр</h2>
        <div class="error-preview">
          <div class="error-icon">🔍</div>
          <h3>Страница не найдена</h3>
          <p>Запрашиваемая страница не существует или была перемещена.</p>
          <div class="preview-buttons">
            <button class="btn-primary">Вернуться на главную</button>
            <button class="btn-secondary">Назад</button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
  .test-page {
    min-height: 100vh;
    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
    padding: 2rem;
  }

  .container {
    max-width: 800px;
    margin: 0 auto;
    background: rgba(255, 255, 255, 0.95);
    backdrop-filter: blur(10px);
    border-radius: 20px;
    padding: 3rem;
    box-shadow: 0 20px 40px rgba(0, 0, 0, 0.1);
  }

  h1 {
    text-align: center;
    color: #2d3748;
    margin-bottom: 1rem;
  }

  p {
    text-align: center;
    color: #718096;
    margin-bottom: 2rem;
  }

  .error-buttons {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
    gap: 1rem;
    margin-bottom: 3rem;
  }

  .error-btn {
    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
    color: white;
    border: none;
    padding: 1rem;
    border-radius: 10px;
    font-size: 1rem;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.3s ease;
    box-shadow: 0 4px 15px rgba(102, 126, 234, 0.4);
  }

  .error-btn:hover {
    transform: translateY(-2px);
    box-shadow: 0 6px 20px rgba(102, 126, 234, 0.6);
  }

  .preview {
    border-top: 2px solid #e2e8f0;
    padding-top: 2rem;
  }

  .preview h2 {
    text-align: center;
    color: #2d3748;
    margin-bottom: 2rem;
  }

  .error-preview {
    background: #f7fafc;
    border-radius: 15px;
    padding: 2rem;
    text-align: center;
    border: 2px dashed #cbd5e0;
  }

  .error-icon {
    font-size: 3rem;
    margin-bottom: 1rem;
    animation: bounce 2s infinite;
  }

  .error-preview h3 {
    color: #2d3748;
    margin-bottom: 1rem;
  }

  .error-preview p {
    color: #718096;
    margin-bottom: 2rem;
  }

  .preview-buttons {
    display: flex;
    gap: 1rem;
    justify-content: center;
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
    .container {
      padding: 2rem;
      margin: 1rem;
    }

    .error-buttons {
      grid-template-columns: 1fr;
    }

    .preview-buttons {
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

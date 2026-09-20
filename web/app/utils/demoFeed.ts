import type { DemoArticleCard } from "~/types/reading"

/**
 * Демонстрационные материалы стартовой страницы.
 *
 * GraphQL-клиента в проекте нет, страницы живут на фикстурах. Вынесены из
 * компонентов сюда, чтобы ленты могли делить один источник, а ритм раскладок
 * можно было покрыть тестом: из однофайлового компонента данные не
 * импортируются.
 */

/** Лента «Новое» — пятнадцать материалов. */
export const DEMO_LATEST: DemoArticleCard[] = [
  {
    id: "6",
    title: "TypeScript 5.0: новые возможности и улучшения",
    slug: "typescript-5-new-features",
    dek: "Обзор ключевых нововведений в TypeScript 5.0",
    excerpt: "Изучаем новые возможности TypeScript 5.0: декораторы, const type parameters и другие улучшения.",
    featuredImage: "https://picsum.photos/800/400?random=6",
    publishedAt: "2024-01-20T08:30:00Z",
    author: {
      name: "Алексей Волков",
      slug: "alexey-volkov",
      photoUrl: "https://images.unsplash.com/photo-1500648767791-00dcc994a43e?w=100&h=100&fit=crop&crop=face"
    },
    section: {
      name: "Frontend",
      slug: "frontend"
    }
  },
  {
    id: "7",
    title: "Docker контейнеризация: от основ до продвинутых техник",
    slug: "docker-containerization-advanced",
    dek: "Полное руководство по Docker",
    excerpt: "От базовых концепций до продвинутых техник оптимизации Docker контейнеров.",
    featuredImage: "https://picsum.photos/800/400?random=7",
    publishedAt: "2024-01-18T15:45:00Z",
    author: {
      name: "Ольга Морозова",
      slug: "olga-morozova",
      photoUrl: "https://images.unsplash.com/photo-1487412720507-e7ab37603c6f?w=100&h=100&fit=crop&crop=face"
    },
    section: {
      name: "DevOps",
      slug: "devops"
    }
  },
  {
    id: "8",
    title: "GraphQL vs REST: когда что использовать",
    slug: "graphql-vs-rest-comparison",
    dek: "Сравнение подходов к API",
    excerpt: "Детальное сравнение GraphQL и REST API с практическими примерами использования.",
    featuredImage: "https://picsum.photos/800/400?random=8",
    publishedAt: "2024-01-16T12:20:00Z",
    author: {
      name: "Игорь Смирнов",
      slug: "igor-smirnov",
      photoUrl: "https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=100&h=100&fit=crop&crop=face"
    },
    section: {
      name: "Backend",
      slug: "backend"
    }
  },
  {
    id: "9",
    title: "Vue.js 3 Composition API: полное руководство",
    slug: "vue-3-composition-api-guide",
    dek: "Освоение Composition API",
    excerpt: "Подробное руководство по использованию Composition API в Vue.js 3 с практическими примерами.",
    featuredImage: "https://picsum.photos/800/400?random=9",
    publishedAt: "2024-01-14T10:15:00Z",
    author: {
      name: "Екатерина Новикова",
      slug: "ekaterina-novikova",
      photoUrl: "https://images.unsplash.com/photo-1494790108755-2616b612b786?w=100&h=100&fit=crop&crop=face"
    },
    section: {
      name: "Frontend",
      slug: "frontend"
    }
  },
  {
    id: "10",
    title: "Kubernetes для начинающих",
    slug: "kubernetes-beginners-guide",
    dek: "Основы оркестрации контейнеров",
    excerpt: "Пошаговое руководство по развертыванию и управлению приложениями в Kubernetes.",
    featuredImage: "https://picsum.photos/800/400?random=10",
    publishedAt: "2024-01-12T16:30:00Z",
    author: {
      name: "Денис Лебедев",
      slug: "denis-lebedev",
      photoUrl: "https://images.unsplash.com/photo-1472099645785-5658abf4ff4e?w=100&h=100&fit=crop&crop=face"
    },
    section: {
      name: "DevOps",
      slug: "devops"
    }
  },
  {
    id: "11",
    title: "Node.js производительность: оптимизация и мониторинг",
    slug: "nodejs-performance-optimization",
    dek: "Техники повышения производительности",
    excerpt: "Практические методы оптимизации производительности Node.js приложений.",
    featuredImage: "https://picsum.photos/800/400?random=11",
    publishedAt: "2024-01-10T14:00:00Z",
    author: {
      name: "Андрей Козлов",
      slug: "andrey-kozlov",
      photoUrl: "https://images.unsplash.com/photo-1500648767791-00dcc994a43e?w=100&h=100&fit=crop&crop=face"
    },
    section: {
      name: "Backend",
      slug: "backend"
    }
  },
  {
    id: "12",
    title: "CSS Grid и Flexbox: современная верстка",
    slug: "css-grid-flexbox-modern-layout",
    dek: "Освоение современных CSS техник",
    excerpt: "Подробное руководство по использованию CSS Grid и Flexbox для создания адаптивных макетов.",
    featuredImage: "https://picsum.photos/800/400?random=12",
    publishedAt: "2024-01-08T11:45:00Z",
    author: {
      name: "Наталья Соколова",
      slug: "natalya-sokolova",
      photoUrl: "https://images.unsplash.com/photo-1438761681033-6461ffad8d80?w=100&h=100&fit=crop&crop=face"
    },
    section: {
      name: "Frontend",
      slug: "frontend"
    }
  },
  {
    id: "13",
    title: "PostgreSQL оптимизация запросов",
    slug: "postgresql-query-optimization",
    dek: "Повышение производительности БД",
    excerpt: "Техники оптимизации запросов PostgreSQL для улучшения производительности приложений.",
    featuredImage: "https://picsum.photos/800/400?random=13",
    publishedAt: "2024-01-06T09:20:00Z",
    author: {
      name: "Михаил Петров",
      slug: "mikhail-petrov",
      photoUrl: "https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=100&h=100&fit=crop&crop=face"
    },
    section: {
      name: "Базы данных",
      slug: "databases"
    }
  },
  {
    id: "14",
    title: "Git workflow: эффективные стратегии ветвления",
    slug: "git-workflow-branching-strategies",
    dek: "Лучшие практики Git",
    excerpt: "Обзор популярных стратегий ветвления Git и их применение в реальных проектах.",
    featuredImage: "https://picsum.photos/800/400?random=14",
    publishedAt: "2024-01-04T13:15:00Z",
    author: {
      name: "Татьяна Иванова",
      slug: "tatyana-ivanova",
      photoUrl: "https://images.unsplash.com/photo-1494790108755-2616b612b786?w=100&h=100&fit=crop&crop=face"
    },
    section: {
      name: "Инструменты",
      slug: "tools"
    }
  },
  {
    id: "15",
    title: "Webpack 5: настройка и оптимизация",
    slug: "webpack-5-configuration-optimization",
    dek: "Современная сборка проектов",
    excerpt: "Подробное руководство по настройке и оптимизации Webpack 5 для современных веб-проектов.",
    featuredImage: "https://picsum.photos/800/400?random=15",
    publishedAt: "2024-01-02T16:00:00Z",
    author: {
      name: "Сергей Морозов",
      slug: "sergey-morozov",
      photoUrl: "https://images.unsplash.com/photo-1472099645785-5658abf4ff4e?w=100&h=100&fit=crop&crop=face"
    },
    section: {
      name: "Инструменты",
      slug: "tools"
    }
  },
  {
    id: "16",
    title: "React Hooks: продвинутые паттерны",
    slug: "react-hooks-advanced-patterns",
    dek: "Создание кастомных хуков",
    excerpt: "Изучаем продвинутые паттерны использования React Hooks и создание кастомных хуков.",
    featuredImage: "https://picsum.photos/800/400?random=16",
    publishedAt: "2024-01-01T10:30:00Z",
    author: {
      name: "Анна Сидорова",
      slug: "anna-sidorova",
      photoUrl: "https://images.unsplash.com/photo-1438761681033-6461ffad8d80?w=100&h=100&fit=crop&crop=face"
    },
    section: {
      name: "Frontend",
      slug: "frontend"
    }
  },
  {
    id: "17",
    title: "MongoDB агрегации: сложные запросы",
    slug: "mongodb-aggregation-complex-queries",
    dek: "Мощные возможности MongoDB",
    excerpt: "Изучаем возможности MongoDB Aggregation Framework для выполнения сложных запросов.",
    featuredImage: "https://picsum.photos/800/400?random=17",
    publishedAt: "2023-12-30T14:45:00Z",
    author: {
      name: "Дмитрий Волков",
      slug: "dmitry-volkov",
      photoUrl: "https://images.unsplash.com/photo-1500648767791-00dcc994a43e?w=100&h=100&fit=crop&crop=face"
    },
    section: {
      name: "Базы данных",
      slug: "databases"
    }
  },
  {
    id: "18",
    title: "Jest тестирование: от основ до продвинутых техник",
    slug: "jest-testing-advanced-techniques",
    dek: "Полное покрытие тестами",
    excerpt: "Подробное руководство по тестированию с Jest: от базовых тестов до продвинутых техник.",
    featuredImage: "https://picsum.photos/800/400?random=18",
    publishedAt: "2023-12-28T11:20:00Z",
    author: {
      name: "Елена Козлова",
      slug: "elena-kozlova",
      photoUrl: "https://images.unsplash.com/photo-1494790108755-2616b612b786?w=100&h=100&fit=crop&crop=face"
    },
    section: {
      name: "Тестирование",
      slug: "testing"
    }
  },
  {
    id: "19",
    title: "Redis кэширование: стратегии и паттерны",
    slug: "redis-caching-strategies-patterns",
    dek: "Оптимизация производительности",
    excerpt: "Изучаем различные стратегии кэширования с Redis и их применение в реальных проектах.",
    featuredImage: "https://picsum.photos/800/400?random=19",
    publishedAt: "2023-12-26T15:10:00Z",
    author: {
      name: "Игорь Морозов",
      slug: "igor-morozov",
      photoUrl: "https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=100&h=100&fit=crop&crop=face"
    },
    section: {
      name: "Backend",
      slug: "backend"
    }
  },
  {
    id: "20",
    title: "WebSocket реального времени",
    slug: "websocket-real-time-communication",
    dek: "Двусторонняя связь в веб-приложениях",
    excerpt: "Практическое руководство по реализации WebSocket для создания приложений реального времени.",
    featuredImage: "https://picsum.photos/800/400?random=20",
    publishedAt: "2023-12-24T12:30:00Z",
    author: {
      name: "Мария Лебедева",
      slug: "maria-lebedeva",
      photoUrl: "https://images.unsplash.com/photo-1438761681033-6461ffad8d80?w=100&h=100&fit=crop&crop=face"
    },
    section: {
      name: "Backend",
      slug: "backend"
    }
  }
]

/** Лента «Востребованное» — шестнадцать материалов, свой набор. */
export const DEMO_DEMANDED: DemoArticleCard[] = [
  {
    id: "d1",
    title: "Микросервисы против модульного монолита",
    slug: "microservices-vs-modular-monolith",
    dek: "Где проходит граница выгоды",
    excerpt: "Где проходит граница выгоды.",
    featuredImage: "https://picsum.photos/900/600?random=100",
    publishedAt: "2026-09-01T09:00:00Z",
    author: {
      name: "Ирина Дорохова",
      slug: "irina-dorohova",
      photoUrl: ""
    },
    section: {
      name: "Архитектура",
      slug: "architecture"
    }
  },
  {
    id: "d2",
    title: "Наблюдаемость: что на самом деле меряют трассировки",
    slug: "what-traces-actually-measure",
    dek: "Метрика, которая обманывает чаще прочих",
    excerpt: "Метрика, которая обманывает чаще прочих.",
    featuredImage: "https://picsum.photos/900/600?random=101",
    publishedAt: "2026-09-02T09:00:00Z",
    author: {
      name: "Павел Ремизов",
      slug: "pavel-remizov",
      photoUrl: ""
    },
    section: {
      name: "DevOps",
      slug: "devops"
    }
  },
  {
    id: "d3",
    title: "Ленивая загрузка, которая не помогает",
    slug: "lazy-loading-that-does-not-help",
    dek: "Когда оптимизация делает страницу медленнее",
    excerpt: "Когда оптимизация делает страницу медленнее.",
    featuredImage: "https://picsum.photos/900/600?random=102",
    publishedAt: "2026-09-03T09:00:00Z",
    author: {
      name: "Ольга Морозова",
      slug: "olga-morozova",
      photoUrl: ""
    },
    section: {
      name: "Frontend",
      slug: "frontend"
    }
  },
  {
    id: "d4",
    title: "Индексы, которые никто не читает",
    slug: "indexes-nobody-reads",
    dek: "Как найти мёртвые индексы в проде",
    excerpt: "Как найти мёртвые индексы в проде.",
    featuredImage: "https://picsum.photos/900/600?random=103",
    publishedAt: "2026-09-04T09:00:00Z",
    author: {
      name: "Михаил Петров",
      slug: "mikhail-petrov",
      photoUrl: ""
    },
    section: {
      name: "Базы данных",
      slug: "databases"
    }
  },
  {
    id: "d5",
    title: "Очереди без гарантий",
    slug: "queues-without-guarantees",
    dek: "Что обещает брокер и чего не обещает",
    excerpt: "Что обещает брокер и чего не обещает.",
    featuredImage: "https://picsum.photos/900/600?random=104",
    publishedAt: "2026-09-05T09:00:00Z",
    author: {
      name: "Игорь Смирнов",
      slug: "igor-smirnov",
      photoUrl: ""
    },
    section: {
      name: "Backend",
      slug: "backend"
    }
  },
  {
    id: "d6",
    title: "Тесты, которые проходят всегда",
    slug: "tests-that-always-pass",
    dek: "Зелёный прогон, который ничего не доказывает",
    excerpt: "Зелёный прогон, который ничего не доказывает.",
    featuredImage: "https://picsum.photos/900/600?random=105",
    publishedAt: "2026-09-06T09:00:00Z",
    author: {
      name: "Татьяна Иванова",
      slug: "tatyana-ivanova",
      photoUrl: ""
    },
    section: {
      name: "Инструменты",
      slug: "tools"
    }
  },
  {
    id: "d7",
    title: "Кэш как источник ошибок",
    slug: "cache-as-a-source-of-bugs",
    dek: "Инвалидация и всё, что за ней следует",
    excerpt: "Инвалидация и всё, что за ней следует.",
    featuredImage: "https://picsum.photos/900/600?random=106",
    publishedAt: "2026-09-07T09:00:00Z",
    author: {
      name: "Андрей Козлов",
      slug: "andrey-kozlov",
      photoUrl: ""
    },
    section: {
      name: "Backend",
      slug: "backend"
    }
  },
  {
    id: "d8",
    title: "Типизация на границе системы",
    slug: "typing-at-the-system-boundary",
    dek: "Где типы кончаются и начинается вера",
    excerpt: "Где типы кончаются и начинается вера.",
    featuredImage: "https://picsum.photos/900/600?random=107",
    publishedAt: "2026-09-08T09:00:00Z",
    author: {
      name: "Наталья Соколова",
      slug: "natalya-sokolova",
      photoUrl: ""
    },
    section: {
      name: "Frontend",
      slug: "frontend"
    }
  },
  {
    id: "d9",
    title: "Миграции без окна простоя",
    slug: "migrations-without-downtime",
    dek: "Порядок шагов, который спасает",
    excerpt: "Порядок шагов, который спасает.",
    featuredImage: "https://picsum.photos/900/600?random=108",
    publishedAt: "2026-09-09T09:00:00Z",
    author: {
      name: "Денис Лебедев",
      slug: "denis-lebedev",
      photoUrl: ""
    },
    section: {
      name: "Базы данных",
      slug: "databases"
    }
  },
  {
    id: "d10",
    title: "Логи, которые невозможно читать",
    slug: "logs-you-cannot-read",
    dek: "Структурирование постфактум",
    excerpt: "Структурирование постфактум.",
    featuredImage: "https://picsum.photos/900/600?random=109",
    publishedAt: "2026-09-10T09:00:00Z",
    author: {
      name: "Екатерина Новикова",
      slug: "ekaterina-novikova",
      photoUrl: ""
    },
    section: {
      name: "DevOps",
      slug: "devops"
    }
  },
  {
    id: "d11",
    title: "Ретраи и лавина запросов",
    slug: "retries-and-request-avalanche",
    dek: "Как повтор превращается в отказ",
    excerpt: "Как повтор превращается в отказ.",
    featuredImage: "https://picsum.photos/900/600?random=110",
    publishedAt: "2026-09-11T09:00:00Z",
    author: {
      name: "Сергей Козлов",
      slug: "sergey-kozlov",
      photoUrl: ""
    },
    section: {
      name: "Backend",
      slug: "backend"
    }
  },
  {
    id: "d12",
    title: "Сборка, которую никто не понимает",
    slug: "the-build-nobody-understands",
    dek: "Инструменты поверх инструментов",
    excerpt: "Инструменты поверх инструментов.",
    featuredImage: "https://picsum.photos/900/600?random=111",
    publishedAt: "2026-09-12T09:00:00Z",
    author: {
      name: "Мария Иванова",
      slug: "maria-ivanova",
      photoUrl: ""
    },
    section: {
      name: "Инструменты",
      slug: "tools"
    }
  },
  {
    id: "d13",
    title: "Доступность как ограничение вёрстки",
    slug: "accessibility-as-a-layout-constraint",
    dek: "Не надстройка, а условие задачи",
    excerpt: "Не надстройка, а условие задачи.",
    featuredImage: "https://picsum.photos/900/600?random=112",
    publishedAt: "2026-09-13T09:00:00Z",
    author: {
      name: "Алексей Волков",
      slug: "alexey-volkov",
      photoUrl: ""
    },
    section: {
      name: "Frontend",
      slug: "frontend"
    }
  },
  {
    id: "d14",
    title: "Секреты в переменных окружения",
    slug: "secrets-in-environment-variables",
    dek: "Почему это не хранилище",
    excerpt: "Почему это не хранилище.",
    featuredImage: "https://picsum.photos/900/600?random=113",
    publishedAt: "2026-09-14T09:00:00Z",
    author: {
      name: "Ольга Морозова",
      slug: "olga-morozova",
      photoUrl: ""
    },
    section: {
      name: "DevOps",
      slug: "devops"
    }
  },
  {
    id: "d15",
    title: "Схема как договор",
    slug: "schema-as-a-contract",
    dek: "Совместимость, о которой забывают",
    excerpt: "Совместимость, о которой забывают.",
    featuredImage: "https://picsum.photos/900/600?random=114",
    publishedAt: "2026-09-15T09:00:00Z",
    author: {
      name: "Ирина Дорохова",
      slug: "irina-dorohova",
      photoUrl: ""
    },
    section: {
      name: "Архитектура",
      slug: "architecture"
    }
  },
  {
    id: "d16",
    title: "Наблюдение за очередью писем",
    slug: "watching-the-mail-queue",
    dek: "Что показывает задержка доставки",
    excerpt: "Что показывает задержка доставки.",
    featuredImage: "https://picsum.photos/900/600?random=115",
    publishedAt: "2026-09-16T09:00:00Z",
    author: {
      name: "Павел Ремизов",
      slug: "pavel-remizov",
      photoUrl: ""
    },
    section: {
      name: "Backend",
      slug: "backend"
    }
  }
]

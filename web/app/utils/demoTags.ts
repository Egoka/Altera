/**
 * Демонстрационный справочник тегов.
 *
 * GraphQL-клиента в проекте нет, страницы живут на фикстурах. Список вынесен из
 * страницы `/tags`, чтобы лента тега показывала имя того тега, что стоит в
 * маршруте: раньше `/tags/economics` рисовал «Технологии» из собственного мока.
 */

/** Тег в демо-данных: только то, что рисует шапка. */
export interface DemoTag {
  name: string
  slug: string
}

export const DEMO_TAGS: DemoTag[] = [
  { name: "Технологии", slug: "technology" },
  { name: "Наука", slug: "science" },
  { name: "Экономика", slug: "economics" },
  { name: "Политика", slug: "politics" },
  { name: "Общество", slug: "society" },
  { name: "Культура", slug: "culture" },
  { name: "Спорт", slug: "sports" },
  { name: "Здоровье", slug: "health" },
  { name: "Образование", slug: "education" },
  { name: "Медиа", slug: "media" },
  { name: "Экология", slug: "ecology" },
  { name: "Инновации", slug: "innovation" },
  { name: "Бизнес", slug: "business" },
  { name: "Финансы", slug: "finance" },
  { name: "Медицина", slug: "medicine" },
  { name: "Психология", slug: "psychology" },
  { name: "История", slug: "history" },
  { name: "Философия", slug: "philosophy" },
  { name: "Искусство", slug: "art" },
  { name: "Музыка", slug: "music" },
  { name: "JavaScript", slug: "javascript" },
  { name: "TypeScript", slug: "typescript" },
  { name: "React", slug: "react" },
  { name: "Vue.js", slug: "vue" },
  { name: "Node.js", slug: "nodejs" },
  { name: "Python", slug: "python" },
  { name: "PHP", slug: "php" },
  { name: "Java", slug: "java" },
  { name: "C#", slug: "csharp" },
  { name: "Go", slug: "go" },
  { name: "Next.js", slug: "nextjs" },
  { name: "Nuxt.js", slug: "nuxtjs" },
  { name: "Angular", slug: "angular" },
  { name: "Express.js", slug: "express" },
  { name: "Laravel", slug: "laravel" },
  { name: "Django", slug: "django" },
  { name: "Spring Boot", slug: "spring-boot" },
  { name: "ASP.NET", slug: "aspnet" },
  { name: "PostgreSQL", slug: "postgresql" },
  { name: "MySQL", slug: "mysql" },
  { name: "MongoDB", slug: "mongodb" },
  { name: "Redis", slug: "redis" },
  { name: "SQLite", slug: "sqlite" },
  { name: "Elasticsearch", slug: "elasticsearch" },
  { name: "AWS", slug: "aws" },
  { name: "Docker", slug: "docker" },
  { name: "Kubernetes", slug: "kubernetes" },
  { name: "Azure", slug: "azure" },
  { name: "Google Cloud", slug: "google-cloud" },
  { name: "Heroku", slug: "heroku" },
  { name: "HTML5", slug: "html5" },
  { name: "CSS3", slug: "css3" },
  { name: "SASS", slug: "sass" },
  { name: "Webpack", slug: "webpack" },
  { name: "Vite", slug: "vite" },
  { name: "Tailwind CSS", slug: "tailwind-css" },
  { name: "Bootstrap", slug: "bootstrap" },
  { name: "React Native", slug: "react-native" },
  { name: "Flutter", slug: "flutter" },
  { name: "Swift", slug: "swift" },
  { name: "Kotlin", slug: "kotlin" },
  { name: "Ionic", slug: "ionic" },
  { name: "Git", slug: "git" },
  { name: "GitHub", slug: "github" },
  { name: "VS Code", slug: "vs-code" },
  { name: "IntelliJ", slug: "intellij" },
  { name: "WebStorm", slug: "webstorm" },
  { name: "Postman", slug: "postman" },
  { name: "REST API", slug: "rest-api" },
  { name: "GraphQL", slug: "graphql" },
  { name: "Microservices", slug: "microservices" },
  { name: "MVC", slug: "mvc" },
  { name: "MVP", slug: "mvp" },
  { name: "Clean Architecture", slug: "clean-architecture" },
  { name: "Jest", slug: "jest" },
  { name: "Cypress", slug: "cypress" },
  { name: "Mocha", slug: "mocha" },
  { name: "Selenium", slug: "selenium" },
  { name: "WebAssembly", slug: "webassembly" },
  { name: "PWA", slug: "pwa" },
  { name: "WebRTC", slug: "webrtc" },
  { name: "WebSockets", slug: "websockets" }
]

/**
 * Ищет тег по слагу маршрута. Неизвестный слаг возвращается сам собой вместо
 * имени: показать первый попавшийся тег из мока значило бы соврать читателю.
 */
export const findDemoTag = (slug: string): DemoTag => DEMO_TAGS.find((tag) => tag.slug === slug) ?? { name: slug, slug }

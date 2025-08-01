# Стандарты обмена Query для админ панели

Этот документ описывает единые стандарты для реализации сложных таблиц в админ панели с поддержкой фильтрации, сортировки, пагинации и поиска.

## 📋 Общие принципы

### 1. Единообразие API
Все админ запросы должны следовать единому паттерну для обеспечения консистентности фронтенда.

### 2. Производительность
- Использование индексов в базе данных
- Кеширование результатов с Redis (TTL 2 минуты)
- Пагинация для больших наборов данных

### 3. Безопасность
- Проверка прав доступа (только admin)
- Валидация входных параметров
- Защита от SQL-инъекций

## 🔍 Стандартная структура Query

### Input типы для фильтрации

```graphql
input PaginationInput {
  page: Int! = 1
  limit: Int! = 20
  maxLimit: Int = 100
}

input SortInput {
  field: String!
  direction: SortDirection! = ASC
}

enum SortDirection {
  ASC
  DESC
}

input DateRangeInput {
  from: String # ISO 8601 формат
  to: String   # ISO 8601 формат
}

input SearchInput {
  query: String!
  fields: [String!] # Поля для поиска
}
```

### Стандартные фильтры

```graphql
input BaseFiltersInput {
  # Статус
  status: [String!]
  
  # Дата создания
  createdAt: DateRangeInput
  
  # Дата обновления
  updatedAt: DateRangeInput
  
  # Поиск по содержимому
  search: SearchInput
}

input ArticleFiltersInput {
  # Наследуем базовые фильтры
  base: BaseFiltersInput
  
  # Специфичные для статей
  authorId: [ID!]
  typeId: [ID!]
  tagIds: [ID!]
  publishedAt: DateRangeInput
}

input TagFiltersInput {
  base: BaseFiltersInput
  
  # Специфичные для тегов
  hasArticles: Boolean
}

input ContentTypeFiltersInput {
  base: BaseFiltersInput
  
  # Специфичные для типов контента
  status: [ContentTypeStatus!]
  hasArticles: Boolean
}
```

### Response типы

```graphql
type PaginationInfo {
  currentPage: Int!
  totalPages: Int!
  totalItems: Int!
  itemsPerPage: Int!
  hasNextPage: Boolean!
  hasPreviousPage: Boolean!
}

type AdminArticlesResponse {
  articles: [Article!]!
  pagination: PaginationInfo!
  filters: ArticleFiltersInput!
  sort: SortInput!
}

type AdminTagsResponse {
  tags: [SectionTag!]!
  pagination: PaginationInfo!
  filters: TagFiltersInput!
  sort: SortInput!
}

type AdminContentTypesResponse {
  contentTypes: [ContentType!]!
  pagination: PaginationInfo!
  filters: ContentTypeFiltersInput!
  sort: SortInput!
}
```

## 📊 Реализация в резолверах

### Стандартная структура резолвера

```typescript
// Типы для TypeScript
interface PaginationInput {
  page: number
  limit: number
  maxLimit?: number
}

interface SortInput {
  field: string
  direction: 'ASC' | 'DESC'
}

interface BaseFilters {
  status?: string[]
  createdAt?: { from?: string; to?: string }
  updatedAt?: { from?: string; to?: string }
  search?: { query: string; fields: string[] }
}

// Утилиты для работы с фильтрами
const buildWhereClause = (filters: BaseFilters) => {
  const where: any = {}
  
  if (filters.status?.length) {
    where.status = { in: filters.status }
  }
  
  if (filters.createdAt) {
    where.createdAt = {}
    if (filters.createdAt.from) where.createdAt.gte = new Date(filters.createdAt.from)
    if (filters.createdAt.to) where.createdAt.lte = new Date(filters.createdAt.to)
  }
  
  if (filters.search) {
    where.OR = filters.search.fields.map(field => ({
      [field]: { contains: filters.search.query, mode: 'insensitive' }
    }))
  }
  
  return where
}

const buildOrderBy = (sort: SortInput) => {
  return { [sort.field]: sort.direction.toLowerCase() }
}

const calculatePagination = (page: number, limit: number, total: number) => {
  const maxLimit = 100
  const actualLimit = Math.min(limit, maxLimit)
  const skip = (page - 1) * actualLimit
  const totalPages = Math.ceil(total / actualLimit)
  
  return {
    skip,
    take: actualLimit,
    pagination: {
      currentPage: page,
      totalPages,
      totalItems: total,
      itemsPerPage: actualLimit,
      hasNextPage: page < totalPages,
      hasPreviousPage: page > 1
    }
  }
}
```

### Пример реализации для статей

```typescript
adminArticles: async (
  _parent: any,
  args: {
    pagination: PaginationInput
    sort: SortInput
    filters: ArticleFiltersInput
  },
  ctx: GraphQLContext
) => {
  // Проверка прав доступа
  ensureHasRole(ctx, 'admin')
  
  const { pagination, sort, filters } = args
  
  // Строим WHERE условие
  const where = buildWhereClause(filters.base)
  
  // Добавляем специфичные фильтры для статей
  if (filters.authorId?.length) {
    where.authorId = { in: filters.authorId }
  }
  
  if (filters.typeId?.length) {
    where.typeId = { in: filters.typeId }
  }
  
  if (filters.tagIds?.length) {
    where.sectionTags = {
      some: { id: { in: filters.tagIds } }
    }
  }
  
  if (filters.publishedAt) {
    where.publishedAt = {}
    if (filters.publishedAt.from) where.publishedAt.gte = new Date(filters.publishedAt.from)
    if (filters.publishedAt.to) where.publishedAt.lte = new Date(filters.publishedAt.to)
  }
  
  // Получаем общее количество
  const total = await ctx.prisma.article.count({ where })
  
  // Рассчитываем пагинацию
  const { skip, take, pagination: paginationInfo } = calculatePagination(
    pagination.page,
    pagination.limit,
    total
  )
  
  // Получаем данные
  const articles = await ctx.prisma.article.findMany({
    where,
    skip,
    take,
    orderBy: buildOrderBy(sort),
    include: {
      author: true,
      contentType: true,
      sectionTags: true
    }
  })
  
  return {
    articles,
    pagination: paginationInfo,
    filters,
    sort
  }
}
```

## 🔧 Кеширование

### Стратегия кеширования

```typescript
const ADMIN_CACHE_PREFIX = "admin:"
const ADMIN_CACHE_TTL = 120 // 2 минуты

const getCacheKey = (operation: string, params: any) => {
  const hash = crypto.createHash('md5').update(JSON.stringify(params)).digest('hex')
  return `${ADMIN_CACHE_PREFIX}${operation}:${hash}`
}

const getCachedOrFetch = async (
  ctx: GraphQLContext,
  cacheKey: string,
  fetchFunction: () => Promise<any>
) => {
  const cached = await ctx.redis.get(cacheKey)
  if (cached) {
    console.log("CACHE: Returning admin data from cache")
    return JSON.parse(cached)
  }
  
  console.log("DATABASE: Admin data not in cache, fetching from database")
  const data = await fetchFunction()
  await ctx.redis.setex(cacheKey, ADMIN_CACHE_TTL, JSON.stringify(data))
  
  return data
}
```

## 📝 Примеры использования

### Frontend запросы

```graphql
# Получение статей с фильтрацией
query GetAdminArticles(
  $pagination: PaginationInput!
  $sort: SortInput!
  $filters: ArticleFiltersInput!
) {
  adminArticles(pagination: $pagination, sort: $sort, filters: $filters) {
    articles {
      id
      title
      slug
      status
      author { name }
      contentType { name }
      sectionTags { name }
      createdAt
      publishedAt
    }
    pagination {
      currentPage
      totalPages
      totalItems
      itemsPerPage
      hasNextPage
      hasPreviousPage
    }
  }
}

# Получение тегов
query GetAdminTags(
  $pagination: PaginationInput!
  $sort: SortInput!
  $filters: TagFiltersInput!
) {
  adminSectionTags(pagination: $pagination, sort: $sort, filters: $filters) {
    tags {
      id
      name
      slug
      description
      createdAt
      _count { articles }
    }
    pagination {
      currentPage
      totalPages
      totalItems
    }
  }
}
```

### Примеры переменных

```javascript
// Фильтрация статей по статусу и автору
const articleVariables = {
  pagination: { page: 1, limit: 20 },
  sort: { field: "createdAt", direction: "DESC" },
  filters: {
    base: {
      status: ["published", "review"],
      search: { query: "React", fields: ["title", "body"] }
    },
    authorId: ["user-1", "user-2"],
    typeId: ["type-1"]
  }
}

// Поиск тегов
const tagVariables = {
  pagination: { page: 1, limit: 10 },
  sort: { field: "name", direction: "ASC" },
  filters: {
    base: {
      search: { query: "javascript", fields: ["name", "description"] }
    },
    hasArticles: true
  }
}
```

## 🚀 Рекомендации по реализации

### 1. Индексы базы данных
```sql
-- Для статей
CREATE INDEX idx_articles_status ON articles(status);
CREATE INDEX idx_articles_author_id ON articles(author_id);
CREATE INDEX idx_articles_type_id ON articles(type_id);
CREATE INDEX idx_articles_published_at ON articles(published_at);
CREATE INDEX idx_articles_created_at ON articles(created_at);

-- Для тегов
CREATE INDEX idx_section_tags_name ON section_tags(name);
CREATE INDEX idx_section_tags_created_at ON section_tags(created_at);

-- Для типов контента
CREATE INDEX idx_content_types_status ON content_types(status);
CREATE INDEX idx_content_types_order ON content_types(order);
```

### 2. Валидация на сервере
```typescript
const validatePagination = (pagination: PaginationInput) => {
  if (pagination.page < 1) throw new GraphQLError("Page must be >= 1")
  if (pagination.limit < 1) throw new GraphQLError("Limit must be >= 1")
  if (pagination.limit > 100) throw new GraphQLError("Limit cannot exceed 100")
}

const validateSort = (sort: SortInput, allowedFields: string[]) => {
  if (!allowedFields.includes(sort.field)) {
    throw new GraphQLError(`Invalid sort field: ${sort.field}`)
  }
}
```

### 3. Обработка ошибок
```typescript
const handleAdminError = (error: any) => {
  if (error.code === 'P2002') {
    throw new GraphQLError("Duplicate entry", { extensions: { code: "DUPLICATE" } })
  }
  if (error.code === 'P2025') {
    throw new GraphQLError("Record not found", { extensions: { code: "NOT_FOUND" } })
  }
  throw new GraphQLError("Internal server error", { extensions: { code: "INTERNAL_ERROR" } })
}
```

## 📋 Чек-лист реализации

- [ ] Создать стандартные input типы для фильтрации
- [ ] Реализовать утилиты для построения WHERE условий
- [ ] Добавить поддержку сортировки по любым полям
- [ ] Реализовать пагинацию с ограничениями
- [ ] Добавить поиск по содержимому с поддержкой нескольких полей
- [ ] Настроить кеширование для админ запросов
- [ ] Добавить валидацию входных параметров
- [ ] Создать индексы в базе данных для производительности
- [ ] Добавить обработку ошибок
- [ ] Написать тестовые запросы
- [ ] Обновить документацию

Эта документация обеспечит единообразие всех админ функций и упростит разработку фронтенда. 
# Отчет о рефакторинге параметра поиска

## 🎯 Цель изменений
Вынести параметр `search` из `BaseFiltersInput` в отдельный параметр запроса для лучшей архитектуры и гибкости.

## ✅ Преимущества нового подхода

### 1. Разделение ответственности
- **Фильтры** - для структурированных данных (статус, даты, роли)
- **Поиск** - для текстового поиска по содержимому

### 2. Гибкость использования
- Можно использовать поиск без фильтров
- Можно использовать фильтры без поиска
- Можно комбинировать поиск и фильтры

### 3. Производительность
- Поиск может использовать специальные индексы
- Оптимизация запросов для разных типов операций

### 4. Простота API
- Более понятная структура запросов
- Лучшая документация и типизация

## 🔧 Технические изменения

### 1. Обновление корневой схемы
**`server/src/graphql/root/schema.graphql`:**
```graphql
# ❌ Удалено из BaseFiltersInput
input BaseFiltersInput {
  status: [String!]
  createdAt: DateRangeInput
  updatedAt: DateRangeInput
  # search: SearchInput - УДАЛЕНО
}

# ✅ Оставлено как отдельный тип
input SearchInput {
  query: String!
  fields: [String!]
}
```

### 2. Обновление схем сущностей

**Статьи (`article/schema.graphql`):**
```graphql
# ✅ Новый формат запроса
articles(
  pagination: PaginationInput!
  sort: SortInput!
  filters: ArticleFiltersInput!
  search: SearchInput  # ← Отдельный параметр
): ArticlesResponse!

# ✅ Обновленный ответ
type ArticlesResponse {
  articles: [Article!]!
  pagination: PaginationInfo!
  filters: ArticleFilters!
  sort: SortInfo!
  search: SearchInfo  # ← Отдельное поле
}
```

**Теги (`sectionTag/schema.graphql`):**
```graphql
sectionTags(
  pagination: PaginationInput!
  sort: SortInput!
  filters: TagFiltersInput!
  search: SearchInput  # ← Отдельный параметр
): TagsResponse!

type TagsResponse {
  tags: [SectionTag!]!
  pagination: PaginationInfo!
  filters: TagFilters!
  sort: SortInfo!
  search: SearchInfo  # ← Отдельное поле
}
```

**Типы контента (`contentType/schema.graphql`):**
```graphql
contentTypes(
  pagination: PaginationInput!
  sort: SortInput!
  filters: ContentTypeFiltersInput!
  search: SearchInput  # ← Отдельный параметр
): ContentTypesResponse!

type ContentTypesResponse {
  contentTypes: [ContentType!]!
  pagination: PaginationInfo!
  filters: ContentTypeFilters!
  sort: SortInfo!
  search: SearchInfo  # ← Отдельное поле
}
```

**Пользователи (`user/schema.graphql`):**
```graphql
users(
  pagination: PaginationInput!
  sort: SortInput!
  filters: UserFiltersInput!
  search: SearchInput  # ← Отдельный параметр
): UsersResponse!

type UsersResponse {
  users: [User!]!
  pagination: PaginationInfo!
  filters: UserFilters!
  sort: SortInfo!
  search: SearchInfo  # ← Отдельное поле
}
```

### 3. Обновление утилит
**`server/src/utils/admin.ts`:**
```typescript
// ❌ Старый интерфейс
export interface BaseFilters {
  status?: string[]
  createdAt?: DateRangeInput
  updatedAt?: DateRangeInput
  search?: SearchInput  // УДАЛЕНО
}

// ✅ Обновленная функция
export const buildBaseWhereClause = (
  filters: BaseFilters, 
  search?: SearchInput  // ← Отдельный параметр
) => {
  const where: any = {}
  
  // Фильтры
  if (filters.status?.length) {
    where.status = { in: filters.status }
  }
  
  // Поиск
  if (search) {
    where.OR = search.fields.map(field => ({
      [field]: { contains: search.query, mode: 'insensitive' }
    }))
  }
  
  return where
}
```

### 4. Обновление резолверов
Все резолверы обновлены для работы с новым форматом:

```typescript
// ✅ Новый формат аргументов
articles: async (
  _parent: any,
  args: {
    pagination: PaginationInput
    sort: SortInput
    filters: ArticleFiltersInput
    search?: SearchInput  // ← Отдельный параметр
  },
  ctx: GraphQLContext
) => {
  const { pagination, sort, filters, search } = args
  
  // Валидация поиска
  if (search) {
    validateSearchInput(search, ['title', 'body', 'excerpt', 'dek'])
  }
  
  // Построение WHERE с поиском
  const where = buildBaseWhereClause(filters.base, search)
  
  // Возврат с поиском
  return {
    articles,
    pagination: paginationInfo,
    filters: { /* ... */ },
    sort: { /* ... */ },
    search: search ? {
      query: search.query,
      fields: search.fields
    } : null
  }
}
```

## 📁 Обновленные файлы

1. **`server/src/graphql/root/schema.graphql`** - удален search из BaseFiltersInput
2. **`server/src/graphql/article/schema.graphql`** - добавлен search параметр
3. **`server/src/graphql/article/resolver.ts`** - обновлена логика
4. **`server/src/graphql/sectionTag/schema.graphql`** - добавлен search параметр
5. **`server/src/graphql/sectionTag/resolver.ts`** - обновлена логика
6. **`server/src/graphql/contentType/schema.graphql`** - добавлен search параметр
7. **`server/src/graphql/contentType/resolver.ts`** - обновлена логика
8. **`server/src/graphql/user/schema.graphql`** - добавлен search параметр
9. **`server/src/graphql/user/resolver.ts`** - обновлена логика
10. **`server/src/utils/admin.ts`** - обновлены интерфейсы и функции

## ✅ Результат

### Архитектурные улучшения:
- ✅ Разделение ответственности между фильтрами и поиском
- ✅ Более гибкий API
- ✅ Лучшая производительность
- ✅ Упрощенная структура

### Функциональность:
- ✅ Поиск работает независимо от фильтров
- ✅ Фильтры работают независимо от поиска
- ✅ Можно комбинировать поиск и фильтры
- ✅ Валидация поиска осталась прежней

### Примеры использования:

```graphql
# Только поиск
query SearchArticles {
  articles(
    pagination: { page: 1, limit: 20 }
    sort: { field: "createdAt", direction: DESC }
    filters: { base: {} }
    search: {
      query: "javascript"
      fields: ["title", "body"]
    }
  ) {
    articles { id title }
    search { query fields }
  }
}

# Только фильтры
query FilterArticles {
  articles(
    pagination: { page: 1, limit: 20 }
    sort: { field: "title", direction: ASC }
    filters: {
      base: { status: ["published"] }
      authorId: ["user-1", "user-2"]
    }
  ) {
    articles { id title }
  }
}

# Поиск + фильтры
query SearchAndFilterArticles {
  articles(
    pagination: { page: 1, limit: 20 }
    sort: { field: "publishedAt", direction: DESC }
    filters: {
      base: { status: ["published"] }
      typeId: ["type-1"]
    }
    search: {
      query: "react"
      fields: ["title", "body"]
    }
  ) {
    articles { id title }
    filters { base { status } }
    search { query fields }
  }
}
```

Рефакторинг успешно завершен! 🎉 
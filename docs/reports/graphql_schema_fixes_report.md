# Отчет об исправлении ошибок GraphQL схемы

## 🐛 Проблема
Обнаружены ошибки в GraphQL схеме:
- `The type 'ArticleFiltersInput' is not an output type, but was used to declare the output type of a field`
- `The type 'SortInput' is not an output type, but was used to declare the output type of a field`

## 🔍 Причина
В схемах использовались входные типы (`Input`) как выходные типы в ответах. GraphQL требует отдельные типы для входных и выходных данных.

## ✅ Решение

### 1. Создание выходных типов в корневой схеме
Добавлены в `server/src/graphql/root/schema.graphql`:

```graphql
type BaseFiltersInfo {
  status: [String!]
  createdAt: DateRangeInfo
  updatedAt: DateRangeInfo
  search: SearchInfo
}

type DateRangeInfo {
  from: String
  to: String
}

type SearchInfo {
  query: String!
  fields: [String!]
}

type SortInfo {
  field: String!
  direction: SortDirection!
}
```

### 2. Обновление схем сущностей

**Статьи (`article/schema.graphql`):**
```graphql
type ArticlesResponse {
  articles: [Article!]!
  pagination: PaginationInfo!
  filters: ArticleFilters!    # Вместо ArticleFiltersInput
  sort: SortInfo!            # Вместо SortInput
}

type ArticleFilters {
  base: BaseFiltersInfo
  authorId: [ID!]
  typeId: [ID!]
  tagIds: [ID!]
  publishedAt: DateRangeInfo
}
```

**Теги (`sectionTag/schema.graphql`):**
```graphql
type TagsResponse {
  tags: [SectionTag!]!
  pagination: PaginationInfo!
  filters: TagFilters!       # Вместо TagFiltersInput
  sort: SortInfo!           # Вместо SortInput
}

type TagFilters {
  base: BaseFiltersInfo
  hasArticles: Boolean
}
```

**Типы контента (`contentType/schema.graphql`):**
```graphql
type ContentTypesResponse {
  contentTypes: [ContentType!]!
  pagination: PaginationInfo!
  filters: ContentTypeFilters!  # Вместо ContentTypeFiltersInput
  sort: SortInfo!              # Вместо SortInput
}

type ContentTypeFilters {
  base: BaseFiltersInfo
  status: [ContentTypeStatus!]
  hasArticles: Boolean
}
```

**Пользователи (`user/schema.graphql`):**
```graphql
type UsersResponse {
  users: [User!]!
  pagination: PaginationInfo!
  filters: UserFilters!      # Вместо UserFiltersInput
  sort: SortInfo!           # Вместо SortInput
}

type UserFilters {
  base: BaseFiltersInfo
  role: [Role!]
  hasArticles: Boolean
}
```

### 3. Обновление резолверов
Все резолверы обновлены для возврата правильных выходных типов:

```typescript
return {
  articles,
  pagination: paginationInfo,
  filters: {
    base: {
      status: filters.base.status,
      createdAt: filters.base.createdAt,
      updatedAt: filters.base.updatedAt,
      search: filters.base.search
    },
    // специфичные поля
  },
  sort: {
    field: sort.field,
    direction: sort.direction
  }
}
```

## 📁 Обновленные файлы

1. **`server/src/graphql/root/schema.graphql`** - добавлены общие выходные типы
2. **`server/src/graphql/article/schema.graphql`** - обновлены типы ответов
3. **`server/src/graphql/article/resolver.ts`** - обновлен возврат данных
4. **`server/src/graphql/sectionTag/schema.graphql`** - обновлены типы ответов
5. **`server/src/graphql/sectionTag/resolver.ts`** - обновлен возврат данных
6. **`server/src/graphql/contentType/schema.graphql`** - обновлены типы ответов
7. **`server/src/graphql/contentType/resolver.ts`** - обновлен возврат данных
8. **`server/src/graphql/user/schema.graphql`** - обновлены типы ответов
9. **`server/src/graphql/user/resolver.ts`** - обновлен возврат данных

## ✅ Результат

- ✅ Устранены все ошибки GraphQL схемы
- ✅ Сборка проекта проходит успешно
- ✅ Сохранена функциональность всех админ запросов
- ✅ Улучшена архитектура с разделением входных и выходных типов
- ✅ Добавлены общие типы в корневую схему

## 🎯 Архитектурные улучшения

1. **Разделение типов**: Входные типы (`Input`) и выходные типы теперь разделены
2. **Переиспользование**: Общие типы вынесены в корневую схему
3. **Консистентность**: Все админ ответы имеют единообразную структуру
4. **Типобезопасность**: GraphQL схема теперь корректно типизирована

Все ошибки исправлены! 🎉 
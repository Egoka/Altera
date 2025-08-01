// Запросы для поиска

export const SEARCH_ARTICLES = `
  query searchArticles($query: String!, $page: Int = 1, $limit: Int = 20) {
    searchArticles(query: $query, page: $page, limit: $limit) {
      articles {
        id
        title
        slug
        dek
        excerpt
        publishedAt
        author {
          name
          slug
        }
        contentType {
          name
          slug
        }
      }
      totalCount
      totalPages
      currentPage
    }
  }
`

export const SEARCH_SUGGESTIONS = `
  query searchSuggestions($query: String!) {
    searchSuggestions(query: $query, limit: 5) {
      articles {
        title
        slug
      }
      authors {
        name
        slug
      }
      tags {
        name
        slug
      }
    }
  }
`

export const ADVANCED_SEARCH = `
  query advancedSearch(
    $query: String
    $authorId: ID
    $contentTypeId: ID
    $tagIds: [ID!]
    $dateFrom: String
    $dateTo: String
    $status: ArticleStatus
    $sortBy: String
    $page: Int = 1
    $limit: Int = 20
  ) {
    advancedSearch(
      query: $query
      authorId: $authorId
      contentTypeId: $contentTypeId
      tagIds: $tagIds
      dateFrom: $dateFrom
      dateTo: $dateTo
      status: $status
      sortBy: $sortBy
      page: $page
      limit: $limit
    ) {
      articles {
        id
        title
        slug
        dek
        excerpt
        featuredImage
        publishedAt
        author {
          name
          slug
          photoUrl
        }
        contentType {
          name
          slug
        }
        sectionTags {
          name
          slug
        }
      }
      totalCount
      totalPages
      currentPage
      facets {
        authors {
          id
          name
          count
        }
        contentTypes {
          id
          name
          count
        }
        tags {
          id
          name
          count
        }
      }
    }
  }
`

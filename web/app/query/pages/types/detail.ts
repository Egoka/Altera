// Запросы для страницы типа контента

export const GET_CONTENT_TYPE_PAGE = `
  query getContentTypePage($slug: String!, $page: Int = 1, $limit: Int = 20) {
    contentType(slug: $slug) {
      id
      name
      slug
      description
      order
      status
    }
    
    contentTypeArticles(typeSlug: $slug, page: $page, limit: $limit) {
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
        sectionTags {
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

// Запросы для страницы тега

export const GET_TAG_PAGE = `
  query getTagPage($slug: String!, $page: Int = 1, $limit: Int = 20) {
    sectionTag(slug: $slug) {
      id
      name
      slug
      description
    }
    
    tagArticles(tagSlug: $slug, page: $page, limit: $limit) {
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
      }
      totalCount
      totalPages
      currentPage
    }
  }
`

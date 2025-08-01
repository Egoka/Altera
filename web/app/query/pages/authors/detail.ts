// Запросы для страницы автора

export const GET_AUTHOR_PAGE = `
  query getAuthorPage($slug: String!, $page: Int = 1, $limit: Int = 20) {
    user(slug: $slug) {
      id
      name
      email
      bio
      photoUrl
      slug
      socialLinks
      role
    }
    
    authorArticles(authorSlug: $slug, page: $page, limit: $limit) {
      articles {
        id
        title
        slug
        dek
        excerpt
        featuredImage
        publishedAt
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
    }
    
    authorStats(authorSlug: $slug) {
      totalArticles
      articlesThisMonth
      popularTags
    }
  }
`

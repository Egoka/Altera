// Запросы для страницы статьи

export const GET_ARTICLE = `
  query getArticle($slug: String!) {
    article(slug: $slug) {
      id
      title
      slug
      dek
      body
      excerpt
      featuredImage
      status
      publishedAt
      createdAt
      updatedAt
      author {
        id
        name
        slug
        bio
        photoUrl
        socialLinks
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
    
    # Рекомендуемые статьи
    relatedArticles(slug: $slug, limit: 5) {
      id
      title
      slug
      dek
      featuredImage
      author {
        name
        slug
      }
    }
  }
`

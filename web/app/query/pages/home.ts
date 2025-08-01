// Запросы для главной страницы

export const GET_HOME_PAGE_ARTICLES = `
  query getHomePageArticles {
    featuredArticles(limit: 5) {
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
    
    latestArticles(limit: 20, excludeFeatured: true) {
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
    
    popularArticles(timeRange: "week", limit: 10) {
      id
      title
      slug
      author {
        name
        slug
      }
    }
  }
`

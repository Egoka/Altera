// Запросы для управления моими статьями

export const GET_MY_ARTICLES = `
  query getMyArticles($status: ArticleStatus, $page: Int = 1, $limit: Int = 20) {
    myArticles(status: $status, page: $page, limit: $limit) {
      articles {
        id
        title
        slug
        status
        publishedAt
        updatedAt
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
  }
`

export const GET_ARTICLE_FOR_EDIT = `
  query getArticleForEdit($slug: String!) {
    articleForEdit(slug: $slug) {
      id
      title
      slug
      dek
      body
      excerpt
      featuredImage
      status
      contentType {
        id
        name
        slug
      }
      sectionTags {
        id
        name
        slug
      }
    }
    
    # Для выпадающих списков
    contentTypes {
      id
      name
      slug
    }
    
    sectionTags {
      id
      name
      slug
    }
  }
`

// Мутации для работы со статьями
export const CREATE_ARTICLE = `
  mutation createArticle($input: CreateArticleInput!) {
    createArticle(input: $input) {
      id
      slug
      title
    }
  }
`

export const UPDATE_ARTICLE = `
  mutation updateArticle($id: ID!, $input: UpdateArticleInput!) {
    updateArticle(id: $id, input: $input) {
      id
      slug
      title
      status
    }
  }
`

export const DELETE_ARTICLE = `
  mutation deleteArticle($id: ID!) {
    deleteArticle(id: $id) {
      success
    }
  }
`

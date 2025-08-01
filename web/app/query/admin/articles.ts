// Запросы для админ-панели - управление статьями

export const GET_ADMIN_ARTICLES = `
  query getAdminArticles($status: ArticleStatus, $page: Int = 1, $limit: Int = 20) {
    adminArticles(status: $status, page: $page, limit: $limit) {
      articles {
        id
        title
        slug
        status
        publishedAt
        updatedAt
        author {
          name
          slug
          email
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
    
    articlesStats {
      total
      published
      draft
      review
      archived
      todayPublished
    }
  }
`

// Мутации для администрирования статей
export const CHANGE_ARTICLE_STATUS = `
  mutation changeArticleStatus($id: ID!, $status: ArticleStatus!) {
    changeArticleStatus(id: $id, status: $status) {
      id
      status
      publishedAt
    }
  }
`

export const BULK_DELETE_ARTICLES = `
  mutation bulkDeleteArticles($ids: [ID!]!) {
    bulkDeleteArticles(ids: $ids) {
      deletedCount
    }
  }
`

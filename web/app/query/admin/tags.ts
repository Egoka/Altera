// Запросы для админ-панели - управление тегами

export const GET_ADMIN_TAGS = `
  query getAdminTags($page: Int = 1, $limit: Int = 50) {
    adminSectionTags(page: $page, limit: $limit) {
      tags {
        id
        name
        slug
        description
        articlesCount
        createdAt
        updatedAt
      }
      totalCount
      totalPages
      currentPage
    }
  }
`

// Мутации для управления тегами
export const CREATE_TAG = `
  mutation createTag($input: CreateTagInput!) {
    createTag(input: $input) {
      id
      name
      slug
      description
    }
  }
`

export const UPDATE_TAG = `
  mutation updateTag($id: ID!, $input: UpdateTagInput!) {
    updateTag(id: $id, input: $input) {
      id
      name
      slug
      description
    }
  }
`

export const DELETE_TAG = `
  mutation deleteTag($id: ID!) {
    deleteTag(id: $id) {
      success
    }
  }
`

export const MERGE_TAGS = `
  mutation mergeTags($sourceTagId: ID!, $targetTagId: ID!) {
    mergeTags(sourceTagId: $sourceTagId, targetTagId: $targetTagId) {
      success
      articlesUpdated
    }
  }
`

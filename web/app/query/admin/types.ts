// Запросы для админ-панели - управление типами контента

export const GET_ADMIN_CONTENT_TYPES = `
  query getAdminContentTypes {
    adminContentTypes {
      id
      name
      slug
      description
      order
      status
      articlesCount
      createdAt
      updatedAt
    }
  }
`

// Мутации для управления типами контента
export const CREATE_CONTENT_TYPE = `
  mutation createContentType($input: CreateContentTypeInput!) {
    createContentType(input: $input) {
      id
      name
      slug
      description
      order
      status
    }
  }
`

export const UPDATE_CONTENT_TYPE = `
  mutation updateContentType($id: ID!, $input: UpdateContentTypeInput!) {
    updateContentType(id: $id, input: $input) {
      id
      name
      slug
      description
      order
      status
    }
  }
`

export const DELETE_CONTENT_TYPE = `
  mutation deleteContentType($id: ID!) {
    deleteContentType(id: $id) {
      success
    }
  }
`

export const REORDER_CONTENT_TYPES = `
  mutation reorderContentTypes($orders: [ContentTypeOrderInput!]!) {
    reorderContentTypes(orders: $orders) {
      success
    }
  }
`

export const ARCHIVE_CONTENT_TYPE = `
  mutation archiveContentType($id: ID!) {
    archiveContentType(id: $id) {
      id
      status
    }
  }
`

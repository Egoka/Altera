// Общие запросы для навигации и хедера

export const GET_NAVIGATION = `
  query getNavigation {
    contentTypes(status: active) {
      id
      name
      slug
      order
    }
    
    popularTags(limit: 10) {
      name
      slug
    }
  }
`

export const GET_USER_MENU = `
  query getUserMenu {
    me {
      id
      name
      slug
      photoUrl
      role
    }
  }
`

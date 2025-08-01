// Запросы для личного кабинета

export const GET_MY_PROFILE = `
  query getMyProfile {
    me {
      id
      name
      email
      bio
      photoUrl
      role
      slug
      socialLinks
      createdAt
    }
    
    myArticlesStats {
      total
      published
      draft
      review
      archived
    }
  }
`

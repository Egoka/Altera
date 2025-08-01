// Запросы и мутации для аутентификации

export const REQUEST_MAGIC_LINK = `
  mutation requestMagicLink($email: String!) {
    requestMagicLink(email: $email) {
      success
      message
    }
  }
`

export const VERIFY_MAGIC_LINK = `
  mutation verifyMagicLink($token: String!) {
    verifyMagicLink(token: $token) {
      token
      user {
        id
        name
        email
        role
        slug
      }
    }
  }
`

export const LOGOUT = `
  mutation logout {
    logout {
      success
    }
  }
`

export const UPDATE_PROFILE = `
  mutation updateProfile($input: UpdateProfileInput!) {
    updateProfile(input: $input) {
      id
      name
      bio
      photoUrl
      slug
      socialLinks
    }
  }
`

export const REFRESH_TOKEN = `
  mutation refreshToken {
    refreshToken {
      token
      user {
        id
        name
        email
        role
      }
    }
  }
`

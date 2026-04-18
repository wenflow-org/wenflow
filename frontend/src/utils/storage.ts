// 统一的 localStorage 管理
const TOKEN_KEY = 'token'
const USER_KEY = 'user'
const ADMIN_TOKEN_KEY = 'admin_token'
const ADMIN_USER_KEY = 'admin_user'

export const storage = {
  // Token
  getToken: () => localStorage.getItem(TOKEN_KEY),
  setToken: (token: string) => localStorage.setItem(TOKEN_KEY, token),
  removeToken: () => localStorage.removeItem(TOKEN_KEY),
  
  // User
  getUser: () => {
    const user = localStorage.getItem(USER_KEY)
    return user ? JSON.parse(user) : null
  },
  setUser: (user: object) => localStorage.setItem(USER_KEY, JSON.stringify(user)),
  removeUser: () => localStorage.removeItem(USER_KEY),
  
  // Admin Token
  getAdminToken: () => localStorage.getItem(ADMIN_TOKEN_KEY),
  setAdminToken: (token: string) => localStorage.setItem(ADMIN_TOKEN_KEY, token),
  removeAdminToken: () => localStorage.removeItem(ADMIN_TOKEN_KEY),
  
  // Admin User
  getAdminUser: () => {
    const user = localStorage.getItem(ADMIN_USER_KEY)
    return user ? JSON.parse(user) : null
  },
  setAdminUser: (user: object) => localStorage.setItem(ADMIN_USER_KEY, JSON.stringify(user)),
  removeAdminUser: () => localStorage.removeItem(ADMIN_USER_KEY),
  
  // Clear all
  clearAll: () => {
    localStorage.removeItem(TOKEN_KEY)
    localStorage.removeItem(USER_KEY)
    localStorage.removeItem(ADMIN_TOKEN_KEY)
    localStorage.removeItem(ADMIN_USER_KEY)
  },
  
  // Clear user session
  clearUserSession: () => {
    storage.removeToken()
    storage.removeUser()
  },
  
  // Clear admin session
  clearAdminSession: () => {
    storage.removeAdminToken()
    storage.removeAdminUser()
  }
}
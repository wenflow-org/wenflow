const PROJECTION_TOKEN_KEY = 'projection_token'
const PROJECTION_CONTEXT_KEY = 'projection_context'

export const getProjectionToken = (): string | null => localStorage.getItem(PROJECTION_TOKEN_KEY)

export const setProjectionToken = (token: string, context?: any) => {
  localStorage.setItem(PROJECTION_TOKEN_KEY, token)
  if (context) {
    localStorage.setItem(PROJECTION_CONTEXT_KEY, JSON.stringify(context))
  }
}

export const clearProjectionToken = () => {
  localStorage.removeItem(PROJECTION_TOKEN_KEY)
  localStorage.removeItem(PROJECTION_CONTEXT_KEY)
}

export const getProjectionContext = () => {
  const raw = localStorage.getItem(PROJECTION_CONTEXT_KEY)
  if (!raw) return null
  try {
    return JSON.parse(raw)
  } catch {
    return null
  }
}

export const isProjectionMode = () => Boolean(getProjectionToken())

import api from '@/utils/api'

export type DifficultyFit = 'too_easy' | 'appropriate' | 'too_hard'

export interface SubmitFeedbackParams {
  sessionId: string
  taskId: string
  rating: number
  helpfulness?: number
  clarity?: number
  difficulty?: number
  difficultyFit?: DifficultyFit
  comment?: string
  suggestions?: string
  confusionPoint?: string
  reasonCodes?: string[]
}

export interface FeedbackItem {
  id: string
  userId: string
  sessionId: string
  taskId: string | null
  agentId: string
  rating: number
  helpfulness: number | null
  clarity: number | null
  difficulty: number | null
  difficultyFit: DifficultyFit | null
  comment: string | null
  suggestions: string | null
  confusionPoint: string | null
  reasonCodes: string[]
  strategy: string | null
  uiType: string | null
  roundNumber: number | null
  status: 'new' | 'triaged' | 'resolved' | 'dismissed'
  createdAt: string
  updatedAt: string
}

export async function submitFeedback(params: SubmitFeedbackParams): Promise<FeedbackItem> {
  const { sessionId, ...data } = params
  const response = await api.put(`/feedback/sessions/${sessionId}`, data)
  return response.data || response
}

/** 消息级点赞/点踩：同一句 AI 回复内容去重（后端按内容哈希 key） */
export async function submitMessageFeedback(params: {
  sessionId: string
  messageText: string
  thumbsUp: boolean
  comment?: string
}): Promise<FeedbackItem> {
  const { sessionId, ...data } = params
  const response = await api.put(`/feedback/sessions/${sessionId}/message-thumbs`, data)
  return response.data || response
}

export async function getSessionFeedback(sessionId: string): Promise<FeedbackItem | null> {
  const response = await api.get(`/feedback/sessions/${sessionId}`)
  return response.data ?? null
}

export async function getMyFeedback(limit = 50, page = 1) {
  return api.get('/feedback/my-feedback', { params: { limit, page } })
}

export const feedbackApi = {
  submit: submitFeedback,
  submitMessage: submitMessageFeedback,
  getSession: getSessionFeedback,
  getMyFeedback
}

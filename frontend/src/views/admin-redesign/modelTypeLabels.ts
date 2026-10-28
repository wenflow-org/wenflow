/** 模型类型统一命名（2026-10-28 用户「都得用标准化命名来处理」）：
 *  模型表分组、基础设施编辑弹层与保存提示共用这一份词表，
 *  不再各写「对话 / 基础设施 / 向量化 / 重排」几套说法。 */
export const MODEL_TYPE_LABEL = {
  chat: '对话模型',
  reasoning: '推理模型',
  embedding: '向量模型',
  rerank: '重排模型'
} as const

export type ModelTypeKey = keyof typeof MODEL_TYPE_LABEL

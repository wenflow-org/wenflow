/**
 * 学习页会话消息域（V2LearningPage.vue 拆分）：消息形状与时间戳工具单源
 */
export interface ChatMsg { role: 'ai' | 'user'; text: string; time: string; failed?: boolean; confusion?: string[]; id?: string }

export function nowTime() {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

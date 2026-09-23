/**
 * 学习页会话消息域（V2LearningPage.vue 拆分）：消息形状与时间戳工具单源
 */
/** 教学配图（owner 口径：图片是一种特殊的文字）——内联在老师回复里的一张图，由一段文字描述生成。 */
export interface ChatImage {
  url: string;
  caption?: string | null;
  /** 生图用的文字描述（图 = 这段文字的渲染，可回溯） */
  prompt?: string;
  kind?: string | null;
}

export interface ChatMsg {
  role: 'ai' | 'user';
  text: string;
  time: string;
  failed?: boolean;
  confusion?: string[];
  /** 本轮老师临场附的教学配图（可选，内联在气泡里） */
  images?: ChatImage[];
  id?: string;
}

export function nowTime() {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

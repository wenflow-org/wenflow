/**
 * 学习页会话消息域（V2LearningPage.vue 拆分）：消息形状与时间戳工具单源
 */
import type { TeachingFigurePayload } from '@/api/aiTeaching';

/** 教学配图（owner 口径：图片是一种特殊的文字）——内联在老师回复里的一张图，由一段文字描述生成。 */
export interface ChatImage {
  url: string;
  caption?: string | null;
  /** 生图用的文字描述（图 = 这段文字的渲染，可回溯） */
  prompt?: string;
  kind?: string | null;
}

/**
 * 课堂结构图（2026-09-27 双通道重构）——老师给的 mermaid 源码，前端确定性渲染。
 * 与 ChatImage 的本质区别：不是生成物而是代码——零乱码、图内可写中文标签、毫秒渲染。
 */
export interface TeachingDiagram {
  engine: string;
  code: string;
  caption?: string | null;
}

/**
 * 位置线图（2026-09-27 双通道重构 Scope B）——空间位置关系的确定性渲染载荷。
 * 形状单源在 API 层（TeachingFigurePayload），此处只按消息域命名别名，避免两处漂移。
 */
export type TeachingFigure = TeachingFigurePayload;

/** 教师补充材料（活的 path 批次 E）：上一轮学生问到主线之外的信息，老师请求采集的公开网络资料。 */
export interface ChatSupplement {
  materialId: string;
  title: string;
  topic: string;
  sourceUrl?: string | null;
  excerpt: string;
}

export interface ChatMsg {
  role: 'ai' | 'user';
  text: string;
  time: string;
  failed?: boolean;
  confusion?: string[];
  /** 本轮老师临场附的教学配图（可选，内联在气泡里）。2026-09-27 扩散生图停用，仅历史消息会带。 */
  images?: ChatImage[];
  /** 课堂结构图（2026-09-27 双通道重构）——mermaid 源码，确定性渲染，内联在气泡里 */
  diagrams?: TeachingDiagram[];
  /** 位置线图（Scope B）——结构化数值域，确定性渲染成 SVG，内联在气泡里 */
  figures?: TeachingFigure[];
  /** 本轮送达的教师补充材料卡片（可选，气泡下方） */
  supplement?: ChatSupplement;
  id?: string;
}

export function nowTime() {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/**
 * 平台模型按用途分类（2026-10-24 用户「思考平台模型分几种」）。
 *
 * 上游 /models 会把所有模态混成一张清单（对话、向量、重排、生图、视频、音频、决策）。
 * 平台里它们各有归属，不能都点「添加」进 LLM 模型目录：
 *   对话   → 模型供应商 · 平台 · 模型（llm-providers.json，Agent/Skill 用）
 *   向量   → 模型供应商 · 平台 · 基础设施（embedding）
 *   重排   → 模型供应商 · 平台 · 基础设施（rerank）
 *   生图   → 插件 · 生图 · 服务配置
 *   决策   → 插件 · 决策 · 服务配置
 *   视频 / 音频 / 其他 → 暂无消费链路，不提供登记入口
 *
 * 上游没有类型元数据，只能按命名约定识别；未命中一律按对话处理（LLM 通道的主体）。
 */

export type PlatformModelKind =
  | 'chat'
  | 'embedding'
  | 'rerank'
  | 'image'
  | 'video'
  | 'audio'
  | 'decision'
  | 'other';

export const MODEL_KIND_LABEL: Record<PlatformModelKind, string> = {
  chat: '对话',
  embedding: '向量',
  rerank: '重排',
  image: '生图',
  video: '视频',
  audio: '音频',
  decision: '决策',
  other: '其他',
};

/** 非对话模型在列表里的排列顺序：先基础设施，再生成，最后未接入 */
export const MODEL_KIND_ORDER: PlatformModelKind[] = [
  'embedding',
  'rerank',
  'image',
  'decision',
  'video',
  'audio',
  'other',
];

/** 非对话模型在界面上的去向：基础设施页签 / 插件页 / 暂无入口 */
export type PlatformModelTarget = 'infra' | 'plugins' | null;

const KIND_RULES: Array<[RegExp, PlatformModelKind]> = [
  // 先判重排：bge-reranker 同时命中 bge
  [/rerank/i, 'rerank'],
  [/embedding|(^|\/)bge-(?!reranker)|text-embedding/i, 'embedding'],
  [/image|diffusion|(^|[-_/])(flux|sdxl|dall-e|stable-diffusion)([-_/]|$)/i, 'image'],
  [/video|(^|[-_/])(sora|veo|kling|runway)([-_/]|$)/i, 'video'],
  [/audio|(^|[-_/])(asr|tts|whisper|speech)([-_/]|$)/i, 'audio'],
  [/decision|(^|\/)jev[-.]/i, 'decision'],
  [/router|routing/i, 'other'],
];

export function modelKindOf(modelId: string | null | undefined): PlatformModelKind {
  const id = String(modelId || '').trim();
  if (!id) return 'chat';
  for (const [re, kind] of KIND_RULES) if (re.test(id)) return kind;
  return 'chat';
}

export function modelTargetOf(kind: PlatformModelKind): PlatformModelTarget {
  if (kind === 'embedding' || kind === 'rerank') return 'infra';
  if (kind === 'image' || kind === 'decision') return 'plugins';
  return null;
}

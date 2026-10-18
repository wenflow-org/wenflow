/**
 * 视觉内容块工具（2026-10-18 #123）。
 *
 * 平台模型调用链的多模态入口：把「文本 + 图片」拼成 OpenAI 兼容的 content 数组
 * （`[{ type: 'text' }, { type: 'image_url' }]`）。三条纪律：
 *  - **纯文本回退**：没有有效图片时返回原文本字符串（请求形态与既有链路逐字节一致）；
 *  - **URL 白名单**：只接受 `data:image/*;base64,` 与 http(s)，其余形态跳过（不进请求，
 *    避免把垃圾塞给上游换来一个难排查的 400）；
 *  - **体积闸**：单条消息携带的图片数有上限，超出保留**最近**的（历史配图回流场景下，
 *    越近的图越相关）；超限记 warn，不静默。
 *
 * 能力把关不在这里：生效模型是否声明 vision 由调用层（prompt-composer）按模型注册表判定，
 * 网关执行器再做硬闸门（带图请求打到未声明视觉的模型直接拒绝，见 executor.assertVisionAllowed）。
 */
import type { ChatContentPart, ChatMessageContent } from '../gateway/api-gateway/types';
import { logger } from './logger';

/** 单条消息（一次请求的一个 content 块数组）最多携带的图片数 */
export const MAX_VISION_IMAGES_PER_MESSAGE = 4;

export interface VisionImageRef {
  url: string;
  caption?: string | null;
}

/** 是否可作为视觉输入：`data:image/*;base64`（非 svg）或 http(s) URL。 */
export function isVisionImageUrl(url: unknown): url is string {
  // svg 排除：OpenAI 兼容端点接受 png/jpeg/webp/gif，不接受 svg+xml（发了只会换回一个 400）
  return typeof url === 'string' && /^(data:image\/(?!svg)[a-z0-9.+-]+;base64,|https?:\/\/)/i.test(url.trim());
}

/**
 * 规范化图片列表：过滤非法 URL、按上限截取**最近**的若干张。
 * 返回空数组表示"无有效图片"（调用方据此走纯文本回退）。
 */
export function normalizeVisionImages(
  images: Array<VisionImageRef | null | undefined> | undefined | null,
  options: { max?: number; context?: string } = {}
): VisionImageRef[] {
  const max = options.max ?? MAX_VISION_IMAGES_PER_MESSAGE;
  const valid = (Array.isArray(images) ? images : []).filter(
    (image): image is VisionImageRef => isVisionImageUrl(image?.url)
  );
  const invalid = (Array.isArray(images) ? images : []).length - valid.length;
  if (invalid > 0) {
    logger.warn('[vision-content] 跳过非法图片 URL（仅接受 data:image/*;base64 与 http(s)）', {
      context: options.context,
      invalid,
    });
  }
  if (valid.length <= max) return valid;
  logger.warn('[vision-content] 图片数超过单条消息上限，保留最近的若干张', {
    context: options.context,
    total: valid.length,
    max,
  });
  return valid.slice(-max);
}

/**
 * 文本 + 图片 → OpenAI 兼容内容块。无有效图片时返回纯文本（回退）。
 * 每张图前插一行标签，帮助模型把图和上下文对上（label 如「课堂配图」）。
 */
export function buildVisionContent(
  text: string,
  images: Array<VisionImageRef | null | undefined> | undefined | null,
  options: { label?: string; max?: number; context?: string } = {}
): ChatMessageContent {
  const valid = normalizeVisionImages(images, { max: options.max, context: options.context });
  if (valid.length === 0) return text;
  const parts: ChatContentPart[] = [{ type: 'text', text }];
  for (const image of valid) {
    const label = options.label || '配图';
    const caption = typeof image.caption === 'string' ? image.caption.trim() : '';
    parts.push({ type: 'text', text: caption ? `【${label}】${caption}` : `【${label}】` });
    parts.push({ type: 'image_url', image_url: { url: image.url.trim() } });
  }
  return parts;
}

/** buildVisionContent 生成的图片标签行前缀；strip 时用于连带移除（不留悬空标签行） */
const VISION_LABEL_PREFIXES = ['【课堂配图】', '【配图】', '【本轮输入图片】'];

/**
 * 从内容块里摘掉图片（保留文本块）。用于「生效模型未声明 vision」时降级为纯文本：
 * 只剩一个文本块时收敛回字符串，保持请求形态最简。
 * 同时移除**紧跟在被摘图片前、由本模块生成的标签行**——否则模型会看到
 * 「【课堂配图】」却没有图，白占 token 还容易被追问。
 */
export function stripVisionImages(content: ChatMessageContent): ChatMessageContent {
  if (!Array.isArray(content)) return content;
  const kept: ChatContentPart[] = [];
  content.forEach((part, index) => {
    if (part?.type === 'image_url') return;
    if (part?.type === 'text') {
      const next = content[index + 1];
      const isGeneratedLabel = VISION_LABEL_PREFIXES.some((prefix) => (part.text || '').startsWith(prefix));
      if (isGeneratedLabel && next?.type === 'image_url') return;
      kept.push(part);
      return;
    }
    kept.push(part);
  });
  const texts = kept.filter((part): part is Extract<ChatContentPart, { type: 'text' }> => part?.type === 'text');
  if (texts.length === 0) return '';
  if (texts.length === 1) return texts[0].text;
  return kept;
}

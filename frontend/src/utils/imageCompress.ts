/**
 * 教学聊天图片压缩（2026-11-12 用户发图给 AI 导师 · 视觉通道）：
 * File → canvas 下采样（最长边 1280px）→ JPEG data URL。
 *
 * 契约口径（后端 `/messages` 校验同源）：images 最多 4 张、url 为 data URL、
 * 后端超限返回 400。前端在此把单张压到目标 ≤400KB（超了降 quality 0.85→0.7 再试一次），
 * 原图 >15MB 或非图片类型直接拒绝（抛 ImageValidationError，调用方 toast 原文案）。
 */

/** 图片规则单源：输入框上限与压缩参数都在这里，页面侧引用同一份 */
export const CHAT_IMAGE_RULES = {
  /** 一次最多随消息发送几张 */
  maxCount: 4,
  /** 原图大小上限：超过直接拒绝（不进 canvas，省一次无意义解码） */
  maxOriginalBytes: 15 * 1024 * 1024,
  /** 下采样后最长边（px） */
  maxSide: 1280,
  /** 首次编码质量 */
  quality: 0.85,
  /** 超出目标体积后的降级质量（只降一次） */
  retryQuality: 0.7,
  /** 单张压缩目标上限（data URL 的二进制体积估算） */
  maxCompressedBytes: 400 * 1024,
} as const;

/** 图片不合规（类型/大小/无法解码）：message 可直接作为 toast 文案 */
export class ImageValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ImageValidationError';
  }
}

/** 校验原图：类型必须是图片、大小 ≤15MB */
export function validateChatImageFile(file: File): void {
  if (!file || !file.type || !file.type.startsWith('image/')) {
    throw new ImageValidationError('只能发送图片（PNG / JPEG / WebP）');
  }
  if (file.size > CHAT_IMAGE_RULES.maxOriginalBytes) {
    throw new ImageValidationError('这张图片超过 15MB，请压缩后再发');
  }
}

/** File → 解码后的 Image（objectURL 加载，用完即收回） */
function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new ImageValidationError('这张图片无法读取，换一张试试'));
    };
    img.src = url;
  });
}

/** 下采样绘制：最长边压到 maxSide（只缩不放）；JPEG 无透明通道，透明区铺白底防黑块 */
function drawDownscaled(img: HTMLImageElement, maxSide: number): HTMLCanvasElement {
  const scale = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight, 1));
  const w = Math.max(1, Math.round(img.naturalWidth * scale));
  const h = Math.max(1, Math.round(img.naturalHeight * scale));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new ImageValidationError('当前浏览器不支持图片压缩，请直接输入文字');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(img, 0, 0, w, h);
  return canvas;
}

/** data URL 的二进制体积估算（base64：4 字符 ≈ 3 字节，去掉 data:image/...;base64, 前缀） */
function dataUrlBytes(dataUrl: string): number {
  const comma = dataUrl.indexOf(',');
  const payload = comma >= 0 ? dataUrl.slice(comma + 1) : dataUrl;
  return Math.floor((payload.length * 3) / 4);
}

/**
 * 压缩单张图片为 JPEG data URL：
 * 0.85 编码 → 仍超 400KB 则用 0.7 再编码一次（契约只降一次）。
 * 解码/编码失败抛 ImageValidationError（message 可直接 toast）。
 */
export async function compressChatImage(file: File): Promise<string> {
  validateChatImageFile(file);
  const img = await loadImage(file);
  const canvas = drawDownscaled(img, CHAT_IMAGE_RULES.maxSide);
  const first = canvas.toDataURL('image/jpeg', CHAT_IMAGE_RULES.quality);
  if (dataUrlBytes(first) <= CHAT_IMAGE_RULES.maxCompressedBytes) return first;
  return canvas.toDataURL('image/jpeg', CHAT_IMAGE_RULES.retryQuality);
}

/**
 * 消息 markdown 渲染缓存（对象级 WeakMap）。
 * 流式渲染性能关键：避免每次 delta 都重跑 markdown + DOMPurify。
 * 学习页（htmlFor）与 ChatMessageList 共用同一实现，消除重复。
 *
 * 注意：缓存按「对象引用」键控（消息对象稳定），流式文本（字符串字面量）
 * 不适合此缓存——直接用 renderAiMessageHtml。
 */
import { renderAiMessageHtml } from '@/utils/sanitize';

const htmlCache = new WeakMap<object, { text: string; html: string }>();

/** 按消息对象取缓存 HTML；内容变化（编辑/流式追加）时重渲染 */
export function cachedMessageHtml(m: { text: string }): string {
  const hit = htmlCache.get(m);
  if (hit && hit.text === m.text) return hit.html;
  const html = renderAiMessageHtml(m.text);
  htmlCache.set(m, { text: m.text, html });
  return html;
}

/** 无缓存直渲染（适合流式文本/一次性内容） */
export function plainMessageHtml(text: string | null | undefined): string {
  return renderAiMessageHtml(text);
}

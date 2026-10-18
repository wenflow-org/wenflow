/**
 * 模拟器 payload 发送前投影（virtual-learner-* 共用）
 *
 * 背景：`virtual_learner_profiles.profile` 里带着 `storyPool`（该角色的全部故事）。
 * 设计意图是"这个人有生活史、更立体"，但直接把池子整包倒给模拟器有两个问题：
 *  1. 池里每条都含 `hiddenDetails / disclosurePlan / goalSeed` 等**别的故事的私有底牌** → 扮演会串场/泄露；
 *  2. 全库画像当前都只有 1 条故事，池子等同于当前 `story` 的改名副本（纯重复体积）。
 *
 * 因此发送前把任意位置的 `storyPool` 收敛为 `storyHistory`（只留标题 + 一句话概述），
 * 既保留"生活史"的立体感，又不泄露其他故事的私有细节。
 */

export interface StoryHistoryItem {
  title: string;
  summary: string;
}

/** 可见上下文历史随带的教学配图引用（#123）：url + 可选说明 */
export interface VisibleHistoryImage {
  url: string;
  caption?: string | null;
}

/**
 * 从可见上下文历史里收集随带配图（#123）：保持历史顺序（早→晚），
 * 由 `buildVisionContent` 做 URL 白名单与数量上限收口。
 * 注意：图片**不进 payload JSON**（base64 会白烧 token 且模型读不到像素），
 * 只作为请求消息的 image_url 内容块随 payload 一起发送。
 */
export function collectVisibleHistoryImages(history: unknown): VisibleHistoryImage[] {
  if (!Array.isArray(history)) return [];
  return history.flatMap((message: unknown) => {
    const images = (message as { images?: unknown } | null)?.images;
    return Array.isArray(images) ? (images as VisibleHistoryImage[]) : [];
  });
}

const STORY_HISTORY_LIMIT = 12;
const STORY_SUMMARY_MAX = 160;

/** 故事池 → 人生轨迹（标题 + 一句话概述；剔除私有字段） */
export function projectStoryPoolToHistory(pool: unknown): StoryHistoryItem[] {
  if (!Array.isArray(pool)) return [];
  return pool.slice(0, STORY_HISTORY_LIMIT).flatMap((item) => {
    if (!item || typeof item !== 'object') return [];
    const story = item as Record<string, unknown>;
    const title = typeof story.title === 'string' ? story.title.trim() : '';
    const rawOutline = typeof story.storyOutline === 'string'
      ? story.storyOutline
      : (typeof story.outline === 'string' ? story.outline : '');
    const summary = rawOutline.trim().replace(/\s+/g, ' ').slice(0, STORY_SUMMARY_MAX);
    if (!title && !summary) return [];
    return [{ title, summary }];
  });
}

/**
 * 发送前投影（deep）：把 payload 里任意深度/任意父键下的 `storyPool` 收敛为 `storyHistory`；
 * 其余字段原样保留。对非对象/数组原样返回。
 */
export function projectSimulatorPayload<T>(value: T): T {
  return walk(value) as T;
}

function walk(value: any): any {
  if (Array.isArray(value)) return value.map(walk);
  if (!value || typeof value !== 'object') return value;
  const out: Record<string, any> = {};
  for (const [key, child] of Object.entries(value)) {
    if (key === 'storyPool') {
      const history = projectStoryPoolToHistory(child);
      if (history.length) out.storyHistory = history;
      continue;
    }
    out[key] = walk(child);
  }
  return out;
}

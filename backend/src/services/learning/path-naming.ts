/**
 * 路径名称的**交付口径**唯一来源（与 `path-difficulty.ts` 同族：**难度归难度，命名归命名**）。
 *
 * 背景（2026-09-21 实测）：
 * - 路径名此前被规定为"核心主题/技能 + **水平词**"（如"Python 自动化 Excel 报表入门"）；
 * - 全库 **76%（185/243）** 路径名含水平词，其中「入门」独占 **170** 条；近一周仍是 75%；
 * - `name` / `title` / `subject` 三列同值，前端直接渲染（`V2LearningPaths.vue`：`p.title || p.name`）
 *   ⇒ 用户读到的**第一句话**就是"入门"；
 * - 而水平词描述的是**起点**（系统该假设你从哪开始），用户读到的却是**终点**（"我最后能到哪"）
 *   ⇒ 系统性低估交付、拉低初始路径接受度（虚拟实验室实测：初始接受率仅 8.6%，85% 要求修改）。
 *
 * 结论：**水平词不再进入用户可见的名称**；难度信息继续走 `difficulty` 列（`path-difficulty.ts`）。
 * 本模块只做**确定性剔除**（不新增 LLM 调用、不改写语义），且剔除是**可见的**——
 * 返回值带 `stripped` 列表，调用方负责打标（约定：允许降级，不允许未打标降级）。
 *
 * 剔除范围（保守：只动"显然是水平标签"的位置，避免误伤主题词）：
 *   1. 名称**末尾**的水平词（可连续多个，如"…基础入门"）；
 *   2. 名称**开头**的"从零开始 / 零基础 / 零起点"前缀；
 *   3. 整个名称本身就是水平词的退化情况 → **保持原样**（空标题更糟，交给调用方兜底）。
 * **不**剔除名称中部的水平词：`知识管理系统搭建` 的「系统」、`基础理财规划` 的「基础」
 * 是主题词而非水平标签（`系统` 已从词表排除，「基础」仅在中部保留）。
 */

/** 交付口径水平词（**仅在这些词位于名称首/尾时**才视为标签）。`系统` 故意不在表内。 */
export const DELIVERY_LEVEL_WORDS = [
  '入门',
  '起步',
  '初学',
  '新手',
  '零基础',
  '零起点',
  '进阶',
  '中级',
  '高级',
  '高阶',
  '精通',
  '实战',
  '基础',
] as const;

/** 名称开头的水平前缀（"从零开始学 Python"这类） */
const LEADING_LEVEL_WORDS = ['从零开始', '零基础', '零起点'] as const;

/** 分隔符（水平词可能与主题之间隔着空格/顿号/破折号） */
const SEP = '[\\s，,、·・\\-—–~至到:：]*';

function escapeRe(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const TRAILING_RE = new RegExp(`^(.*?[^\\s])${SEP}(${DELIVERY_LEVEL_WORDS.map(escapeRe).join('|')})$`);
const LEADING_RE = new RegExp(`^(${LEADING_LEVEL_WORDS.map(escapeRe).join('|')})${SEP}(.+)$`);
/** 整名由水平词构成（"零基础"/"入门基础"/"从零开始"）——退化情况，必须保持原样 */
const ALL_LEVEL_RE = new RegExp(
  `^(?:${[...LEADING_LEVEL_WORDS, ...DELIVERY_LEVEL_WORDS].map(escapeRe).join('|')})`
  + `(?:${SEP}(?:${[...LEADING_LEVEL_WORDS, ...DELIVERY_LEVEL_WORDS].map(escapeRe).join('|')}))*$`,
);

export interface DeliveryLevelStripResult {
  /** 剔除后的名称（若剔除会得到空串，则保持原样） */
  title: string;
  /** 实际剔除掉的水平词（按出现顺序）；空数组表示未命中 */
  stripped: string[];
}

/**
 * 从路径名称中剔除"交付口径水平词"。
 * 纯函数，幂等（再次调用不会产生新变化）。
 */
export function stripDeliveryLevelWords(rawTitle: string): DeliveryLevelStripResult {
  const original = typeof rawTitle === 'string' ? rawTitle.trim() : '';
  if (!original) return { title: '', stripped: [] };
  // 退化：整名就是水平词（"零基础"/"入门基础"）⇒ 保持原样，绝不产出空标题或残字（曾把"零基础"剔成"零"）
  if (ALL_LEVEL_RE.test(original)) return { title: original, stripped: [] };

  const stripped: string[] = [];
  let current = original;

  // 1) 开头的水平前缀（"从零开始学 Excel" → "学 Excel"）
  const leading = current.match(LEADING_RE);
  if (leading) {
    const head = leading[2].trim();
    if (head) {
      stripped.push(leading[1]);
      current = head;
    }
  }

  // 2) 末尾的水平词，可连续剔除（"…基础入门" → "…"）
  for (;;) {
    const match = current.match(TRAILING_RE);
    if (!match) break;
    const head = match[1].trim();
    // 剔除后会变空 ⇒ 整名就是水平词（退化），保持原样、不记录
    if (!head) return { title: original, stripped: [] };
    stripped.push(match[2]);
    current = head;
  }

  return { title: stripped.length ? current : original, stripped };
}

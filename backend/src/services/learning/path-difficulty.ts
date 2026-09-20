/**
 * 路径难度（`learning_paths.difficulty` / `learnerProfile.currentBaseline.level`）的**唯一枚举口径**。
 *
 * 背景（255 例扫测实测）：这一列此前没有任何契约——
 *   生产端 `path-generation.core.ts` 写的是 `data.userProfile?.skillLevel || 'beginner'`（缺省硬编码 beginner），
 *   而上游 `skillLevel` 来自 goal 的自由文本 `current_baseline.level`，
 *   结果库里同一列混着 `beginner` / `零基础` / `新手` / `入门` **以及整句自述**
 *   （如"非零基础：护理本科、ICU 临床十几年…"、"能跑 pandas groupby 与尝试 Plotly，但缺失值处理不熟"）。
 *   下游 `path-planning` 提示词却按 `== beginner` 语义决定路径标题（93.7% 因此都叫"入门/基础"）。
 *
 * 本模块把两侧收敛到同一枚举，并**不再把"缺失/无法判断"默认成 `beginner`**：
 *   - 空 / 非字符串 / 长句自述 → `unknown`（明确"不知道"，让下游走中性分支）；
 *   - 只有明确表达零基础/无经验的短词才判 `beginner`。
 *
 * 纯函数、无副作用，可直接单测。
 */

export const PATH_DIFFICULTY_LEVELS = ['beginner', 'intermediate', 'advanced', 'unknown'] as const;
export type PathDifficulty = (typeof PATH_DIFFICULTY_LEVELS)[number];

/** 超过这个长度就视为"自述句"而非"水平标签"，一律 unknown（不猜）。 */
const SELF_DESCRIPTION_MAX_LENGTH = 24;

const BEGINNER_PATTERN = /零基础|零编程|入门|新手|初学|没学过|从没接触|beginner|basic|novice/;
const INTERMEDIATE_PATTERN = /中级|进阶|有一定基础|有点基础|intermediate|medium/;
const ADVANCED_PATTERN = /高级|资深|熟练|精通|专家|advanced|expert/;

/**
 * 把任意来源的水平值归一为枚举。
 * 注意：**不提供 fallback 参数**——"缺省即 beginner" 正是本次要修的缺陷。
 */
export function normalizePathDifficulty(raw: unknown): PathDifficulty {
  const text = typeof raw === 'string' ? raw.trim() : '';
  if (!text) return 'unknown';

  const lower = text.toLowerCase();
  if ((PATH_DIFFICULTY_LEVELS as readonly string[]).includes(lower)) {
    return lower as PathDifficulty;
  }

  // 自述长句：即使是"非零基础：…"也不猜（信息在 evidence 里，不在枚举里）
  if (text.length > SELF_DESCRIPTION_MAX_LENGTH) return 'unknown';

  if (BEGINNER_PATTERN.test(lower)) return 'beginner';
  if (ADVANCED_PATTERN.test(lower)) return 'advanced';
  if (INTERMEDIATE_PATTERN.test(lower)) return 'intermediate';
  return 'unknown';
}

/** 是否契约枚举值（供校验/断言用）。 */
export function isPathDifficulty(value: unknown): value is PathDifficulty {
  return typeof value === 'string' && (PATH_DIFFICULTY_LEVELS as readonly string[]).includes(value);
}

/**
 * 虚拟学习者负荷画像的「会话承载 → GoalPathRequest」接线（纯函数）。
 *
 * 数据流（刻意用**数据**而非依赖把虚拟实验室的负荷画像接进真实生成入口）：
 *   虚拟学习者创建 Goal 会话时把负荷画像写入 `collectedData.learnerLoadProfile`
 *   → `goal-conversation.service.buildGoalPathRequest` 读回并透传为
 *     `GoalPathRequest.learnerLoadProfile`
 *   → `path.coordinator` → `derivePlanningHints` 收紧里程碑数 / 单任务分钟 / 周期。
 *
 * 真实用户链路不写该字段 ⇒ 这里返回 `null`，路径体量推导与今天完全一致。
 */
import type { LearnerLoadProfile } from './path-planning-hints';

/** `goal_conversations.collectedData` 中承载负荷画像的顶层键。 */
export const CONVERSATION_LOAD_PROFILE_KEY = 'learnerLoadProfile';

/**
 * 归一化任意来源的负荷画像：只保留非空字符串字段；两者都空则返回 `null`。
 * 用于把 `virtual_learner_profiles.profile` 的自由文本安全地落到会话上。
 */
export function normalizeLearnerLoadProfile(value: unknown): LearnerLoadProfile | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Record<string, unknown>;
  const availableTime = typeof raw.availableTime === 'string' && raw.availableTime.trim()
    ? raw.availableTime.trim()
    : null;
  const loadTolerance = typeof raw.loadTolerance === 'string' && raw.loadTolerance.trim()
    ? raw.loadTolerance.trim()
    : null;
  if (!availableTime && !loadTolerance) return null;
  return { availableTime, loadTolerance };
}

/**
 * 从 Goal 会话 `collectedData` 读取负荷画像。
 * 缺失 / 形状非法 / 值为空（真实用户的常态）一律返回 `null`。
 */
export function resolveLearnerLoadProfileFromCollectedData(
  collectedData: unknown
): LearnerLoadProfile | null {
  if (!collectedData || typeof collectedData !== 'object') return null;
  return normalizeLearnerLoadProfile(
    (collectedData as Record<string, unknown>)[CONVERSATION_LOAD_PROFILE_KEY]
  );
}

/** 前置探测题作答结果（goal skill 产出 → path 消费）的最小结构。 */
export interface PrerequisiteCheckResultShape {
  probeId?: string;
  targetConcept?: string;
  userAnswer?: string;
  isCorrect?: boolean;
}

/**
 * 从 goal 层 `understanding` 读取前置探测题作答结果并透传给 Path。
 *
 * 该字段由 goal skill 落进 `collectedData.understanding.prerequisiteCheckResults`，
 * path-planning 的规则与代码都消费它（用于「防自评虚高」）；但确认生成路径的主流程
 * 此前**从未把它放进 `GoalPathRequest`** ⇒ 探测结果在正常流程里不生效，只有旁路
 * 路由能捞回。这里做与负荷画像相同的接线：形状非法一律 `null`，下游按「无探测」处理。
 */
export function resolvePrerequisiteCheckResultsFromUnderstanding(
  understanding: unknown
): PrerequisiteCheckResultShape[] | null {
  if (!understanding || typeof understanding !== 'object') return null;
  const results = (understanding as Record<string, unknown>).prerequisiteCheckResults;
  return Array.isArray(results) && results.length > 0
    ? (results as PrerequisiteCheckResultShape[])
    : null;
}

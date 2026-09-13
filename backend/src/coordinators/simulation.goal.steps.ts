// 模拟协调器 - Goal 阶段步进纯工具函数（自 simulation.coordinator.ts 抽离，行为保持不变；无 this / prisma）
import type { StageResults } from '../virtual-lab/vlab-types';
import type {
  ConversationHistoryItem,
  GoalConcernPool,
  SimulationContext,
  SimulationLogEntry,
  SimulationStepResult,
  VirtualLearnerProfile
} from './simulation.types';
import { safeJsonParse } from '../utils/safe-json';
import {
  buildGoalConcernPool,
  parseStoryContextFromStageResults,
  sanitizeVisibleDialogue
} from './simulation.helpers';

/**
 * 解析 Goal 对话的 collectedData：提取 sanitize 后的可见历史与最后一条助手消息。
 * 解析失败保留默认值（空历史）。
 */
export function parseGoalConversationHistory(
  collectedData: string | null | undefined
): { history: ConversationHistoryItem[]; lastAssistantMessage: string } {
  let history: Array<{ role: 'user' | 'assistant'; content: string }> = [];
  try {
    const parsed = JSON.parse(collectedData || '{}');
    const rawMessages = parsed.messages || [];
    history = rawMessages.map((m: { role?: string; content?: unknown }) => ({
      role: m.role === 'user' ? 'user' : 'assistant',
      content: sanitizeVisibleDialogue(typeof m.content === 'string' ? m.content : '')
    })).filter((m: { role: 'user' | 'assistant'; content: string }) => !!m.content);
  } catch { /* 解析失败时保留默认值 */ }

  const lastAssistantMessage = history.length > 0
    ? history.filter(m => m.role === 'assistant').pop()?.content || ''
    : history.filter(m => m.role !== 'user').pop()?.content || '';

  return { history, lastAssistantMessage };
}

/**
 * 解析 Goal 回合状态：stageResults / goalState / 既有 goal 段 / 故事上下文 / concernPool / 已披露关切。
 */
export function resolveGoalTurnState(params: {
  profile: VirtualLearnerProfile;
  stageResultsRaw: string | null | undefined;
  collectedData: string | null | undefined;
}): {
  stageResults: StageResults;
  goalState: SimulationContext['goalState'];
  existingGoalState: Record<string, unknown>;
  activeStoryContext: SimulationContext['storyContext'];
  concernPool: GoalConcernPool;
  disclosedConcerns: string[];
} {
  const { profile, stageResultsRaw, collectedData } = params;
  const goalState: SimulationContext['goalState'] = safeJsonParse<SimulationContext['goalState']>(collectedData, {});

  const stageResults: StageResults = safeJsonParse<StageResults>(stageResultsRaw, {});

  const existingGoalState = (stageResults.goal || {}) as Record<string, unknown>;
  const activeStoryContext = parseStoryContextFromStageResults(stageResults);
  const concernPool: GoalConcernPool = (existingGoalState.concernPool as GoalConcernPool | undefined) || buildGoalConcernPool(profile, goalState);
  const disclosedConcerns = (existingGoalState.disclosedConcerns || []) as string[];

  return { stageResults, goalState, existingGoalState, activeStoryContext, concernPool, disclosedConcerns };
}

/**
 * 组装 Goal 回复分支的成功返回（不含开场分支）。
 */
export function buildGoalStepResult(params: {
  virtualUserReply: string;
  goalResponse: {
    userVisible: string;
    stage: string;
    confidence: number;
    quickReplies?: string[];
  };
  goalReady: boolean;
  logs: SimulationLogEntry[];
}): SimulationStepResult {
  return {
    success: true,
    virtualUserReply: params.virtualUserReply,
    goalConversationResponse: params.goalResponse,
    currentStage: params.goalReady ? 'path' : 'goal',
    goalReady: params.goalReady,
    logs: params.logs
  };
}

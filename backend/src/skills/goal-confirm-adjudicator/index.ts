/**
 * goal-confirm-adjudicator —— goal 会话确认裁决器（handler-only 小 skill，2026-11-08 确认动作减重）。
 *
 * 只回答一件事：用户刚说的这段话是否表达「就要这个方案、开始排路径」。
 * 过去这个判定由后端白名单 + confirmIntent hidden 布尔 + 拒绝否决正则三件套接力，
 * 现在收敛为一次 temperature 0 的聚焦裁决调用；调用失败一律 fail-open 按非确认处理
 * （落库走正常回合，行为与旧白名单未命中一致），误确认生成没人要的路径比不确认伤。
 *
 * 形态照 material-collector 混合成例：handler-only 注册（不进 agentMembers、不进字段路由），
 * 内含一个 LLM 环节，prompt 由 prompts/core/goal-confirm-adjudicator.yaml 编译产物承载。
 *
 * 定位声明（2026-11-08）：本 skill 走平台基础模型与标准网关链路（callPrompt），与 decision
 * 插件（decision-gate / services/decision）无关——决策模型是可选插件、不是平台基础建设，
 * 任何业务链路不得硬依赖它；换快模型用 skill_model_configs 的 per-skill 配置，不引入插件依赖。
 */
import { callPrompt } from '../../composers/prompt-composer';
import { loadPromptFile } from '../../composers/prompt-files/loader';
import { SkillDefinition, SkillExecutionResult } from '../protocol';
import { recordDegradation, degradationCause } from '../degradation-telemetry';

export const GOAL_CONFIRM_ADJUDICATOR_PROMPT = loadPromptFile('skill:goal-confirm-adjudicator')?.systemPrompt || '';

export interface GoalConfirmAdjudicatorInput {
  /** 用户刚发出的这段话（原文） */
  userUtterance: string;
  /** 当前展示给用户的方案摘要（learning_direction / first_deliverable；可为空对象） */
  proposal?: { learning_direction?: string; first_deliverable?: string } | null;
  /** 导师上一条回复的尾部摘录（含收尾问句），供判断「就照你说的办」指向什么 */
  lastAssistantExcerpt?: string;
}

export interface GoalConfirmAdjudicatorOutput {
  /** 用户这段话是否表达「就要这个方案、开始排路径」 */
  confirm: boolean;
}

/** 裁决来源：adjudicator=模型判定；fail-open=调用失败兜底（按非确认，走正常回合） */
export type GoalConfirmVerdictSource = 'adjudicator' | 'fail-open';

export interface GoalConfirmVerdict extends GoalConfirmAdjudicatorOutput {
  source: GoalConfirmVerdictSource;
}

/** 经 callPrompt 调用 skill:goal-confirm-adjudicator 的 ACTIVE prompt；单测经依赖注入替换本层。 */
export async function executeGoalConfirmAdjudicator(
  input: GoalConfirmAdjudicatorInput
): Promise<SkillExecutionResult<GoalConfirmAdjudicatorOutput>> {
  const result = await callPrompt<GoalConfirmAdjudicatorInput, GoalConfirmAdjudicatorOutput>({
    agentId: 'skill:goal-confirm-adjudicator',
    defaultSystemPrompt: GOAL_CONFIRM_ADJUDICATOR_PROMPT,
    requireActivePrompt: true,
    caller: { skillId: 'goal-confirm-adjudicator' },
    retryStrategy: { maxAttempts: 2 },
    buildUserPayload: (payload) => payload,
    normalizeOutput: (parsed) => {
      const obj = (parsed && typeof parsed === 'object' ? parsed : {}) as Record<string, unknown>;
      return { confirm: obj.confirm === true };
    },
    validateParsedOutput: (parsed) =>
      parsed && typeof parsed === 'object'
        ? { valid: true }
        : { valid: false, failureReason: 'GOAL_CONFIRM_ADJUDICATOR_OUTPUT_NOT_OBJECT' },
  }, input);

  if (!result.success || !result.output) {
    const message = result.error?.message || 'GOAL_CONFIRM_ADJUDICATOR_FAILED';
    return { success: false, duration: 0, error: { code: 'GOAL_CONFIRM_ADJUDICATOR_FAILED', message } };
  }
  return { success: true, output: result.output, duration: 0 };
}

/**
 * 面向业务的裁决入口（fail-open 封装）：goal 会话 service 在 proposing 阶段收到打字消息时调用。
 * 任何失败（LLM 调用、超时、输出非法）都按非确认处理并留 P3 降级痕——确认判定缺席时行为
 * 与旧白名单未命中完全一致，不阻塞对话。
 */
export async function adjudicateGoalConfirm(input: GoalConfirmAdjudicatorInput): Promise<GoalConfirmVerdict> {
  const utterance = String(input?.userUtterance || '').trim();
  if (!utterance) return { confirm: false, source: 'fail-open' };
  try {
    const result = await executeGoalConfirmAdjudicator({
      userUtterance: utterance,
      proposal: input?.proposal ?? null,
      lastAssistantExcerpt: input?.lastAssistantExcerpt ?? '',
    });
    if (!result.success || !result.output) throw new Error(result.error?.message || 'GOAL_CONFIRM_ADJUDICATOR_FAILED');
    return { confirm: result.output.confirm === true, source: 'adjudicator' };
  } catch (error) {
    const message = degradationCause(error);
    recordDegradation({
      source: 'goal-conversation/confirm-adjudicator',
      faultCategory: /timeout|abort/i.test(message) ? 'NETWORK_TIMEOUT' : /JSON|parse|输出/i.test(message) ? 'PARSE_FAILED' : 'UNKNOWN',
      severity: 'P3_NOTICE',
      impactedDimensions: ['goal-confirm-adjudication'],
      mitigationApplied: 'continue-as-normal-turn',
      rootCauseMessage: message,
    });
    return { confirm: false, source: 'fail-open' };
  }
}

export const goalConfirmAdjudicatorDefinition: SkillDefinition = {
  name: 'goal-confirm-adjudicator',
  displayName: 'goal 确认裁决器 Skill',
  version: '1.0.0',
  category: 'analysis',
  description: 'goal 会话打字确认的唯一裁决通道：只回答「用户这句话是否表达就要这个方案、开始排路径」，fail-open 按非确认',
  status: 'working',
  inputSchema: {
    type: 'object',
    properties: {
      userUtterance: { type: 'string', description: '用户刚发出的这段话（原文）', required: true },
      proposal: { type: 'object', description: '方案摘要 { learning_direction, first_deliverable }' },
      lastAssistantExcerpt: { type: 'string', description: '导师上一条回复尾部摘录' },
    },
  },
  outputSchema: {
    type: 'object',
    properties: {
      confirm: { type: 'boolean', description: '是否表达「就要这个方案、开始排路径」' },
    },
  },
  capabilities: ['goal-confirm-adjudication', 'semantic-verdict', 'fail-open'],
  stats: { callCount: 0, successRate: 1, avgLatency: 0 },
};

export default executeGoalConfirmAdjudicator;

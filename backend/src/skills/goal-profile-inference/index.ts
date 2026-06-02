import { SkillDefinition, SkillExecutionResult } from '../protocol';
import { getAPIGateway, CallerInfo, ChatMessage } from '../../gateway/api-gateway';
import { AgentConfigService } from '../../services/agentConfig.service';

export const goalProfileInferenceDefinition: SkillDefinition = {
  name: 'goal-profile-inference',
  displayName: '目标阶段画像推断器',
  version: '1.0.0',
  category: 'analysis',
  description: '从 goal 阶段理解结果中提炼学习者背景、动机、时间约束和自我认知叙述。',
  status: 'working',
  inputSchema: {
    type: 'object',
    properties: {
      understanding: { type: 'object', description: 'goal 阶段 understanding', required: true },
      userName: { type: 'string', description: '用户名' }
    }
  },
  outputSchema: {
    type: 'object',
    properties: {
      goalNarrative: { type: 'string', description: '目标叙述' },
      backgroundContextNote: { type: 'string', description: '背景上下文' },
      motivationNarrative: { type: 'string', description: '动机叙述' },
      timeConstraintNote: { type: 'string', description: '时间约束' },
      selfAssessmentNote: { type: 'string', description: '自我认知' }
    }
  },
  capabilities: ['goal-profile-inference', 'learner-background-analysis'],
  stats: { callCount: 0, successRate: 0, avgLatency: 0 }
};

export interface GoalProfileInferenceInput {
  understanding: any;
  userName?: string;
}

export interface GoalProfileInferenceOutput {
  goalNarrative: string;
  backgroundContextNote: string;
  motivationNarrative: string;
  timeConstraintNote: string;
  selfAssessmentNote: string;
}

export const GOAL_PROFILE_INFERENCE_PROMPT = `你是学习者画像分析器。请根据 goal 阶段理解结果，提炼学习者画像中的叙述型字段。

要求：
1. 输出 JSON。
2. 每个字段都允许是一句话或一小段话。
3. 不要发明不存在的经历，只能基于输入做稳健推断。
4. 语气要像内部建模说明，不要像对用户说话。
5. goalNarrative 关注真实要解决的问题，不要重复表面目标。`;

const promptConfigService = new AgentConfigService();

function safeText(value: any): string {
  return typeof value === 'string' ? value.trim() : '';
}

function buildFallback(input: GoalProfileInferenceInput): GoalProfileInferenceOutput {
  const understanding = input.understanding || {};
  return {
    goalNarrative: safeText(understanding.real_problem) || safeText(understanding.surface_goal) || '当前目标仍需继续收缩到真实问题层面。',
    backgroundContextNote: Array.isArray(understanding.background_experience)
      ? understanding.background_experience.join('；')
      : safeText(understanding.background_experience) || '背景信息仍不充分，需要结合后续学习表现补足。',
    motivationNarrative: safeText(understanding.motivation) || '当前动机信息较弱，建议后续继续观察真实任务驱动力。',
    timeConstraintNote: safeText(understanding.background?.available_time)
      ? `可投入时间大致为 ${safeText(understanding.background?.available_time)}。`
      : '时间约束还不明确，课程应先按中等节奏试探。',
    selfAssessmentNote: safeText(understanding.background?.current_level)
      ? `当前自述水平为 ${safeText(understanding.background?.current_level)}，需要结合后续真实表现持续修正。`
      : '当前缺少稳定自评基线，需要在学习过程中逐步校正。'
  };
}

export async function goalProfileInference(input: GoalProfileInferenceInput): Promise<SkillExecutionResult<GoalProfileInferenceOutput>> {
  const startTime = Date.now();
  try {
    const gateway = getAPIGateway();
    const caller: CallerInfo = { skillId: 'goal-profile-inference' };
    const promptConfig = await promptConfigService.getActivePrompt('skill:goal-profile-inference');
    if (!promptConfig?.systemPrompt?.trim()) {
      throw new Error('SKILL_PROMPT_MISSING: goal-profile-inference');
    }
    const messages: ChatMessage[] = [
      { role: 'system', content: promptConfig.systemPrompt },
      { role: 'user', content: JSON.stringify(input, null, 2) }
    ];
    const response = await gateway.execute({ messages }, caller, {
      temperature: promptConfig.temperature,
      maxTokens: promptConfig.maxTokens,
      model: promptConfig.model,
    });
    const content = response.choices[0]?.message?.content || '';
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    const parsed = jsonMatch ? JSON.parse(jsonMatch[0]) : {};
    const fallback = buildFallback(input);
    return {
      success: true,
      output: {
        goalNarrative: safeText(parsed.goalNarrative) || fallback.goalNarrative,
        backgroundContextNote: safeText(parsed.backgroundContextNote) || fallback.backgroundContextNote,
        motivationNarrative: safeText(parsed.motivationNarrative) || fallback.motivationNarrative,
        timeConstraintNote: safeText(parsed.timeConstraintNote) || fallback.timeConstraintNote,
        selfAssessmentNote: safeText(parsed.selfAssessmentNote) || fallback.selfAssessmentNote
      },
      duration: Date.now() - startTime
    };
  } catch {
    return {
      success: true,
      output: buildFallback(input),
      duration: Date.now() - startTime,
      cached: true
    };
  }
}

export default goalProfileInference;

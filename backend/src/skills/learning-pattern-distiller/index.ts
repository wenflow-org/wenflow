import { SkillDefinition, SkillExecutionResult } from '../protocol';
import { callPrompt } from '../../composers/prompt-composer';

export const learningPatternDistillerDefinition: SkillDefinition = {
  name: 'learning-pattern-distiller',
  displayName: '学习模式蒸馏器',
  version: '1.0.0',
  category: 'analysis',
  description: '从近期学习状态和课程证据中提炼内容接收、练习偏好、认知摩擦和支持方式。',
  status: 'working',
  inputSchema: {
    type: 'object',
    properties: {
      learnerSnapshot: { type: 'object', description: '学习者快照', required: true },
      recentEvidence: { type: 'object', description: '近期证据' },
      wrapup: { type: 'object', description: '课后总结' }
    }
  },
  outputSchema: {
    type: 'object',
    properties: {
      contentReceptionPattern: { type: 'string', description: '内容接收方式' },
      practicePreferenceNote: { type: 'string', description: '练习偏好' },
      frictionPatternNote: { type: 'string', description: '认知摩擦' },
      effectiveTeachingPattern: { type: 'string', description: '有效教学模式' },
      supportStyleNote: { type: 'string', description: '支持风格' },
      taskGranularityNote: { type: 'string', description: '任务粒度建议' }
    }
  },
  capabilities: ['learning-pattern-distillation', 'teaching-evidence-synthesis'],
  stats: { callCount: 0, successRate: 0, avgLatency: 0 }
};

export interface LearningPatternDistillerInput {
  learnerSnapshot: any;
  recentEvidence?: any[];
  wrapup?: any;
}

export interface LearningPatternDistillerOutput {
  contentReceptionPattern: string;
  practicePreferenceNote: string;
  frictionPatternNote: string;
  effectiveTeachingPattern: string;
  supportStyleNote: string;
  taskGranularityNote: string;
}

export const LEARNING_PATTERN_DISTILLER_PROMPT = `你是学习模式蒸馏器。请根据学习者近期状态、知识证据和课后总结，提炼学习偏好与教学模式。

要求：
1. 输出 JSON。
2. 字段可以是一句话或一小段话。
3. 不要夸大，把结论写成稳健推断。
4. 重点回答：这个人怎么学更轻松、怎么教更有效。`;

function safeText(value: any): string {
  return typeof value === 'string' ? value.trim() : '';
}

function buildFallback(input: LearningPatternDistillerInput): LearningPatternDistillerOutput {
  const snapshot = input.learnerSnapshot || {};
  const pacing = safeText(snapshot?.dynamicState?.recommendedPacing) || 'moderate';
  const style = safeText(snapshot?.profile?.preferences?.theoryVsPractice) || 'balanced';
  return {
    contentReceptionPattern: style === 'practice-first'
      ? '边学边做更容易进入状态，长时间纯讲解不宜过多。'
      : '先把概念讲清，再立刻给一个短验证，会更稳。',
    practicePreferenceNote: style === 'practice-first'
      ? '更适合先做一个很小的任务，再回头解释原理。'
      : '更适合先理解当前核心概念，再安排验证性练习。',
    frictionPatternNote: pacing === 'slow'
      ? '当前高负荷时理解质量会下降，应减少单次新概念密度。'
      : '当前没有特别突出的摩擦模式，但仍需持续观察真实学习证据。',
    effectiveTeachingPattern: style === 'practice-first'
      ? '任务切入 -> 小步讲解 -> 立刻验证，这样更容易保持状态。'
      : '概念解释 -> 例子演示 -> 简短练习，是当前更稳的链路。',
    supportStyleNote: snapshot?.profile?.emotional?.confidenceLevel === 'anxious'
      ? '更适合温和纠错和高频小反馈，避免连续追问。'
      : '可以接受正常强度的引导，但每次仍应只聚焦一个关键问题。',
    taskGranularityNote: pacing === 'slow'
      ? '任务宜拆成 15-25 分钟的小闭环，优先保证完成感和理解稳定。'
      : '任务可保持中等粒度，但每次只承载一个核心认知目标。'
  };
}

export async function learningPatternDistiller(input: LearningPatternDistillerInput): Promise<SkillExecutionResult<LearningPatternDistillerOutput>> {
  const startTime = Date.now();
  try {
    const result = await callPrompt<LearningPatternDistillerInput, LearningPatternDistillerOutput>({
      agentId: 'skill:learning-pattern-distiller',
      defaultSystemPrompt: '',
      requireActivePrompt: true,
      caller: { skillId: 'learning-pattern-distiller' },
            buildUserPayload: (payload) => payload,
      normalizeOutput: (parsed, payload) => {
        const fallback = buildFallback(payload);
        const obj = parsed && typeof parsed === 'object' ? parsed : {};
        return {
          contentReceptionPattern: safeText(obj.contentReceptionPattern) || fallback.contentReceptionPattern,
          practicePreferenceNote: safeText(obj.practicePreferenceNote) || fallback.practicePreferenceNote,
          frictionPatternNote: safeText(obj.frictionPatternNote) || fallback.frictionPatternNote,
          effectiveTeachingPattern: safeText(obj.effectiveTeachingPattern) || fallback.effectiveTeachingPattern,
          supportStyleNote: safeText(obj.supportStyleNote) || fallback.supportStyleNote,
          taskGranularityNote: safeText(obj.taskGranularityNote) || fallback.taskGranularityNote,
        };
      },
      validateParsedOutput: (parsed) =>
        parsed && typeof parsed === 'object'
          ? { valid: true }
          : { valid: false, failureReason: 'LEARNING_PATTERN_OUTPUT_NOT_OBJECT' },
    }, input);

    if (!result.success || !result.output) {
      throw new Error(result.error?.message || 'LEARNING_PATTERN_DISTILLER_FAILED');
    }

    return {
      success: true,
      output: result.output,
      duration: Date.now() - startTime,
      quality: 'model',
    };
  } catch {
    return {
      success: true,
      output: buildFallback(input),
      duration: Date.now() - startTime,
      cached: true,
      quality: 'fallback',
    };
  }
}

export default learningPatternDistiller;

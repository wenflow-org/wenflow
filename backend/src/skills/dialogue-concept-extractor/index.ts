import { SkillDefinition, SkillExecutionResult } from '../protocol';
import { callPrompt } from '../../composers/prompt-composer';

export const dialogueConceptExtractorDefinition: SkillDefinition = {
  name: 'dialogue-concept-extractor',
  displayName: '对话概念抽取器',
  version: '1.0.0',
  category: 'analysis',
  description: '从课堂可见对话与事件上下文中抽取隐性概念线索、反复混淆与迁移信号。',
  status: 'working',
  inputSchema: {
    type: 'object',
    properties: {
      visibleDialogueContext: { type: 'array', description: '可见课堂对话', required: true },
      classroomEventHistory: { type: 'array', description: '课堂事件历史' },
      currentKnowledgeState: { type: 'array', description: '当前知识状态' }
    }
  },
  outputSchema: {
    type: 'object',
    properties: {
      recurringConfusions: { type: 'array', description: '反复混淆模式' },
      transferSignals: { type: 'array', description: '迁移信号' }
    }
  },
  capabilities: ['dialogue-concept-extraction', 'learner-background-update'],
  stats: { callCount: 0, successRate: 0, avgLatency: 0 }
};

export interface DialogueConceptExtractorInput {
  visibleDialogueContext: Array<{ role: string; content: string }>;
  classroomEventHistory?: Array<Record<string, any>>;
  currentKnowledgeState?: Array<{ name: string; status: string; progress: number }>;
}

export interface DialogueConceptExtractorOutput {
  recurringConfusions: Array<{
    conceptKey: string;
    label: string;
    pattern: string;
    confidence: number;
    count: number;
  }>;
  transferSignals: Array<{
    conceptKey: string;
    label: string;
    readiness: 'low' | 'medium' | 'high';
    confidence: number;
  }>;
}

export const DIALOGUE_CONCEPT_EXTRACTOR_PROMPT = `你是课堂对话概念抽取器。请根据课堂可见对话和事件，提炼学习者长期背景里值得记录的隐性知识线索。

要求：
1. 输出 JSON。
2. 只输出 recurringConfusions 与 transferSignals。
3. recurringConfusions 关注“反复卡住/混淆”的概念，不要凭空发明。
4. transferSignals 关注“学习者已经显示出可以迁移或复用”的概念，不要夸大。
5. 每条都要稳健，confidence 范围 0-1。`;

function fallback(input: DialogueConceptExtractorInput): DialogueConceptExtractorOutput {
  const currentKnowledgeState = Array.isArray(input.currentKnowledgeState) ? input.currentKnowledgeState : [];
  return {
    recurringConfusions: currentKnowledgeState
      .filter((item) => item.status === 'review')
      .slice(0, 8)
      .map((item) => ({
        conceptKey: item.name,
        label: item.name,
        pattern: '课堂中该概念仍表现为回看或不稳定，需要后续继续作为重点复习项。',
        confidence: 0.65,
        count: 1,
      })),
    transferSignals: currentKnowledgeState
      .filter((item) => item.status === 'mastered' || item.progress >= 70)
      .slice(0, 8)
      .map((item) => ({
        conceptKey: item.name,
        label: item.name,
        readiness: item.status === 'mastered' ? 'high' : 'medium',
        confidence: item.status === 'mastered' ? 0.75 : 0.6,
      })),
  };
}

function safeArray<T>(value: T[] | undefined | null): T[] {
  return Array.isArray(value) ? value : [];
}

export async function dialogueConceptExtractor(input: DialogueConceptExtractorInput): Promise<SkillExecutionResult<DialogueConceptExtractorOutput>> {
  const startTime = Date.now();
  try {
    const result = await callPrompt<DialogueConceptExtractorInput, DialogueConceptExtractorOutput>({
      agentId: 'skill:dialogue-concept-extractor',
      defaultSystemPrompt: '',
      requireActivePrompt: true,
      caller: { skillId: 'dialogue-concept-extractor' },
      modelDefaults: { temperature: 0.5, maxTokens: 2500 },
      buildUserPayload: (payload) => payload,
      normalizeOutput: (parsed, payload) => {
        const base = fallback(payload);
        const obj = parsed && typeof parsed === 'object' ? parsed : {};
        return {
          recurringConfusions:
            safeArray(obj.recurringConfusions).length > 0 ? obj.recurringConfusions : base.recurringConfusions,
          transferSignals:
            safeArray(obj.transferSignals).length > 0 ? obj.transferSignals : base.transferSignals,
        };
      },
      validateParsedOutput: (parsed) =>
        parsed && typeof parsed === 'object'
          ? { valid: true }
          : { valid: false, failureReason: 'DIALOGUE_CONCEPT_OUTPUT_NOT_OBJECT' },
    }, input);

    if (!result.success || !result.output) {
      throw new Error(result.error?.message || 'DIALOGUE_CONCEPT_EXTRACTOR_FAILED');
    }

    return {
      success: true,
      output: result.output,
      duration: Date.now() - startTime,
    };
  } catch {
    return {
      success: true,
      output: fallback(input),
      duration: Date.now() - startTime,
      cached: true,
    };
  }
}

export default dialogueConceptExtractor;

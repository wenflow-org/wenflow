import { SkillDefinition, SkillExecutionResult } from '../protocol';
import { getAPIGateway, CallerInfo, ChatMessage } from '../../gateway/api-gateway';
import { AgentConfigService } from '../../services/agentConfig.service';

export const sessionKnowledgeDistillerDefinition: SkillDefinition = {
  name: 'session-knowledge-distiller',
  displayName: '课堂知识蒸馏器',
  version: '1.0.0',
  category: 'analysis',
  description: '从课堂结构化知识状态、变化量和 wrapup 结果中提炼学习者可复用的知识背景增量。',
  status: 'working',
  inputSchema: {
    type: 'object',
    properties: {
      knowledgeState: { type: 'array', description: '当前课堂知识状态', required: true },
      knowledgeDelta: { type: 'object', description: '课堂知识变化量' },
      wrapup: { type: 'object', description: '课堂总结与评估' },
      taskContext: { type: 'object', description: '任务与路径上下文' },
      sessionEvidence: { type: 'object', description: '课堂证据摘要' }
    }
  },
  outputSchema: {
    type: 'object',
    properties: {
      conceptLedger: { type: 'array', description: '知识背景账本增量' },
      reusableFoundations: { type: 'array', description: '可复用基础' },
      blockedFoundations: { type: 'array', description: '不稳定前置' },
      transferSignals: { type: 'array', description: '迁移信号' }
    }
  },
  capabilities: ['session-knowledge-distillation', 'learner-background-update'],
  stats: { callCount: 0, successRate: 0, avgLatency: 0 }
};

export interface SessionKnowledgeDistillerInput {
  knowledgeState: Array<{ name: string; status: 'pending' | 'learning' | 'mastered' | 'review'; progress: number }>;
  knowledgeDelta?: {
    newlyMastered?: string[];
    movedToReview?: string[];
    stillLearning?: string[];
    unchangedMastered?: string[];
  } | null;
  wrapup?: any;
  taskContext?: {
    learningPathId?: string;
    taskId?: string;
  };
  sessionEvidence?: any;
}

export interface SessionKnowledgeDistillerOutput {
  conceptLedger: Array<{
    conceptKey: string;
    label: string;
    familiarity: 'seen' | 'practiced' | 'understood' | 'stable';
    transferReadiness: 'low' | 'medium' | 'high';
    misconceptionRisk: 'low' | 'medium' | 'high';
    sourcePaths: string[];
    sourceTasks: string[];
    evidenceCount: number;
  }>;
  reusableFoundations: string[];
  blockedFoundations: string[];
  transferSignals: Array<{
    conceptKey: string;
    label: string;
    readiness: 'low' | 'medium' | 'high';
    confidence: number;
  }>;
}

export const SESSION_KNOWLEDGE_DISTILLER_PROMPT = `你是课堂知识蒸馏器。请根据一节课结束后的结构化知识状态、知识变化量、wrapup 和任务上下文，提炼适合写入学习者长期背景的知识增量。

要求：
1. 只输出 JSON。
2. 只输出 4 个字段：conceptLedger、reusableFoundations、blockedFoundations、transferSignals。
3. 结论必须稳健，不夸大，不凭空发明输入里没有的知识点。
4. conceptLedger 中：
   - familiarity 只能是 seen | practiced | understood | stable
   - transferReadiness 只能是 low | medium | high
   - misconceptionRisk 只能是 low | medium | high
5. transferSignals 中：
   - readiness 只能是 low | medium | high
   - confidence 范围 0-1
6. reusableFoundations 关注“这节课后可复用的稳定基础”。
7. blockedFoundations 关注“仍不稳定、会阻塞后续学习的前置”。
8. 如果输入证据不足，就保守输出，不要脑补。`;

const promptConfigService = new AgentConfigService();

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function uniqueStrings(values: Array<string | null | undefined>): string[] {
  return Array.from(new Set(values.map((value) => normalizeText(value)).filter(Boolean)));
}

function safeArray<T>(value: T[] | undefined | null): T[] {
  return Array.isArray(value) ? value : [];
}

function normalizeLedgerItem(item: any) {
  const familiarity = ['seen', 'practiced', 'understood', 'stable'].includes(item?.familiarity)
    ? item.familiarity
    : 'seen';
  const transferReadiness = ['low', 'medium', 'high'].includes(item?.transferReadiness)
    ? item.transferReadiness
    : 'low';
  const misconceptionRisk = ['low', 'medium', 'high'].includes(item?.misconceptionRisk)
    ? item.misconceptionRisk
    : 'low';

  return {
    conceptKey: normalizeText(item?.conceptKey) || normalizeText(item?.label) || '',
    label: normalizeText(item?.label) || normalizeText(item?.conceptKey) || '',
    familiarity,
    transferReadiness,
    misconceptionRisk,
    sourcePaths: safeArray(item?.sourcePaths).map((value) => normalizeText(value)).filter(Boolean),
    sourceTasks: safeArray(item?.sourceTasks).map((value) => normalizeText(value)).filter(Boolean),
    evidenceCount: Math.max(1, Number.isFinite(Number(item?.evidenceCount)) ? Number(item.evidenceCount) : 1),
  };
}

function normalizeTransferSignal(item: any) {
  const readiness = ['low', 'medium', 'high'].includes(item?.readiness)
    ? item.readiness
    : 'low';
  const confidence = Number.isFinite(Number(item?.confidence))
    ? Math.max(0, Math.min(1, Number(item.confidence)))
    : 0.5;

  return {
    conceptKey: normalizeText(item?.conceptKey) || normalizeText(item?.label) || '',
    label: normalizeText(item?.label) || normalizeText(item?.conceptKey) || '',
    readiness,
    confidence,
  };
}

function buildFallback(input: SessionKnowledgeDistillerInput): SessionKnowledgeDistillerOutput {
  const knowledgeState = Array.isArray(input.knowledgeState) ? input.knowledgeState : [];
  const taskId = normalizeText(input.taskContext?.taskId);
  const pathId = normalizeText(input.taskContext?.learningPathId);

  const conceptLedger = knowledgeState.map((point) => {
    const familiarity: SessionKnowledgeDistillerOutput['conceptLedger'][number]['familiarity'] = point.status === 'mastered'
      ? 'stable'
      : point.status === 'review'
        ? 'understood'
        : point.status === 'learning'
          ? 'practiced'
          : 'seen';
    const transferReadiness: SessionKnowledgeDistillerOutput['transferSignals'][number]['readiness'] = point.status === 'mastered'
      ? 'high'
      : point.progress >= 60
        ? 'medium'
        : 'low';
    const misconceptionRisk: SessionKnowledgeDistillerOutput['conceptLedger'][number]['misconceptionRisk'] = point.status === 'review'
      ? 'high'
      : point.status === 'learning'
        ? 'medium'
        : 'low';
    return {
      conceptKey: point.name,
      label: point.name,
      familiarity,
      transferReadiness,
      misconceptionRisk,
      sourcePaths: pathId ? [pathId] : [],
      sourceTasks: taskId ? [taskId] : [],
      evidenceCount: Math.max(1, Math.round(Math.max(0, Math.min(100, point.progress)) / 25)),
    };
  });

  const reusableFoundations = uniqueStrings([
    ...(input.knowledgeDelta?.newlyMastered || []),
    ...conceptLedger.filter((item) => item.transferReadiness === 'high').map((item) => item.label),
  ]).slice(0, 16);

  const blockedFoundations = uniqueStrings([
    ...(input.knowledgeDelta?.movedToReview || []),
    ...conceptLedger.filter((item) => item.misconceptionRisk === 'high').map((item) => item.label),
  ]).slice(0, 16);

  const transferSignals = conceptLedger
    .filter((item) => item.transferReadiness !== 'low')
    .map((item) => ({
      conceptKey: item.conceptKey,
      label: item.label,
      readiness: item.transferReadiness,
      confidence: item.transferReadiness === 'high' ? 0.8 : 0.6,
    }))
    .slice(0, 16);

  return {
    conceptLedger,
    reusableFoundations,
    blockedFoundations,
    transferSignals,
  };
}

export async function sessionKnowledgeDistiller(input: SessionKnowledgeDistillerInput): Promise<SkillExecutionResult<SessionKnowledgeDistillerOutput>> {
  const startTime = Date.now();
  try {
    const gateway = getAPIGateway();
    const caller: CallerInfo = { skillId: 'session-knowledge-distiller' };
    const promptConfig = await promptConfigService.getActivePrompt('skill:session-knowledge-distiller');
    if (!promptConfig?.systemPrompt?.trim()) {
      throw new Error('SKILL_PROMPT_MISSING: session-knowledge-distiller');
    }

    const messages: ChatMessage[] = [
      { role: 'system', content: promptConfig.systemPrompt },
      { role: 'user', content: JSON.stringify(input, null, 2) },
    ];

    const response = await gateway.execute({
      messages,
      temperature: promptConfig.temperature,
      max_tokens: promptConfig.maxTokens,
      model: promptConfig.model,
    }, caller, {});

    const content = response.choices[0]?.message?.content || '';
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    const parsed = jsonMatch ? JSON.parse(jsonMatch[0]) : {};
    const fallback = buildFallback(input);
    const ledger = safeArray(parsed.conceptLedger).map(normalizeLedgerItem).filter((item) => item.conceptKey && item.label);
    const transferSignals = safeArray(parsed.transferSignals).map(normalizeTransferSignal).filter((item) => item.conceptKey && item.label);

    return {
      success: true,
      output: {
        conceptLedger: ledger.length > 0 ? ledger : fallback.conceptLedger,
        reusableFoundations: uniqueStrings(safeArray(parsed.reusableFoundations)).length > 0
          ? uniqueStrings(safeArray(parsed.reusableFoundations)).slice(0, 16)
          : fallback.reusableFoundations,
        blockedFoundations: uniqueStrings(safeArray(parsed.blockedFoundations)).length > 0
          ? uniqueStrings(safeArray(parsed.blockedFoundations)).slice(0, 16)
          : fallback.blockedFoundations,
        transferSignals: transferSignals.length > 0 ? transferSignals : fallback.transferSignals,
      },
      duration: Date.now() - startTime,
    };
  } catch {
    return {
      success: true,
      output: buildFallback(input),
      duration: Date.now() - startTime,
      cached: true,
    };
  }
}

export default sessionKnowledgeDistiller;

/**
 * Lesson Knowledge Enricher Skill
 *
 * 由 session-knowledge-distiller 与 dialogue-concept-extractor 合并而来（2026-07）。
 * 一节课结束后单次 LLM 调用，同时产出结构化知识台账增量与隐性概念线索，
 * 避免两份输入高度重叠的后台 skill 各自发起一次 LLM 请求。
 */
import { SkillDefinition, SkillExecutionResult } from '../protocol';
import { callPrompt } from '../../composers/prompt-composer';
import { JSON_OUTPUT_RETRY_STRATEGY } from '../json-output-retry';
import { loadPromptFile } from '../../composers/prompt-files/loader';

// File-as-Truth：从编译产物加载 systemPrompt，避免代码内嵌第二份 prompt 导致双源漂移
const LESSON_KNOWLEDGE_ENRICHER_PROMPT = loadPromptFile('skill:lesson-knowledge-enricher')?.systemPrompt || '';

export const lessonKnowledgeEnricherDefinition: SkillDefinition = {
  name: 'lesson-knowledge-enricher',
  displayName: '课后知识增强器',
  version: '1.0.0',
  category: 'analysis',
  description: '课后单次调用：从知识状态、wrapup、课堂证据与可见对话切片中提炼知识台账增量与隐性概念线索。',
  status: 'working',
  inputSchema: {
    type: 'object',
    properties: {
      transferGoal: { type: 'string', description: '任务的可迁移目标（task.transferable 派生，可空）：本课迁移意图的锚点，用于判断迁移信号是否与该意图相关' },
      knowledgeState: { type: 'array', description: '当前课堂知识状态', required: true },
      knowledgeDelta: { type: 'object', description: '课堂知识变化量' },
      wrapup: { type: 'object', description: '课堂总结与评估' },
      taskContext: { type: 'object', description: '任务与路径上下文' },
      sessionEvidence: { type: 'object', description: '课堂证据摘要' },
      visibleDialogueContext: { type: 'array', description: '可见课堂对话切片' },
      classroomEventHistory: { type: 'array', description: '课堂事件历史' }
    }
  },
  outputSchema: {
    type: 'object',
    properties: {
      conceptLedger: { type: 'array', description: '知识背景账本增量' },
      reusableFoundations: { type: 'array', description: '可复用基础' },
      blockedFoundations: { type: 'array', description: '不稳定前置' },
      transferSignals: { type: 'array', description: '迁移信号' },
      recurringConfusions: { type: 'array', description: '反复混淆模式' }
    }
  },
  capabilities: ['lesson-knowledge-enrichment', 'learner-background-update'],
  stats: { callCount: 0, successRate: 0, avgLatency: 0 }
};

export interface LessonKnowledgeEnricherInput {
  /** 任务的可迁移目标（task.transferable 派生）：迁移信号的意图锚点，可为 null */
  transferGoal?: string | null;
  knowledgeState: Array<{
    name: string;
    status: 'pending' | 'learning' | 'mastered' | 'review';
    progress: number;
    /** 知识看板的概念 id（事件载荷实际携带）：概念台账的键必须优先用它，见 normalizeConceptKey。 */
    kcId?: string;
  }>;
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
  visibleDialogueContext?: Array<{ role: string; content: string }>;
  classroomEventHistory?: Array<Record<string, any>>;
}

export interface LessonKnowledgeEnricherOutput {
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
  recurringConfusions: Array<{
    conceptKey: string;
    label: string;
    pattern: string;
    confidence: number;
    count: number;
  }>;
  /** 知识状态自然语言摘要（LBM 式：供预测器与教学决策直接读取） */
  knowledgeStateSummary: string;
}

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function uniqueStrings(values: Array<string | null | undefined>): string[] {
  return Array.from(new Set(values.map((value) => normalizeText(value)).filter(Boolean)));
}

function safeArray<T>(value: T[] | undefined | null): T[] {
  return Array.isArray(value) ? value : [];
}

function clampConfidence(value: unknown): number {
  return Number.isFinite(Number(value)) ? Math.max(0, Math.min(1, Number(value))) : 0.5;
}

/**
 * 概念键解析器（2026-11-09 运营字段真值核查）。
 *
 * 模型自拟 `conceptKey`（英文 slug）在**同一输入**上都不稳定：真实 LLM 实测同一概念
 * 连跑三次分别给出 `由线索唤起素材` / `kc-1b` / `anchor-diff-seq`，概念集合 Jaccard 仅 0.66，
 * 运营后台「N 个概念」因此不可复现。事件载荷里的 `knowledgeState[].kcId` 是确定性身份，
 * 优先用它；模型自造键只在输入没有对应 kcId（隐性概念）时退回**归一化 label**，
 * 至少保证同一概念跨次得到同一个键，而不是每次换一个 slug。
 */
interface ConceptKeyResolver {
  /** 中文 label → kcId */
  readonly kcIdByLabel: ReadonlyMap<string, string>;
  readonly knownKcIds: ReadonlySet<string>;
  /** 归一化后的看板概念名（无 kcId 的旧数据按名字匹配） */
  readonly knownLabels: ReadonlySet<string>;
  /** 归一化看板概念名 → 本节课的看板状态（status/progress） */
  readonly stateByLabel: ReadonlyMap<string, { status: string; progress: number }>;
  /** kcId → 本节课的看板状态（模型若保留 kcId，用它反查最准） */
  readonly stateByKcId: ReadonlyMap<string, { status: string; progress: number }>;
}

function buildConceptKeyResolver(
  knowledgeState: LessonKnowledgeEnricherInput['knowledgeState'] | undefined,
): ConceptKeyResolver {
  const kcIdByLabel = new Map<string, string>();
  const knownKcIds = new Set<string>();
  const knownLabels = new Set<string>();
  const stateByLabel = new Map<string, { status: string; progress: number }>();
  const stateByKcId = new Map<string, { status: string; progress: number }>();
  for (const item of safeArray(knowledgeState)) {
    const kcId = normalizeText((item as { kcId?: unknown })?.kcId);
    const label = normalizeText(item?.name);
    const state = {
      status: normalizeText(item?.status),
      progress: Number.isFinite(Number(item?.progress)) ? Number(item.progress) : 0,
    };
    if (kcId) {
      knownKcIds.add(kcId);
      stateByKcId.set(kcId, state);
    }
    if (kcId && label) kcIdByLabel.set(label, kcId);
    if (label) {
      knownLabels.add(normalizedConceptLabel(label));
      stateByLabel.set(normalizedConceptLabel(label), state);
    }
  }
  return { kcIdByLabel, knownKcIds, knownLabels, stateByLabel, stateByKcId };
}

/** 归一化键：去空白、统一小写、去首尾标点，避免「同一概念两种写法」。 */
function normalizedConceptLabel(value: string): string {
  return value.replace(/\s+/g, '').replace(/^[「『"'（(]+|[」』"'）)]+$/g, '').toLowerCase();
}

function resolveConceptKey(rawKey: string, rawLabel: string, resolver: ConceptKeyResolver): string {
  if (rawKey && resolver.knownKcIds.has(rawKey)) return rawKey;
  if (rawLabel && resolver.kcIdByLabel.has(rawLabel)) return resolver.kcIdByLabel.get(rawLabel) as string;
  if (rawKey && resolver.kcIdByLabel.has(rawKey)) return resolver.kcIdByLabel.get(rawKey) as string;
  // 输入里没有对应 kcId（模型抽出的隐性概念）：退回归一化 label，保证跨次稳定。
  return normalizedConceptLabel(rawLabel) || rawKey;
}

/**
 * 模型实际看到的输入文本（归一化后），用于判断一个概念是不是**凭空抽取**。
 *
 * 真实 LLM 实测出现过：同一节课模型输出 5 个概念，其中 2 个在输入的任何文本里
 * 都找不到（可追溯率 60%）。这类概念既无法核对，也会让「N 个概念」不可复现。
 * 台账只收「知识看板里有的」或「输入文本里确实出现过的」概念。
 */
function buildInputCorpus(input: LessonKnowledgeEnricherInput | undefined): string {
  const parts: string[] = [];
  for (const item of safeArray(input?.knowledgeState)) parts.push(String((item as any)?.name || ''));
  for (const message of safeArray((input as any)?.visibleDialogueContext)) parts.push(String((message as any)?.content || ''));
  for (const event of safeArray((input as any)?.classroomEventHistory)) parts.push(JSON.stringify(event));
  parts.push(JSON.stringify((input as any)?.wrapup ?? null));
  parts.push(JSON.stringify((input as any)?.sessionEvidence ?? null));
  return normalizedConceptLabel(parts.join('\n'));
}

/**
 * 台账准入判定。
 *
 * ① 知识看板非空 → **只收看板里的概念**（kcId 精确匹配，或归一化 name 匹配）。
 *    这是「概念掌握」卡片的口径：它统计的是看板概念，不该被模型某次多抽的额外概念改写。
 *    隐性概念仍可由 recurringConfusions 承载（提示词的身份段本就如此划分）。
 * ② 看板为空 → 退回到「输入语料里出现过」的可追溯判定，避免整张台账被清空。
 */
function isLedgerEligibleConcept(
  rawKey: string,
  rawLabel: string,
  resolver: ConceptKeyResolver,
  corpus: string,
): boolean {
  const whitelisted = resolver.knownKcIds.size > 0 || resolver.knownLabels.size > 0;
  if (whitelisted) {
    if (rawKey && resolver.knownKcIds.has(rawKey)) return true;
    if (rawLabel && resolver.kcIdByLabel.has(rawLabel)) return true;
    if (rawKey && resolver.kcIdByLabel.has(rawKey)) return true;
    const label = normalizedConceptLabel(rawLabel);
    if (!label) return false;
    if (resolver.knownLabels.has(label)) return true;
    // 模型改写过的名字（多字/少字）仍算看板概念，否则会被误丢弃
    return Boolean(resolveBoardState(rawKey, rawLabel, resolver));
  }
  const needle = normalizedConceptLabel(rawLabel);
  return Boolean(needle) && corpus.includes(needle);
}

/** 编辑距离是否 ≤ max（带长度差早停）。概念名很短，成本可忽略。 */
function editDistanceAtMost(a: string, b: string, max: number): boolean {
  if (a === b) return true;
  if (Math.abs(a.length - b.length) > max) return false;
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i += 1) {
    const cur = [i];
    let rowMin = i;
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      const v = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
      cur.push(v);
      if (v < rowMin) rowMin = v;
    }
    if (rowMin > max) return false;
    prev = cur;
  }
  return prev[b.length] <= max;
}

/**
 * 解析一个概念对应的看板状态。
 *
 * 模型会**轻微改写概念名**（实测：看板「调整锚点线索或勾连顺序」→ 模型写
 * 「调整锚点线索词或勾连顺序」，多一个「词」）。精确匹配失败就退回模型判断，
 * 于是同一概念的 readiness 又开始漂。这里三级解析：
 *   ① kcId 精确（模型保留 kcId 时最准）
 *   ② 归一化 label 精确
 *   ③ label 编辑距离 ≤1 且**唯一**命中（多个相似候选则放弃，避免误配）
 */
function resolveBoardState(
  rawKey: string,
  rawLabel: string,
  resolver: ConceptKeyResolver,
): { status: string; progress: number } | undefined {
  if (rawKey) {
    const byKcId = resolver.stateByKcId.get(rawKey);
    if (byKcId) return byKcId;
  }
  const normalized = normalizedConceptLabel(rawLabel);
  if (!normalized) return undefined;
  const exact = resolver.stateByLabel.get(normalized);
  if (exact) return exact;
  let match: { status: string; progress: number } | undefined;
  let hits = 0;
  for (const [label, state] of resolver.stateByLabel) {
    if (!editDistanceAtMost(normalized, label, 1)) continue;
    hits += 1;
    match = state;
    if (hits > 1) return undefined;
  }
  return hits === 1 ? match : undefined;
}

/** 看板状态 → 台账状态（与 LearnerKnowledgeMemoryService 的 stability 派生同精神，但用本节课更及时的 status）。 */
function familiarityAndReadinessFromBoard(state: { status: string; progress: number }): {
  familiarity: 'seen' | 'practiced' | 'understood' | 'stable';
  transferReadiness: 'low' | 'medium' | 'high';
} {
  switch (state.status) {
    case 'mastered':
      return state.progress >= 90
        ? { familiarity: 'stable', transferReadiness: 'high' }
        : { familiarity: 'understood', transferReadiness: 'medium' };
    case 'review':
      return { familiarity: 'practiced', transferReadiness: 'medium' };
    case 'learning':
      return { familiarity: 'practiced', transferReadiness: 'medium' };
    default:
      return { familiarity: 'seen', transferReadiness: 'low' };
  }
}

function normalizeLedgerItem(item: any, resolver: ConceptKeyResolver) {
  const familiarity = ['seen', 'practiced', 'understood', 'stable'].includes(item?.familiarity)
    ? item.familiarity
    : 'seen';
  const transferReadiness = ['low', 'medium', 'high'].includes(item?.transferReadiness)
    ? item.transferReadiness
    : 'low';
  const misconceptionRisk = ['low', 'medium', 'high'].includes(item?.misconceptionRisk)
    ? item.misconceptionRisk
    : 'low';
  const rawKey = normalizeText(item?.conceptKey) || normalizeText(item?.label) || '';
  const rawLabel = normalizeText(item?.label) || rawKey;

  /* 看板概念的状态字段由**看板 status/progress 确定性派生**（2026-11-09 真值核查）：
     真实 LLM 实测同一输入连跑三次，同一个概念的 familiarity 会给出 stable/practiced/understood
     三种值（一致率最低 0%），运营后台「可迁移/待巩固」因此每次刷新都可能变。
     看板状态是教学侧写入的权威事实，用它派生可复现；模型只负责 label 与文本类产出。 */
  const boardState = resolveBoardState(rawKey, rawLabel, resolver);
  const derived = boardState ? familiarityAndReadinessFromBoard(boardState) : null;

  return {
    conceptKey: resolveConceptKey(rawKey, rawLabel, resolver),
    label: rawLabel,
    familiarity: derived?.familiarity ?? familiarity,
    transferReadiness: derived?.transferReadiness ?? transferReadiness,
    misconceptionRisk,
    sourcePaths: safeArray(item?.sourcePaths).map((value) => normalizeText(value)).filter(Boolean),
    sourceTasks: safeArray(item?.sourceTasks).map((value) => normalizeText(value)).filter(Boolean),
    // 证据计数真实化：模型未给出时按 0（0 就是 0，不虚报）；仅接受有限非负数。
    // 注意：落库聚合时会被确定性倒排计数覆盖——本字段的模型自报值没有计数规则，不作为读数。
    evidenceCount: Number.isFinite(Number(item?.evidenceCount)) ? Math.max(0, Number(item.evidenceCount)) : 0,
  };
}

function normalizeTransferSignal(item: any, resolver: ConceptKeyResolver) {
  const readiness = ['low', 'medium', 'high'].includes(item?.readiness)
    ? item?.readiness
    : 'low';
  const rawKey = normalizeText(item?.conceptKey) || normalizeText(item?.label) || '';
  const rawLabel = normalizeText(item?.label) || rawKey;
  // 与台账同口径：看板概念的就绪度由看板状态派生，避免同一概念在台账与迁移信号里给出两档值。
  const boardState = resolveBoardState(rawKey, rawLabel, resolver);
  const derived = boardState ? familiarityAndReadinessFromBoard(boardState) : null;
  return {
    conceptKey: resolveConceptKey(rawKey, rawLabel, resolver),
    label: rawLabel,
    readiness: derived?.transferReadiness ?? readiness,
    confidence: clampConfidence(item?.confidence),
  };
}

function normalizeConfusionItem(
  item: any,
  resolver: ConceptKeyResolver,
): LessonKnowledgeEnricherOutput['recurringConfusions'][number] | null {
  const rawKey = normalizeText(item?.conceptKey) || normalizeText(item?.label);
  if (!rawKey) return null;
  const rawLabel = normalizeText(item?.label) || rawKey;
  return {
    conceptKey: resolveConceptKey(rawKey, rawLabel, resolver),
    label: rawLabel,
    pattern: normalizeText(item?.pattern) || normalizeText(item?.evidence),
    confidence: clampConfidence(item?.confidence),
    count: Math.max(1, Number.isFinite(Number(item?.count)) ? Math.round(Number(item.count)) : 1),
  };
}

export async function lessonKnowledgeEnricher(input: LessonKnowledgeEnricherInput): Promise<SkillExecutionResult<LessonKnowledgeEnricherOutput>> {
  const startTime = Date.now();
  const result = await callPrompt<LessonKnowledgeEnricherInput, LessonKnowledgeEnricherOutput>({
    agentId: 'skill:lesson-knowledge-enricher',
    defaultSystemPrompt: LESSON_KNOWLEDGE_ENRICHER_PROMPT,
    requireActivePrompt: true,
    caller: { skillId: 'lesson-knowledge-enricher' },
    retryStrategy: JSON_OUTPUT_RETRY_STRATEGY,
    buildUserPayload: (payload) => payload,
    normalizeOutput: (parsed, payload) => {
      const obj = parsed && typeof parsed === 'object' ? parsed : {};
      const resolver = buildConceptKeyResolver(payload?.knowledgeState);
      const corpus = buildInputCorpus(payload);
      const ledger = safeArray(obj.conceptLedger)
        // 台账只收可追溯的概念（知识看板里有 / 输入文本里出现过）。
        // 模型凭空造的概念不进台账——它既无法核对，也会让「N 个概念」不可复现；
        // 若它确实值得记录，模型应放进 recurringConfusions（隐性概念线索，不受此过滤）。
        .filter((item: any) => {
          const rawKey = normalizeText(item?.conceptKey) || normalizeText(item?.label) || '';
          const rawLabel = normalizeText(item?.label) || rawKey;
          return isLedgerEligibleConcept(rawKey, rawLabel, resolver, corpus);
        })
        .map((item) => normalizeLedgerItem(item, resolver))
        .filter((item) => item.conceptKey && item.label);
      const signals = safeArray(obj.transferSignals)
        .map((item) => normalizeTransferSignal(item, resolver))
        .filter((item) => item.conceptKey && item.label);
      const confusions = safeArray(obj.recurringConfusions)
        .map((item) => normalizeConfusionItem(item, resolver))
        .filter((item): item is NonNullable<typeof item> => item !== null);
      return {
        // 模型漏输出/输出空数组 → 保持空数组（空即空，不注入伪置信度/伪台账）
        conceptLedger: ledger,
        reusableFoundations: uniqueStrings(safeArray(obj.reusableFoundations)).slice(0, 16),
        blockedFoundations: uniqueStrings(safeArray(obj.blockedFoundations)).slice(0, 16),
        transferSignals: signals,
        recurringConfusions: confusions,
        // 知识状态摘要：LLM 用自然语言浓缩本节课学习状态（LBM 式）；缺省时给空字符串，前端/预测器按空值处理
        knowledgeStateSummary: typeof obj.knowledgeStateSummary === 'string' ? obj.knowledgeStateSummary.trim() : '',
      };
    },
    validateParsedOutput: (parsed) =>
      parsed && typeof parsed === 'object'
        ? { valid: true }
        : { valid: false, failureReason: 'LESSON_KNOWLEDGE_ENRICHER_OUTPUT_NOT_OBJECT' },
  }, input);

  if (!result.success || !result.output) {
    throw new Error(result.error?.message || 'LESSON_KNOWLEDGE_ENRICHER_FAILED');
  }

  return {
    success: true,
    output: result.output,
    duration: Date.now() - startTime,
    quality: 'model',
  };
}

export default lessonKnowledgeEnricher;

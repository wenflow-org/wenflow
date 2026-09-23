/**
 * Path Agent
 * 
 * 学习路径规划 + 动态重规划
 * 
 * 概念模型：
 * - 学习路径 (learning_path)：用户的一个学习目标，如"Python Excel自动化"
 * - 里程碑 (milestone)：关键学习阶段，如"Python基础"、"Excel操作"
 * - 子任务 (subtask)：每个里程碑下的具体任务
 */

import {
  AgentDefinition,
  AgentInput,
  AgentOutput,
  AgentContext,
  MilestoneOutput
} from '../../agents/protocol';
import { CallerInfo } from '../../gateway/api-gateway';
import { callPrompt } from '../../composers/prompt-composer';
import { loadPromptFile } from '../../composers/prompt-files/loader';
import { adaptToRuntimeEnvelope } from '../../services/prompt-lab/envelope-adapter';

import { logger } from '../../utils/logger';
import { buildPromptFriendlyMaterials } from '../../services/materials/material-prompt-projection';
import { normalizeMaterialRefs } from '../../services/materials/material-refs';
import type { PromptMaterial } from '../../services/materials/material-prompt-projection';

const AGENT_ID = 'skill:path-planning';
const PATH_AGENT_MAX_TOKENS = 32000;

// File-as-Truth：从编译产物加载 systemPrompt，避免代码内嵌第二份 prompt 导致双源漂移
const PATH_PLANNING_PROMPT = loadPromptFile(AGENT_ID)?.systemPrompt || '';

function normalizePromptString(value: any): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function normalizePromptStringArray(value: any): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => normalizePromptString(item))
    .filter((item): item is string => !!item);
}

/**
 * 学习证据投影 → 提示词友好形态（规则 53 用）。
 *
 * **断链修复（审计 §3.19 P0①）**：`learnerLearningContext` 由 `learning.service` 在新建路径时赋值，
 * 但本 skill 的输入构造函数此前不包含它 → 规则 53「按已学证据校准首版难度与前置假设」永不生效
 * （路径生成实际上没看学习者证据）。这里做形状收敛 + 上限保护，避免把整份投影塞进提示词。
 */
function buildLearningContextForPrompt(raw: any): Record<string, unknown> | null {
  if (!raw || typeof raw !== 'object') return null;
  const labels = (value: any, limit: number): string[] =>
    (Array.isArray(value) ? value : [])
      .map((item) => normalizePromptString(item?.label || item?.conceptKey || item?.name || (typeof item === 'string' ? item : null)))
      .filter((item): item is string => !!item)
      .slice(0, limit);
  const confusions = (Array.isArray(raw.recurringConfusions) ? raw.recurringConfusions : [])
    .slice(0, 5)
    .map((item: any) => ({
      concept: normalizePromptString(item?.concept)?.slice(0, 40) || null,
      note: normalizePromptString(item?.note)?.slice(0, 60) || null,
      count: Number(item?.count) || 0,
    }))
    .filter((item: { concept: string | null }) => !!item.concept);

  return {
    hasLearningHistory: raw.hasLearningHistory === true,
    masteredConcepts: labels(raw.masteredConcepts, 8),
    fragileConcepts: labels(raw.fragileConcepts, 8),
    strugglingConcepts: labels(raw.strugglingConcepts, 8),
    blockedFoundations: labels(raw.blockedFoundations, 5),
    recurringConfusions: confusions,
    conceptLedgerSize: Number(raw.conceptLedgerSize) || 0,
    recommendedPacing: normalizePromptString(raw.recommendedPacing),
    recentTrend: normalizePromptString(raw.recentTrend),
    fatigueRisk: normalizePromptString(raw.fatigueRisk),
    paceMode: normalizePromptString(raw.paceMode),
    challengeLevelCap: normalizePromptString(raw.challengeLevelCap),
  };
}

/**
 * 契约容错归一：只修**可派生的不变量**与**字段名等价变体**，不做任何语义猜测。
 *   - `totalMilestones` 是 milestones.length 的派生量：模型漏填时补齐（不改语义）；
 *   - 概念描述字段名归一（模型偶发写成 understanding/desc）。
 * 实测（2026-09-22）：`fields contract violation: totalMilestones(missing-required)` 是生产失败之一。
 */
export function coercePathPlanningParsed(parsed: any, materials?: PromptMaterial[] | null) {
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return parsed;
  const out: any = { ...parsed };
  if (!Number.isFinite(Number(out.totalMilestones)) && Array.isArray(out.milestones)) {
    out.totalMilestones = out.milestones.length;
  }
  // materialRefs：逐字核对（编造的引用在这里就被丢掉，不进下游）
  if (Array.isArray(out.milestones) && Array.isArray(materials) && materials.length) {
    out.milestones = out.milestones.map((milestone: any) => {
      if (!milestone || typeof milestone !== 'object') return milestone;
      const refs = normalizeMaterialRefs(milestone.materialRefs, materials);
      const next = { ...milestone };
      if (refs.length) next.materialRefs = refs;
      else delete next.materialRefs;
      return next;
    });
  }
  const core = out.cognitiveCore;
  if (core && typeof core === 'object' && !Array.isArray(core) && Array.isArray(core.coreConcepts)) {
    core.coreConcepts = core.coreConcepts.map((concept: any) => {
      if (!concept || typeof concept !== 'object') return concept;
      const description = typeof concept.description === 'string' && concept.description
        ? concept.description
        : (concept.understanding || concept.desc || '');
      return { ...concept, description };
    });
  }
  return out;
}

/**
 * 校验失败 → **针对性**修复提示（只用于重试那一轮）。
 *
 * 为什么需要它：通用提示（"请输出合法 JSON"）对"缺 hub""带了 subtasks"这类结构性违规
 * 没有指导性，模型第二次照样犯。实测（2026-09-22，`prompt_call_logs`）：path-planning 674 次调用里
 * `PATH_PLANNING_HUB_CONCEPT_MISSING` 19 次，是**头号失败门**；模型常把概念写成
 * `{name, understanding}` 并漏掉 `role`。因此这里给**字面骨架**，而不是再描述一遍规则。
 */
const PATH_OUTPUT_SKELETON = '{"name":"…","summary":"…","totalMilestones":N,"estimatedHours":N,"estimatedWeeks":N,'
  + '"milestones":[{"stageNumber":1,"title":"…","description":"…","goal":"…","coreConcept":"concept-1"}],'
  + '"cognitiveCore":{"coreConcepts":[{"id":"concept-1","name":"…","role":"hub","description":"…"},'
  + '{"id":"concept-2","name":"…","role":"supporting","description":"…"}]}}';

const PATH_VALIDATION_REPAIR_HINTS: Record<string, string> = {
  PATH_PLANNING_HUB_CONCEPT_MISSING:
    `上一次的 coreConcepts 里没有任何 role="hub"。概念对象的字段名**只能是** id/name/role/description（不要用 understanding 之类自造字段名）。`
    + `请严格按这个骨架重出（恰好一个 role="hub"，其余 role="supporting"）：${PATH_OUTPUT_SKELETON}`,
  PATH_PLANNING_HUB_CONCEPT_MULTIPLE:
    `上一次出现了多个 role="hub"。请严格按这个骨架重出（恰好一个 role="hub"，其余改为 "supporting"）：${PATH_OUTPUT_SKELETON}`,
  PATH_PLANNING_LEGACY_TASK_FIELDS:
    `上一次的里程碑里出现了 subtasks / tasks / acceptanceCriteria 等任务级字段。请严格按这个骨架重出（里程碑只保留 stageNumber/title/description/goal/coreConcept）：${PATH_OUTPUT_SKELETON}`,
  PATH_PLANNING_MILESTONE_CONCEPT_UNBOUND:
    `上一次的 milestone.coreConcept 引用了未声明的概念。请严格按这个骨架重出（coreConcept 只能填 coreConcepts 里已声明的 id，如 "concept-1"）：${PATH_OUTPUT_SKELETON}`,
  PATH_PLANNING_MILESTONES_MISSING:
    `上一次没有 milestones 数组。请严格按这个骨架重出：${PATH_OUTPUT_SKELETON}`,
  PATH_PLANNING_COGNITIVE_CORE_MISSING:
    `上一次缺少 cognitiveCore。请严格按这个骨架重出：${PATH_OUTPUT_SKELETON}`,
};

/** 按失败原因（含「fields contract violation: xxx」这类前缀包裹）取修复提示。 */
export function buildPathValidationRepairNotice(failureReason: string): string {
  const reason = String(failureReason || '');
  if (reason.includes('totalMilestones')) {
    return `上一次缺少 totalMilestones（它必须等于 milestones 数组长度）。请严格按这个骨架重出：${PATH_OUTPUT_SKELETON}`;
  }
  const key = Object.keys(PATH_VALIDATION_REPAIR_HINTS).find((candidate) => reason.includes(candidate));
  if (key) return PATH_VALIDATION_REPAIR_HINTS[key];
  return `请只输出一个学习路径 JSON 对象，严格按这个骨架（字段名逐字一致）：${PATH_OUTPUT_SKELETON}`;
}

/** 导出以便回归测试（§3.19 P0①：learnerLearningContext 必须真正进入提示词） */
export function buildPromptFriendlyNormalizedInput(normalizedInput: any) {
  if (!normalizedInput || typeof normalizedInput !== 'object') return null;

  const learnerProfile = normalizedInput.learnerProfile && typeof normalizedInput.learnerProfile === 'object'
    ? normalizedInput.learnerProfile
    : {};
  const problemSpace = normalizedInput.problemSpace && typeof normalizedInput.problemSpace === 'object'
    ? normalizedInput.problemSpace
    : {};
  const resources = normalizedInput.resources && typeof normalizedInput.resources === 'object'
    ? normalizedInput.resources
    : {};
  const successCriteria = normalizedInput.successCriteria && typeof normalizedInput.successCriteria === 'object'
    ? normalizedInput.successCriteria
    : {};
  const confirmedProposal = normalizedInput.confirmedProposal && typeof normalizedInput.confirmedProposal === 'object'
    ? normalizedInput.confirmedProposal
    : null;
  const planningHints = normalizedInput.planningHints && typeof normalizedInput.planningHints === 'object'
    ? normalizedInput.planningHints
    : null;
  return {
    normalizedInput: {
      version: normalizePromptString(normalizedInput.version) || '1.0',
      learnerProfile: {
        surfaceGoal: normalizePromptString(learnerProfile.surfaceGoal),
        motivation: normalizePromptString(learnerProfile.motivation),
        urgency: normalizePromptString(learnerProfile.urgency),
        backgroundExperience: normalizePromptString(learnerProfile.backgroundExperience),
        painPoints: normalizePromptStringArray(learnerProfile.painPoints),
        learningSignal: normalizePromptString(learnerProfile.learningSignal),
        goalOrientation: normalizePromptString(learnerProfile.goalOrientation),
        constraintsAndBoundaries: normalizePromptStringArray(learnerProfile.constraintsAndBoundaries),
        currentBaseline: {
          level: normalizePromptString(learnerProfile.currentBaseline?.level),
          evidence: normalizePromptString(learnerProfile.currentBaseline?.evidence),
        },
      },
      problemSpace: {
        realProblem: normalizePromptString(problemSpace.realProblem),
        scenario: normalizePromptString(problemSpace.scenario),
        currentPainPoint: normalizePromptString(problemSpace.currentPainPoint),
      },
      resources: {
        timeBudget: normalizePromptString(resources.timeBudget),
        timeBudgetCadence: normalizePromptString(resources.timeBudgetCadence),
        timePerWeek: normalizePromptString(resources.timePerWeek),
        timePerSession: normalizePromptString(resources.timePerSession),
        timeHorizon: normalizePromptString(resources.timeHorizon),
        deadlineText: normalizePromptString(resources.deadlineText),
        // 资料包（用户附件在前、联网采集在后）：**必须进提示词**，否则规则"路径必须长在资料上"
        // 永远拿不到资料（2026-09-22 实测：装配层送达了、投影层却把它裁掉 ⇒ 模型看不见）。
        // 无资料时不出现该键，冷启动行为不变。
        ...(buildPromptFriendlyMaterials(resources.materials)
          ? { materials: buildPromptFriendlyMaterials(resources.materials) }
          : {}),
      },
      successCriteria: {
        observableResult: normalizePromptString(successCriteria.observableResult),
        acceptanceCheck: normalizePromptString(successCriteria.acceptanceCheck),
      },
      confirmedProposal: confirmedProposal ? {
        learningDirection: normalizePromptString(confirmedProposal.learningDirection),
        firstDeliverable: normalizePromptString(confirmedProposal.firstDeliverable),
        keyStages: normalizePromptStringArray(confirmedProposal.keyStages),
        outOfScope: normalizePromptStringArray(confirmedProposal.outOfScope),
      } : null,
      planningHints: planningHints ? {
        paceSignal: planningHints.paceSignal === 'compact' || planningHints.paceSignal === 'standard' || planningHints.paceSignal === 'extended'
          ? planningHints.paceSignal
          : null,
        scopeSize: planningHints.scopeSize === 'micro' || planningHints.scopeSize === 'small' || planningHints.scopeSize === 'medium' || planningHints.scopeSize === 'large'
          ? planningHints.scopeSize
          : null,
        milestoneRange: Array.isArray(planningHints.milestoneRange) ? planningHints.milestoneRange : null,
        conceptRange: Array.isArray(planningHints.conceptRange) ? planningHints.conceptRange : null,
        subtasksPerStageRange: Array.isArray(planningHints.subtasksPerStageRange) ? planningHints.subtasksPerStageRange : null,
        subtaskMinutesRange: Array.isArray(planningHints.subtaskMinutesRange) ? planningHints.subtaskMinutesRange : null,
        maxWeeks: typeof planningHints.maxWeeks === 'number' ? planningHints.maxWeeks : null,
        targetMilestones: typeof planningHints.targetMilestones === 'number' ? planningHints.targetMilestones : null,
        targetSubtasksPerStage: typeof planningHints.targetSubtasksPerStage === 'number' ? planningHints.targetSubtasksPerStage : null,
      } : null,
      prerequisiteCheckResults: Array.isArray(normalizedInput.prerequisiteCheckResults)
        ? normalizedInput.prerequisiteCheckResults.map((item: any) => ({
            probeId: normalizePromptString(item?.probeId),
            targetConcept: normalizePromptString(item?.targetConcept),
            userAnswer: normalizePromptString(item?.userAnswer),
            isCorrect: typeof item?.isCorrect === 'boolean' ? item.isCorrect : undefined,
          }))
        : null,
      timeDimensions: normalizedInput.timeDimensions && typeof normalizedInput.timeDimensions === 'object'
        ? {
            totalWeeks: Number.isFinite(normalizedInput.timeDimensions.totalWeeks) ? normalizedInput.timeDimensions.totalWeeks : null,
            estimatedHours: Number.isFinite(normalizedInput.timeDimensions.estimatedHours) ? normalizedInput.timeDimensions.estimatedHours : null,
            sessionsPerWeek: Number.isFinite(normalizedInput.timeDimensions.sessionsPerWeek) ? normalizedInput.timeDimensions.sessionsPerWeek : null,
            sessionsLengthMin: Number.isFinite(normalizedInput.timeDimensions.sessionsLengthMin) ? normalizedInput.timeDimensions.sessionsLengthMin : null,
          }
        : null,
      // 学习证据（规则 53 的唯一依据）：无学习历史时**不出现该键**，冷启动行为与原先完全一致
      ...(buildLearningContextForPrompt(normalizedInput.learnerLearningContext)
        ? { learnerLearningContext: buildLearningContextForPrompt(normalizedInput.learnerLearningContext) }
        : {}),
      // 用户侧补充说明（「补充说明重新生成」）：core 规则明确要求消费
      // normalizedInput.understanding.adjustments，但本投影是逐字段白名单重建 ⇒ understanding 被静默丢。
      // 只透传这一个键（不平铺整个 understanding），保持白名单纪律。
      ...(normalizePromptString(normalizedInput.understanding?.adjustments)
        ? { understanding: { adjustments: normalizePromptString(normalizedInput.understanding?.adjustments) } }
        : {}),
    },
      };
}

/** 重调分区限长（token 预算）：反馈与原路径都是长文本，且会与学习者投影叠加。 */
const REPLAN_FEEDBACK_MAX = 1200;
const REPLAN_PREVIOUS_PLAN_MAX = 2400;

/**
 * 【被调整的原路径】渲染：只保留模型真正需要的结构信息（名称/摘要/核心概念/里程碑标题与目标），
 * 逐段限长。把旧路径 JSON 全量塞进载荷会挤掉本次生成的有效输入。
 */
export function renderPreviousPlanForPrompt(plan: any): string {
  if (!plan || typeof plan !== 'object') return '';
  const lines: string[] = [];

  const name = typeof plan.name === 'string' && plan.name.trim() ? plan.name.trim() : null;
  if (name) lines.push(`- 原路径名：${name}`);
  const summary = typeof plan.summary === 'string' && plan.summary.trim() ? plan.summary.trim() : null;
  if (summary) lines.push(`- 原路径摘要：${summary.slice(0, 300)}`);

  const core = plan.cognitiveCore || plan.cognitiveDesign;
  const coreConcepts = Array.isArray(core?.coreConcepts)
    ? core.coreConcepts.map((c: any) => (typeof c?.name === 'string' ? c.name : '')).filter(Boolean)
    : [];
  if (coreConcepts.length > 0) lines.push(`- 原核心概念：${coreConcepts.slice(0, 10).join('、')}`);

  const milestones = Array.isArray(plan.milestones) ? plan.milestones : [];
  if (milestones.length > 0) {
    const rendered = milestones.slice(0, 12).map((m: any, index: number) => {
      const title = typeof m?.title === 'string' && m.title.trim()
        ? m.title.trim()
        : (typeof m?.name === 'string' && m.name.trim() ? m.name.trim() : '(未命名阶段)');
      const goal = typeof m?.goal === 'string' && m.goal.trim() ? ` — ${m.goal.trim().slice(0, 120)}` : '';
      return `  ${index + 1}. ${title}${goal}`;
    });
    lines.push(`- 原里程碑（共 ${milestones.length} 个）：\n${rendered.join('\n')}`);
  }

  return lines.length > 0 ? lines.join('\n').slice(0, REPLAN_PREVIOUS_PLAN_MAX) : '';
}

/**
 * 重调分区渲染：模式/来源/冻结任务 + 【路径评审反馈】 + 【被调整的原路径】 + 学习者重调投影 + 重调要求。
 *
 * 评审反馈此前只被写进 replan 对象、**从不渲染**，也没有旧路径可对照 ⇒ 规则 #4「逐条修正评审反馈」
 * 完全失效，自动重规划退化成「同样输入的再次采样」（审计 P0 §1.3）。
 */
export function renderReplanSection(replan: any): string {
  if (!replan || typeof replan !== 'object') return '';

  const reviewerFeedback = typeof replan.reviewerFeedback === 'string' && replan.reviewerFeedback.trim()
    ? replan.reviewerFeedback.trim().slice(0, REPLAN_FEEDBACK_MAX)
    : null;
  // 用户侧补充说明（「补充说明重新生成」route 写进 replan.reason）：core 规则要求与评审反馈同级消费，
  // 但此前从不渲染 ⇒ 用户可见功能实际无效（审计 P1 §2.2a）。
  const reason = typeof replan.reason === 'string' && replan.reason.trim()
    ? replan.reason.trim().slice(0, REPLAN_FEEDBACK_MAX)
    : null;
  const previousPlan = renderPreviousPlanForPrompt(replan.previousPlan);
  const freeze = Array.isArray(replan.freezeCompletedTaskIds) && replan.freezeCompletedTaskIds.length > 0
    ? replan.freezeCompletedTaskIds.join('、')
    : '无';

  return `
【路径重调模式】
- 重调模式：${replan.mode || 'overwrite'}
- 触发来源：${replan.triggerSource || 'unknown'}
- 源路径 ID：${replan.sourcePathId || 'unknown'}
- 冻结已完成任务：${freeze}
${reason ? `
【用户补充说明】（用户明确提出的调整要求，必须落实；与评审反馈冲突时以评审反馈为准）
${reason}
` : ''}${reviewerFeedback ? `
【路径评审反馈】（上一版被评审否决的具体结构缺陷，必须逐条修正）
${reviewerFeedback}
` : ''}${previousPlan ? `
【被调整的原路径】（这是被调整的上一版，不要从零重新采样）
${previousPlan}
` : ''}
【学习者重调投影】
${JSON.stringify(replan.learnerReplanProjection || {}, null, 2)}

【重调要求】
1. 这是对现有学习路径的调整重调，不是从零忽略已有学习历史重新规划。
2. 必须显式参考学习者已稳定掌握、掌握不稳、持续吃力和前置缺口信息。
3. 不要围绕已稳定掌握内容重复铺设大量基础阶段。
4. 对掌握不稳和前置缺口内容，应通过补桥接阶段、补充任务、降低阶段跳跃度来处理。
5. 如果已完成任务被冻结，请把它们视为既有学习历史，不要简单复制同名任务来伪装重调。${reviewerFeedback ? `
6. 已提供【路径评审反馈】：必须逐条修正反馈中指出的结构缺陷，并在生成前自检中确认每条都已处理；不得无视反馈与原路径、按同样输入重新采样一遍。` : ''}`;
}


interface PathOutput {
  id?: string;
  name: string;
  summary?: string;
  subject: string;
  totalMilestones: number;
  estimatedHours?: number;
  cognitiveCore?: {
    cognitiveDomain?: string;
    coreConcepts?: Array<{
      id?: string;
      name?: string;
      role?: string;
      description?: string;
    }>;
  };
  cognitiveDesign?: {
    cognitiveDomain?: string;
    coreConcepts?: Array<{
      id?: string;
      name?: string;
      role?: string;
      description?: string;
    }>;
  };
  _debug?: {
    rawModelOutput?: string;
    extractedJson?: string;
  };
  runtimeEnvelope?: ReturnType<typeof adaptToRuntimeEnvelope>;
  milestones: MilestoneOutput[];
}

export function validatePathPlanningOutput(
  parsed: any,
  expectedMilestones?: number | null,
  expectedMilestoneRange?: [number, number] | null
) {
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { valid: false as const, failureReason: 'PATH_PLANNING_OUTPUT_NOT_OBJECT' };
  }

  if (typeof parsed.name !== 'string' || !parsed.name.trim()) {
    return { valid: false as const, failureReason: 'PATH_PLANNING_NAME_MISSING' };
  }

  if (!Array.isArray(parsed.milestones) || parsed.milestones.length === 0) {
    return { valid: false as const, failureReason: 'PATH_PLANNING_MILESTONES_MISSING' };
  }

  if (!parsed.cognitiveCore || typeof parsed.cognitiveCore !== 'object' || Array.isArray(parsed.cognitiveCore)) {
    return { valid: false as const, failureReason: 'PATH_PLANNING_COGNITIVE_CORE_MISSING' };
  }

  const coreConcepts = Array.isArray(parsed.cognitiveCore.coreConcepts)
    ? parsed.cognitiveCore.coreConcepts.filter((c: any) => c && typeof c === 'object')
    : [];
  if (coreConcepts.length > 0) {
    const hubCount = coreConcepts.filter((c: any) => c.role === 'hub').length;
    if (hubCount === 0) {
      return { valid: false as const, failureReason: 'PATH_PLANNING_HUB_CONCEPT_MISSING' };
    }
    if (hubCount > 1) {
      return { valid: false as const, failureReason: 'PATH_PLANNING_HUB_CONCEPT_MULTIPLE' };
    }
  }

  const conceptIds = new Set<string>();
  const conceptNames = new Set<string>();
  let hubConceptId: string | null = null;
  for (const concept of coreConcepts) {
    if (typeof concept.id === 'string' && concept.id) conceptIds.add(concept.id);
    if (typeof concept.name === 'string' && concept.name) conceptNames.add(concept.name);
    if (concept.role === 'hub') hubConceptId = concept.id;
  }
  let hubReuseCount = 0;
  const milestonesArray = parsed.milestones;
  for (const milestone of milestonesArray) {
    if (!milestone || typeof milestone !== 'object') {
      return { valid: false as const, failureReason: 'PATH_PLANNING_MILESTONE_INVALID' };
    }
    if (milestone.subtasks !== undefined || milestone.acceptanceCriteria !== undefined) {
      return { valid: false as const, failureReason: 'PATH_PLANNING_LEGACY_TASK_FIELDS' };
    }
    if (conceptIds.size > 0 && typeof milestone.coreConcept === 'string' && milestone.coreConcept
      && !conceptIds.has(milestone.coreConcept) && !conceptNames.has(milestone.coreConcept)) {
      return { valid: false as const, failureReason: 'PATH_PLANNING_MILESTONE_CONCEPT_UNBOUND' };
    }
    // hub 复用统计（rule 66：hub 必须被"非首阶段"milestone 显式复用，不含首阶段）
    const isFirstStage = milestone.stageNumber === 1;
    if (!isFirstStage && hubConceptId && typeof milestone.coreConcept === 'string') {
      const hubConcept = coreConcepts.find((c: any) => c.role === 'hub');
      if (hubConcept && (milestone.coreConcept === hubConceptId
        || (hubConcept.name && milestone.coreConcept === hubConcept.name))) {
        hubReuseCount += 1;
      }
    }
  }
  // hub 复用下限（CLT 回捞约束代码化）：milestone ≥3 时至少被 2 个非首阶段 milestone 复用，
  // milestone=2 时至少 1 个。实测历史合规率仅 ~13%（LLM 倾向每阶段挂新概念而非回捞 hub），
  // 直接阻断会打回 86% 路径破坏生产 → 当前为"警告级"审计：记录 warning 不阻断，积累数据后再决定收紧。
  const warnings: string[] = [];
  const hubRequired = milestonesArray.length >= 3 ? 2 : milestonesArray.length === 2 ? 1 : 0;
  if (hubConceptId && hubRequired > 0 && hubReuseCount < hubRequired) {
    warnings.push(`PATH_PLANNING_HUB_REUSE_INSUFFICIENT(reused=${hubReuseCount}, required=${hubRequired})`);
  }

  // CLT 概念密度审计（rule 52 代码化，警告级）：
  // 每个 milestone 挂 1 个 coreConcept，因此"单阶段新概念 ≤3""相邻增量 ≤2"在单挂载
  // 结构下天然满足（每阶段只引入 1 个新概念）。真实风险在概念总量失控——整条路径的
  // 唯一概念数应落在 planningHints.conceptRange 附近，现在以 8 为外的硬上限做警告。
  const conceptRefs = milestonesArray
    .map((m: any) => (typeof m?.coreConcept === 'string' ? m.coreConcept : ''))
    .filter(Boolean);
  const uniqueConcepts = new Set(conceptRefs).size;
  if (uniqueConcepts > 8) {
    warnings.push(`PATH_PLANNING_CONCEPT_COUNT_HIGH(totalConcepts=${uniqueConcepts}, cap=8)`);
  }
  const stageNumbers = parsed.milestones.map((m: any) => m && m.stageNumber).filter((n: any) => typeof n === 'number');
  if (stageNumbers.length === parsed.milestones.length && stageNumbers.length > 0) {
    const contiguous = stageNumbers.every((n: number, i: number) => n === i + 1);
    if (!contiguous) {
      return { valid: false as const, failureReason: 'PATH_PLANNING_STAGE_NUMBER_GAP' };
    }
  }

  // 里程碑数量：方案乙——**区间校验**（数量由 LLM 在区间内决定），仅越界才阻断；
  // 未提供区间时保留旧的精确校验（向后兼容，如 replan 只给单点）。
  const milestoneCount = parsed.milestones.length;
  if (Array.isArray(expectedMilestoneRange) && expectedMilestoneRange.length === 2) {
    const [lo, hi] = expectedMilestoneRange;
    if (Number.isInteger(lo) && Number.isInteger(hi) && (milestoneCount < lo || milestoneCount > hi)) {
      return {
        valid: false as const,
        failureReason: `PATH_PLANNING_MILESTONE_COUNT_OUT_OF_RANGE(expected=${lo}..${hi}, got=${milestoneCount})`,
      };
    }
  } else if (typeof expectedMilestones === 'number' && Number.isInteger(expectedMilestones) && expectedMilestones >= 1) {
    if (milestoneCount !== expectedMilestones) {
      return {
        valid: false as const,
        failureReason: `PATH_PLANNING_MILESTONE_COUNT_MISMATCH(expected=${expectedMilestones}, got=${milestoneCount})`,
      };
    }
  }

  const result: { valid: true; warnings?: string[] } = { valid: true as const };
  if (warnings.length > 0) result.warnings = warnings;
  return result;
}

/**
 * Path Agent 定义
 */
export const pathAgentDefinition: AgentDefinition = {
  id: 'skill:path-planning',
  name: '学习路径规划 Skill',
  version: '2.0.0',
  type: 'path',
  category: 'standard',
  description: '根据用户目标生成里程碑式学习路径，支持动态调整',
  
  capabilities: [
    'path-generation',
    'milestone-planning',
    'dynamic-replanning',
    'time-estimation'
  ],
  
  subscribes: [
    'learning:speed:change',
    'learning:focus:shift',
    'learning:fatigue:high',
    'learning:struggle',
    'learning:mastery'
  ],
  
  publishes: [
    'path:created',
    'path:adjusted',
    'path:completed'
  ],
  
  inputSchema: {
    type: 'object',
    properties: {
      type: { type: 'string' },
      goal: { type: 'string', description: '用户的真实学习目标' },
      currentLevel: { type: 'string', description: '用户当前水平' },
      timePerDay: { type: 'string', description: '每天可用时间' },
      metadata: {
        type: 'object',
        properties: {
          availableTime: { type: 'string' },
          deadline: { type: 'string' },
          deadlineText: { type: 'string' }
        }
      },
      // 新增：完整数据包
      structuredData: {
        type: 'object',
        description: 'GoalConversationAgent 梳理的结构化信息'
      },
      confirmedProposal: {
        type: 'object',
        description: '用户确认的方案轮廓'
      },
      confidenceScores: {
        type: 'object',
        description: '置信度评分'
      },
      conversationHistory: {
        type: 'array',
        description: '完整对话历史'
      }
    },
    required: ['type', 'goal']
  },
  
  outputSchema: {
    type: 'object',
    properties: {
      path: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          summary: { type: 'string' },
          totalMilestones: { type: 'number' },
          estimatedHours: { type: 'number' },
          cognitiveCore: { type: 'object' },
          cognitiveDesign: { type: 'object' },
          milestones: { type: 'array' }
        }
      }
    }
  },
  
  stats: {
    callCount: 0,
    successRate: 0,
    avgLatency: 0
  }
};

/**
 * Path Agent 处理函数
 */
export async function pathAgentHandler(
  input: AgentInput,
  context: AgentContext
): Promise<AgentOutput> {
  const startTime = Date.now();
  
  try {
    // 1. 分析用户目标
    const goalAnalysis = await analyzeGoal(input, context);
    
    // 2. 生成学习路径（包含里程碑）
    const path = await generatePath(input, context, goalAnalysis);
    
    // 注：path:created 事件由 durable outbox 承担（learning.service persistGeneratedPath），内存总线已退役

    return {
      success: true,
      userVisible: `学习路径已生成：${path.name}`,
      path,
      internal: {
        core: {
          stage: 'completed',
          confidence: goalAnalysis.confidence,
          isCompleted: true
        },
        ext: {
          path: {
            path,
            totalMilestones: path.milestones?.length || 0
          }
        },
        path,
        totalMilestones: path.milestones?.length || 0,
      },
      renderHints: {
        component: 'learning-path',
        totalMilestones: path.milestones?.length || 0,
      },
      schemaVersion: 'agent-output-v1',
      metadata: {
        agentId: 'skill:path-planning',
        agentName: '学习路径规划 Skill',
        agentType: 'path',
        confidence: goalAnalysis.confidence,
        generatedAt: new Date().toISOString()
      }
    };
  } catch (error) {
    return {
      success: false,
      userVisible: '学习路径生成失败，请稍后重试',
      error: {
        code: 'PATH_AGENT_FAILED',
        message: error instanceof Error ? error.message : 'Unknown error'
      },
      schemaVersion: 'agent-output-v1',
      metadata: {
        agentId: 'skill:path-planning',
        agentName: '学习路径规划 Skill',
        agentType: 'path',
        confidence: 0,
        generatedAt: new Date().toISOString()
      }
    };
  }
}

/**
 * 分析用户目标
 */
async function analyzeGoal(input: AgentInput, context: AgentContext): Promise<{
  subject: string;
  level: string;
  focus: string[];
  context: string;
  confidence: number;
  structuredData?: any;
  confirmedProposal?: any;
  conversationHistory?: any[];
  scenario?: string;
  replan?: any;
  normalizedInput?: any;
}> {
  const caller: CallerInfo = { agentId: 'path-agent', skillId: 'path-planning' };
   
  const structuredData = input.structuredData as any;
  const confirmedProposal = input.confirmedProposal as any;
  const conversationHistory = input.conversationHistory as any[] || [];
  const replan = input.metadata?.replan as any;
  const framingNormalizedInput = input.metadata?.normalizedInput && typeof input.metadata.normalizedInput === 'object'
    ? input.metadata.normalizedInput
    : null;
  const framingPainPoints = Array.isArray(framingNormalizedInput?.learnerProfile?.painPoints)
    ? framingNormalizedInput.learnerProfile.painPoints.filter(Boolean)
    : [];
  const framingContext = typeof framingNormalizedInput?.problemSpace?.scenario === 'string' && framingNormalizedInput.problemSpace.scenario.trim()
    ? framingNormalizedInput.problemSpace.scenario.trim()
    : (typeof framingNormalizedInput?.problemSpace?.currentPainPoint === 'string' && framingNormalizedInput.problemSpace.currentPainPoint.trim()
      ? framingNormalizedInput.problemSpace.currentPainPoint.trim()
      : '');
  const framingLevel = typeof framingNormalizedInput?.learnerProfile?.currentBaseline?.level === 'string' && framingNormalizedInput.learnerProfile.currentBaseline.level.trim()
    ? framingNormalizedInput.learnerProfile.currentBaseline.level.trim()
    : null;
  
  if (structuredData) {
    logger.info('使用结构化数据', {
      learner: structuredData.learner,
      end_user: structuredData.end_user,
      context: structuredData.learning_context
    });
    
    let scenario = 'standard';
    if (structuredData.learner?.identity === '帮他人') {
      scenario = 'proxy_learning';
    } else if (structuredData.learning_context?.urgency === 'urgent') {
      scenario = 'urgent_learning';
    } else if (structuredData.learning_context?.motivation === 'interest') {
      scenario = 'interest_learning';
    }
    
    return {
      subject: input.goal,
      level: framingLevel || structuredData.learner?.skill_level || input.currentLevel || 'beginner',
      focus: framingPainPoints.length > 0 ? framingPainPoints : (structuredData.end_user?.pain_points || []),
      context: framingContext || structuredData.end_user?.identity || '',
      confidence: input.confidenceScores?.understanding || 0.8,
      scenario,
      structuredData,
      confirmedProposal,
      conversationHistory,
      replan,
      normalizedInput: framingNormalizedInput,
    };
  }
  
  const userId = context?.userId || input?.metadata?.userId;
  // 无结构化数据时的确定性兜底分析（原 goal-analysis aux skill 已移除：
  // 主流程有 normalizedInput/structuredData 时不调用，fallback 输出也被 framing 覆盖，2026-08 去 LLM 化）
  void userId;
  const parsed = {
    subject: String(input.goal || '学习目标'),
    level: ['beginner', 'intermediate', 'advanced'].includes(input.currentLevel as string)
      ? input.currentLevel as string
      : 'beginner',
    focus: [] as string[],
    context: '',
    confidence: 0.5,
  };

  return {
    ...parsed,
    level: framingLevel || parsed.level,
    focus: framingPainPoints.length > 0 ? framingPainPoints : (Array.isArray(parsed.focus) ? parsed.focus : []),
    context: framingContext || parsed.context || '',
    confidence: typeof parsed.confidence === 'number' ? parsed.confidence : 0.5,
    replan,
    normalizedInput: framingNormalizedInput,
  };
}

/**
 * 生成学习路径（里程碑模式）
 */
async function generatePath(
  input: AgentInput,
  context: AgentContext,
  analysis: { 
    subject: string; 
    level: string; 
    focus: string[]; 
    context: string; 
    confidence: number;
    scenario?: string;
    structuredData?: any;
    confirmedProposal?: any;
    conversationHistory?: any[];
    replan?: any;
    normalizedInput?: any;
  }
): Promise<PathOutput> {
  
  const confirmedProposal = analysis.confirmedProposal;
  const conversationHistory = analysis.conversationHistory;
  const replan = analysis.replan;
  const framingNormalizedInput = analysis.normalizedInput && typeof analysis.normalizedInput === 'object'
    ? analysis.normalizedInput
    : null;
  const framingConfirmedProposal = framingNormalizedInput?.confirmedProposal && typeof framingNormalizedInput.confirmedProposal === 'object'
    ? framingNormalizedInput.confirmedProposal
    : null;
  const confirmedLearningDirection = framingConfirmedProposal?.learningDirection
    || confirmedProposal?.learningDirection
    || confirmedProposal?.learning_direction
    || null;
  const confirmedFirstDeliverable = framingConfirmedProposal?.firstDeliverable
    || confirmedProposal?.firstDeliverable
    || confirmedProposal?.first_deliverable
    || null;
  const confirmedStages = Array.isArray(framingConfirmedProposal?.keyStages)
    ? framingConfirmedProposal.keyStages.filter(Boolean)
    : Array.isArray(confirmedProposal?.keyStages)
      ? confirmedProposal.keyStages.filter(Boolean)
      : Array.isArray(confirmedProposal?.key_stages)
        ? confirmedProposal.key_stages.filter(Boolean)
        : [];
  const confirmedOutOfScope = Array.isArray(framingConfirmedProposal?.outOfScope)
    ? framingConfirmedProposal.outOfScope.filter(Boolean)
    : Array.isArray(confirmedProposal?.outOfScope)
      ? confirmedProposal.outOfScope.filter(Boolean)
      : Array.isArray(confirmedProposal?.out_of_scope)
        ? confirmedProposal.out_of_scope.filter(Boolean)
        : [];
  const observableResult = framingNormalizedInput?.successCriteria?.observableResult || null;
  const acceptanceCheck = framingNormalizedInput?.successCriteria?.acceptanceCheck || null;
  // 强制里程碑数量：优先取 framing planningHints.targetMilestones（由 keyStages 直接得出），
  // 其次用已确认 keyStages 数量推导；均缺失时为 null（validator 跳过数量校验）
  // 里程碑数量：方案乙——优先用规划的**权威区间**（LLM 在区间内自定数量）；
  // 无区间时回退到「确认阶段数」组成的单点区间（replan 等路径）。
  const framingMilestoneRange = (framingNormalizedInput?.planningHints as any)?.milestoneRange;
  const expectedMilestoneRange: [number, number] | null =
    Array.isArray(framingMilestoneRange)
    && framingMilestoneRange.length === 2
    && framingMilestoneRange.every((n: any) => Number.isInteger(n))
      ? [framingMilestoneRange[0], framingMilestoneRange[1]]
      : (confirmedStages.length > 0
          ? [Math.min(8, Math.max(2, confirmedStages.length)), Math.min(8, Math.max(2, confirmedStages.length))]
          : null);
  const expectedMilestones: number | null = Number.isInteger(
    (framingNormalizedInput?.planningHints as any)?.targetMilestones
  )
    ? (framingNormalizedInput?.planningHints as any).targetMilestones
    : confirmedStages.length > 0
      ? Math.min(8, Math.max(2, confirmedStages.length))
      : null;
  const promptFriendlySceneFraming = buildPromptFriendlyNormalizedInput(framingNormalizedInput);

  const userPayload = `原始学习目标：${input.goal}
学习主题：${analysis.subject}
目标水平：${analysis.level}
${analysis.context ? `具体应用场景：${analysis.context}` : ''}
${analysis.focus.length > 0 ? `学习重点：${analysis.focus.join('、')}` : ''}
${input.metadata?.availableTime ? `可用时间：${input.metadata.availableTime}` : ''}
${input.metadata?.totalWeeks ? `总学习周期（周）：${input.metadata.totalWeeks}` : ''}

${confirmedProposal || framingConfirmedProposal ? `用户确认的方案轮廓：
- 学习方向：${confirmedLearningDirection || '--'}
- 首个产出：${confirmedFirstDeliverable || '--'}
- 关键阶段：${confirmedStages.join('、') || '--'}
- 暂不纳入范围：${confirmedOutOfScope.join('、') || '--'}
- 学习方式：${confirmedProposal?.learning_style || confirmedProposal?.learningStyle || '--'}

【重要】请基于用户确认的方案轮廓设计路径阶段，保持方向一致。` : ''}

${promptFriendlySceneFraming ? `路径前置清洗结果（高优先级参考输入）：
${JSON.stringify(promptFriendlySceneFraming, null, 2)}

【重要】如果提供了这份清洗结果，请把它视为上游已整理好的正式输入：
- 优先依据其中的 normalizedInput.problemSpace.realProblem、normalizedInput.successCriteria、normalizedInput.confirmedProposal 设计路径
- 第一阶段必须直接服务于 normalizedInput.confirmedProposal.firstDeliverable（若存在）
- 不要把 confirmedProposal.keyStages 直接抄成 coreConcept；keyStages 是阶段提示，不是隐藏概念名称。` : ''}

${conversationHistory && conversationHistory.length > 0 ? `
完整对话历史（用于验证关键信息）：
${conversationHistory.map((m: any) => `${m.role}: ${m.content}`).join('\n')}

【重要】如果对某些信息不确定（如学习者身份），请查看对话历史验证。` : ''}

${replan ? renderReplanSection(replan) : ''}

【强制要求】以下所有生成内容必须紧密围绕"${analysis.context || input.goal}"展开：
- 路径名称必须包含"${analysis.context || input.goal}"的核心主题关键词（提取 2-6 字即可），不得使用通用模板名称
- 每个里程碑的标题必须体现"${analysis.context || input.goal}"的具体阶段
- 禁止使用电商、音乐 App、房价预测、鸢尾花、泰坦尼克号等通用示例，全部替换为"${analysis.context || input.goal}"相关场景

重要要求：
1. 所有里程碑标题、描述、goal 都要具体化到"${analysis.context || input.goal}"场景，不要使用泛泛的通用描述

（名称口径不在此处复述：**唯一源是系统提示里的"路径名称"规则**（结果/场景名、禁交付口径水平词）。
此处曾硬编码一份"核心主题/技能 + 水平词、beginner 必须写入门/基础/从零开始"的规则，
与 core.yaml 构成双源且方向相反——payload 在 system prompt 之后，实际压过了 yaml，
导致 75% 路径名仍带"入门"（2026-09-21 实测）。已删除，避免第二份真理。）

生成前自检（必须满足）：
1. 不要把里程碑写成“内容呈现/课程交互/学习路径展示/个人数据面板”这类功能分组；如果阶段标题像功能目录，必须重组为认知递进阶段。
2. 不要输出 subtasks、tasks、acceptanceCriteria、第一周计划、执行次数或作业清单；这些由后续 stage-designer 生成。
3. 如果 ${confirmedFirstDeliverable ? `首个交付物是“${confirmedFirstDeliverable}”` : '存在首个交付物'}，第一阶段 goal 必须直接服务于它。
4. ${observableResult ? `可观察结果是“${observableResult}”，所有里程碑 goal 都必须通向它。` : '如果没有明确的可观察结果，就把首个交付物当作早期阶段目标锚点。'}
5. ${acceptanceCheck ? `验收检查要求：${acceptanceCheck}` : 'goal 必须是用户自己可以判断“是否达成”的阶段结果，但不要下钻到 task 级验收。'}
6. coreConcepts 必须先表达底层认知关系，再用于绑定里程碑；如果概念名仍像功能名、页面名、模块名、栏目名或任务动作句，必须继续抽象。`;

  const userId = context?.userId || input?.metadata?.userId;
  const systemPromptOverride = (context as any)?.metadata?.pathAgentSystemPromptOverride as string | undefined;
  // 资料（投影后）：既用于提示词，也用于 materialRefs 的**逐字核对**与覆盖度观测
  const promptMaterials = buildPromptFriendlyMaterials(
    (input as any)?.metadata?.normalizedInput?.resources?.materials,
  );
  const result = await callPrompt<any, PathOutput>({
    agentId: 'skill:path-planning',
    defaultSystemPrompt: PATH_PLANNING_PROMPT,
    requireActivePrompt: true,
    caller: { agentId: 'path-agent', skillId: 'path-planning' },
        buildUserPayload: () => userPayload,
    normalizeOutput: (pathData) => {
      // estimatedHours/estimatedWeeks 合法性钳制：非有限/负值/超合理上限 → 置 null（让下游 0 兜底）
      const clampHours = (v: any): number | null => {
        const n = Number(v);
        if (!Number.isFinite(n) || n <= 0 || n > 10000) return null;
        return Math.round(n);
      };
      const clampWeeks = (v: any): number | null => {
        const n = Number(v);
        if (!Number.isFinite(n) || n <= 0 || n > 104) return null;
        return n;
      };
      const estimatedHours = clampHours(pathData.estimatedHours);
      const estimatedWeeks = clampWeeks(pathData.estimatedWeeks);
      // materialRefs 覆盖度观测（有资料却没引用 → 可观测，不阻断生成）
      if (promptMaterials?.length) {
        const milestones = Array.isArray(pathData.milestones) ? pathData.milestones : [];
        const withRefs = milestones.filter((m: any) => Array.isArray(m?.materialRefs) && m.materialRefs.length > 0).length;
        if (withRefs === 0) {
          logger.warn('[path-planning] 有资料但没有任何里程碑给出可核对的 materialRefs（规则未被执行）', {
            userId,
            materials: promptMaterials.length,
            milestones: milestones.length,
          });
        }
      }
      return {
        id: `path_${Date.now()}`,
        name: pathData.name,
        summary: typeof pathData.summary === 'string' ? pathData.summary : undefined,
        subject: analysis.subject,
        totalMilestones: pathData.totalMilestones,
        estimatedHours,
        estimatedWeeks,
        cognitiveCore: pathData.cognitiveCore || pathData.cognitiveDesign,
        cognitiveDesign: pathData.cognitiveDesign || pathData.cognitiveCore,
        // materialRefs 在**这里**做逐字核对（normalizeOutput 拿得到 input 侧的投影资料）：
        // coerce 只影响契约校验，真正落库的是本函数的产物。
        milestones: (Array.isArray(pathData.milestones) ? pathData.milestones : []).map((milestone: any) => {
          if (!milestone || typeof milestone !== 'object') return milestone;
          const refs = normalizeMaterialRefs(milestone.materialRefs, promptMaterials);
          const next = { ...milestone };
          if (refs.length) next.materialRefs = refs;
          else delete next.materialRefs;
          return next;
        }),
        _debug: {
          rawModelOutput: '',
          extractedJson: '',
        }
      };
    },
    coerceParsedForContract: (parsed: any) => coercePathPlanningParsed(parsed, promptMaterials),
    validateParsedOutput: (parsed) => validatePathPlanningOutput(parsed, expectedMilestones, expectedMilestoneRange),
    mapEnvelope: (output, _input, runtimeContract) => adaptToRuntimeEnvelope({
      contract: runtimeContract,
      artifact: output,
      phase: 'core-path-generated',
      status: 'succeeded',
      isTerminal: true,
      nextAction: null,
      nextState: null,
    }),
    retryStrategy: {
      maxAttempts: 2,
      onValidationFail: ({ failureReason }) => `${buildPathValidationRepairNotice(failureReason)}`
        + `上次失败原因：${failureReason}`,
    },
  }, input, { userId, ...(systemPromptOverride ? { systemPromptOverride } : {}) });

  if (!result.success || !result.output) {
    throw new Error(result.error?.message || 'PATH_AGENT_OUTPUT_INVALID');
  }

  return {
    ...result.output,
    runtimeEnvelope: result.runtimeEnvelope,
    _debug: {
      rawModelOutput: result.debug.rawModelOutput,
      extractedJson: result.debug.extractedJson || undefined,
    }
  };
}

export default pathAgentHandler;

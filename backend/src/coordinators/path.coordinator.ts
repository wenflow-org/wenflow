import { logger } from '../utils/logger';
import {
  BackgroundTaskRejectedError,
  backgroundTaskTracker,
  runBackgroundTask
} from '../services/background-task-tracker.service';
import learningService from '../services/learning/learning.service';
import { buildFramedNormalizedInput, type LearnerLoadProfile } from '../services/learning/path-planning-hints';
import { buildUploadedMaterialPacks } from '../services/materials/material-pack.builder';
import type { ResponseTriage } from '../services/learning/response-triage';
import {
  getPathAgentInputConfig,
  type PathAgentInputConfig
} from '../services/agentConfig.service';
import type { GoalPathTimeBudgetCadence, GoalPathVisibleSummary } from '../services/learning/goal-path-visible-summary';
import type { MaterialNeed, MaterialPackResult } from '../skills/material-collector/types';

const COORDINATOR_ID = 'path-agent';

/**
 * 资料采集开关：默认开启（goal 声明了 needsMaterial 才触发，缺省零调用）。
 * 复用仓库既有的 `*_DISABLED === '1'` env 模式（同 SKILLS_FILE_DISABLED）；
 * 设 `MATERIAL_COLLECTION_DISABLED=1` 可整体关闭，path 生成行为回到接线前。
 */
function isMaterialCollectionEnabled(): boolean {
  return process.env.MATERIAL_COLLECTION_DISABLED !== '1';
}

/** 总超时上限（毫秒）：到点即 fail-open 跳过，避免 path 生成被检索拖死。env 可覆盖，封顶 120s。 */
function resolveMaterialCollectionTimeoutMs(): number {
  const raw = Number(process.env.MATERIAL_COLLECTION_TIMEOUT_MS);
  if (Number.isFinite(raw) && raw > 0) return Math.min(raw, 120_000);
  return 20_000;
}

/** 单次生成最多采集几条 need（防批量/恶意大量声明拖慢 path 生成）。 */
const MATERIAL_COLLECTION_MAX_NEEDS = 3;

/** 带超时的 promise：到点 reject（可选触发 onTimeout，如 abort 下游 signal），成功/失败都清定时器。 */
function withTimeout<T>(promise: Promise<T>, timeoutMs: number, onTimeout?: () => void): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      try { onTimeout?.(); } catch { /* abort 失败不影响 fail-open */ }
      reject(new Error(`MATERIAL_COLLECTION_TIMEOUT:${timeoutMs}ms`));
    }, timeoutMs);
    if (typeof (timer as any).unref === 'function') (timer as any).unref();
    promise.then(
      (value) => { clearTimeout(timer); resolve(value); },
      (error) => { clearTimeout(timer); reject(error); }
    );
  });
}


export interface PathGenerationInput {
  source?: 'goal' | 'learn' | 'replan' | 'api';
  mode?: 'generate' | 'expand' | 'compress' | 'replan';
  userId: string;
  description: string;
  subject?: string;
  deadline?: Date;
  deadlineText?: string;
  sourceConversationId?: string;
  existingPathId?: string;
  generationRunId?: string;
  createdPlaceholder?: boolean;
  userProfile?: any;
  systemPromptOverrides?: {
    pathAgent?: string;
  };
}

/** 前置知识探测结果（goal 层 prerequisiteCheckResults 透传，供 path-planning prerequisiteTree.knownConcepts 校准） */
interface PrerequisiteCheckResult {
  probeId?: string;
  targetConcept?: string;
  userAnswer?: string;
  isCorrect?: boolean;
}

interface GoalFinalPayload {
  sourceConversationId?: string;
  existingPathId?: string;
  rawGoal: string;
  visibleSummary?: GoalPathVisibleSummary | null;
  conversationHistory?: Array<{ role: string; content: string }>;
  finalUserVisible?: string | null;
  /** 配置式值流转（P1 试点）：routings 表 goal-agent 交付行抽取的 goal→path 字段 */
  goalHandoffFields?: Record<string, any>;
  /** 用户侧补充说明（path 页面"补充说明重新生成"） */
  adjustments?: string | null;
  /** 前置知识探测结果（goal 层 prerequisiteCheckResults 透传，供 prerequisiteTree.knownConcepts 校准） */
  prerequisiteCheckResults?: PrerequisiteCheckResult[] | null;
}

interface NormalizedPathInputV1 {
  version: '1.0';
  learnerProfile: {
    surfaceGoal: string | null;
    currentBaseline: {
      level: string | null;
      evidence: string | null;
    };
    motivation: string | null;
    urgency: string | null;
    backgroundExperience: string | null;
    painPoints: string[];
    learningSignal: string | null;
    goalOrientation: string | null;
    constraintsAndBoundaries: string[];
  };
  problemSpace: {
    realProblem: string | null;
    scenario: string | null;
    currentPainPoint: string | null;
  };
  resources: {
    timeBudget: string | null;
    timeBudgetCadence: GoalPathTimeBudgetCadence | null;
    timePerWeek: string | null;
    timePerSession: string | null;
    timeHorizon: string | null;
    deadlineText: string | null;
    /**
     * 外部资料采集结果（material-collector Material Pack）。goal 未声明 needsMaterial
     * 或采集失败/未开启时为缺失/not_found 条目，**不阻塞**路径生成。path-planning 读
     * pack.sections[].id/title 与 keyPoints 设计路径；learn 层按 sourceUrl+cite 引用选段。
     */
    materials?: MaterialPackResult[] | null;
  };
  successCriteria: {
    observableResult: string | null;
    acceptanceCheck: string | null;
  };
  confirmedProposal: {
    learningDirection: string | null;
    firstDeliverable: string | null;
    keyStages: string[];
    outOfScope: string[];
    scopeSize: string | null;
  };
  /** LLM 推断的时间维度数值（goal 层 time_dimensions 透传，供 planningHints maxWeeks 推导） */
  timeDimensions?: {
    totalWeeks?: number | null;
    estimatedHours?: number | null;
    sessionsPerWeek?: number | null;
    sessionsLengthMin?: number | null;
  } | null;
  /** 前置知识探测结果（goal 层透传，path-planning 读入 prerequisiteTree.knownConcepts） */
  prerequisiteCheckResults?: PrerequisiteCheckResult[];
  /**
   * 用户侧补充说明（「补充说明重新生成」）。只带 path-planning core 规则明确消费的
   * `understanding.adjustments` 一个键——不把整个 goal understanding 塞进 normalizedInput。
   */
  understanding?: {
    adjustments?: string | null;
  } | null;
  /**
   * 学习者负荷画像（可用时间 / 负荷耐受文本）。仅**虚拟学习者**链路会带（来自
   * `virtual_learner_profiles.profile`）；真实用户缺省 `null` ⇒ 体量推导行为不变。
   * 由 `derivePlanningHints` 消费以收紧紧预算/低耐受者的里程碑数、单任务分钟与周期。
   */
  learnerLoadProfile?: LearnerLoadProfile | null;
}

export interface GoalPathRequest {
  userId: string;
  sourceConversationId?: string;
  existingPathId?: string;
  generationRunId?: string;
  createdPlaceholder?: boolean;
  source?: 'goal';
  mode?: 'generate';
  rawGoal: string;
  /** 用户侧补充说明（path 页面"补充说明重新生成"）：进 normalizedInput 供 path-agent 重规划时针对性调整 */
  adjustments?: string | null;
  visibleSummary?: GoalFinalPayload['visibleSummary'];
  conversationHistory?: Array<{ role: string; content: string }>;
  finalUserVisible?: string;
  /** goal skill 产出的结构化画像（learner.identity/learning_context 等），供 path-planning scenario 判定 */
  structuredData?: Record<string, any> | null;
  /** 前置知识探测结果（goal 层 prerequisiteCheckResults 透传） */
  prerequisiteCheckResults?: PrerequisiteCheckResult[] | null;
  /** goal→path 配置式值流转字段（routings 表 goal-agent 交付行抽取，装配时优先于 visibleSummary） */
  goalHandoffFields?: Record<string, any> | null;
  /** 学习者负荷画像（虚拟学习者链路注入 `availableTime`/`cognitiveLoadTolerance`；真实用户不传 ⇒ 行为不变） */
  learnerLoadProfile?: LearnerLoadProfile | null;
  /**
   * 响应分诊结论（goal 层透传，advisory 默认）。仅承载/透传，**不参与 path 生成逻辑**；
   * 缺失（真实用户/旧会话）⇒ undefined，生成行为与今天完全一致。
   */
  responseTriage?: ResponseTriage | null;
  systemPromptOverrides?: {
    pathAgent?: string;
  };
}

export interface LearnPathRequest {
  userId: string;
  learningPathId?: string;
  milestoneId?: string;
  taskId?: string;
  source: 'learn' | 'replan';
  mode: 'expand' | 'compress' | 'replan';
  evidence?: Record<string, any>;
}

class PathCoordinator {
  readonly id = COORDINATOR_ID;

  private getValueByPath(source: Record<string, any>, path: string): any {
    return path.split('.').reduce((acc: any, key: string) => {
      if (acc && typeof acc === 'object') {
        return acc[key];
      }
      return undefined;
    }, source);
  }

  private pickFirstDefined(source: Record<string, any>, paths: string[]): any {
    for (const path of paths) {
      const value = this.getValueByPath(source, path);
      if (value !== undefined && value !== null && !(typeof value === 'string' && !value.trim())) {
        return value;
      }
    }
    return undefined;
  }

  private normalizeString(value: any): string | null {
    return typeof value === 'string' && value.trim() ? value.trim() : null;
  }

  private normalizeStringArray(value: any): string[] {
    if (!Array.isArray(value)) return [];
    return value
      .map((item) => this.normalizeString(item))
      .filter((item): item is string => !!item);
  }

  private normalizeCadence(value: any): GoalPathTimeBudgetCadence | null {
    return value === 'per_day'
      || value === 'per_week'
      || value === 'per_session'
      || value === 'flexible'
      || value === 'unclear'
      ? value
      : null;
  }

  /**
   * normalizedInputV1 配置式装配（P1/P2 golden 验证后的正式切换）：
   * goal-agent 交付字段（goalHandoffFields，来自 routings 表声明）优先，
   * visibleSummary 确定性投影回退；派生字段（timeBudgetCadence/timePerWeek/
   * currentPainPoint）保持既有派生逻辑。
   */
  private buildNormalizedInputV1(
    handoffFields: Record<string, any> | null,
    visibleSummary: GoalPathVisibleSummary | null | undefined,
    rawGoal: string | null | undefined,
    learnerLoadProfile: LearnerLoadProfile | null = null
  ): NormalizedPathInputV1 {
    const pick = (handoffKey: string): any => {
      const value = handoffFields?.[handoffKey];
      return value === undefined || value === null ? undefined : value;
    };
    const str = (handoffKey: string, fallback: any): string | null =>
      this.normalizeString(pick(handoffKey)) ?? this.normalizeString(fallback);
    const arr = (handoffKey: string, fallback: any): string[] =>
      pick(handoffKey) !== undefined
        ? this.normalizeStringArray(pick(handoffKey))
        : this.normalizeStringArray(fallback);

    const timeBudget = str('understanding.available_resources.time_budget', visibleSummary?.resources?.timeBudget)
      ?? str('understanding.available_resources.time_budget', visibleSummary?.resources?.timePerWeek);
    const timePerWeek = str('understanding.available_resources.time_budget', visibleSummary?.resources?.timePerWeek) || timeBudget;
    const painPoints = arr('understanding.pain_points', visibleSummary?.painPoints);

    return {
      version: '1.0',
      learnerProfile: {
        surfaceGoal: str('understanding.surface_goal', visibleSummary?.surfaceGoal)
          || this.normalizeString(rawGoal),
        currentBaseline: {
          level: str('understanding.current_baseline.level', visibleSummary?.currentBaseline?.level),
          evidence: str('understanding.current_baseline.evidence', visibleSummary?.currentBaseline?.evidence),
        },
        motivation: str('understanding.motivation', visibleSummary?.motivation),
        urgency: str('understanding.urgency', visibleSummary?.urgency),
        backgroundExperience: str('understanding.background_experience', visibleSummary?.backgroundExperience),
        painPoints,
        learningSignal: str('understanding.learning_signal', visibleSummary?.learningSignal),
        goalOrientation: str('understanding.goal_orientation', visibleSummary?.goalOrientation),
        constraintsAndBoundaries: arr('understanding.constraints_and_boundaries', visibleSummary?.constraintsAndBoundaries),
      },
      problemSpace: {
        realProblem: str('understanding.real_problem', visibleSummary?.realProblem),
        scenario: str('understanding.scenario', visibleSummary?.scenario),
        currentPainPoint: this.normalizeString(visibleSummary?.currentPainPoint) || painPoints[0] || null,
      },
      resources: {
        timeBudget,
        timeBudgetCadence: this.normalizeCadence(visibleSummary?.resources?.timeBudgetCadence),
        timePerWeek,
        timePerSession: str('understanding.available_resources.time_per_session', visibleSummary?.resources?.timePerSession),
        timeHorizon: str('understanding.available_resources.time_horizon', visibleSummary?.resources?.timeHorizon),
        deadlineText: str('understanding.deadline_text', visibleSummary?.resources?.deadlineText),
      },
      successCriteria: {
        observableResult: str('understanding.success_criteria.observable_result', visibleSummary?.successCriteria?.observableResult),
        acceptanceCheck: str('understanding.success_criteria.acceptance_check', visibleSummary?.successCriteria?.acceptanceCheck),
      },
      confirmedProposal: (pick('confirmedProposal.learning_direction') !== undefined
        || pick('confirmedProposal.first_deliverable') !== undefined
        || visibleSummary?.confirmedProposal) ? {
        learningDirection: str('confirmedProposal.learning_direction', visibleSummary?.confirmedProposal?.learningDirection),
        firstDeliverable: str('confirmedProposal.first_deliverable', visibleSummary?.confirmedProposal?.firstDeliverable),
        keyStages: arr('confirmedProposal.key_stages', visibleSummary?.confirmedProposal?.keyStages),
        outOfScope: arr('confirmedProposal.out_of_scope', visibleSummary?.confirmedProposal?.outOfScope),
        scopeSize: str('confirmedProposal.scope_size', visibleSummary?.confirmedProposal?.scopeSize ?? null),
      } : null,
      timeDimensions: visibleSummary?.timeDimensions ?? null,
      learnerLoadProfile: learnerLoadProfile && (learnerLoadProfile.availableTime || learnerLoadProfile.loadTolerance)
        ? learnerLoadProfile
        : null,
    };
  }
  /**
   * 附件注入（附件是主线）：读该用户上传的资料 → 资料包。
   * 纯本地读盘（无网络/LLM），同步且**绝不抛错**；一份都没有时返回空数组（零影响）。
   * 开关：`MATERIAL_UPLOAD_INJECTION_DISABLED=1` 关闭。
   */
  private resolveUploadedMaterialPacks(userId: unknown): MaterialPackResult[] {
    const id = typeof userId === 'string' ? userId.trim() : '';
    if (!id) return [];
    try {
      return buildUploadedMaterialPacks(id);
    } catch (error) {
      logger.warn('[path-coordinator] 读取上传附件失败，已跳过（fail-open，不阻塞路径生成）', {
        error: error instanceof Error ? error.message : String(error),
      });
      return [];
    }
  }

  /**
   * 资料采集（goal→path 接线缝，最小侵入 + fail-open）：
   *   - 开关：`MATERIAL_COLLECTION_DISABLED=1` 关闭；未声明 needsMaterial 时**零调用**（连模块都不 import）；
   *   - 依赖：动态 import material-collector，避免把 search/fetch/prompt 依赖注入 path.coordinator 的静态图；
   *   - 超时：withTimeout 总上限（默认 20s），到点 abort + 跳过，绝不阻塞路径生成；
   *   - 失败：任何抛错只记一条 warn 日志，并以 status=not_found + note 落入 materials（路径生成继续）。
   */
  private async resolveMaterialPacks(needsMaterial: unknown): Promise<MaterialPackResult[] | null> {
    if (!needsMaterial) return null;
    if (!isMaterialCollectionEnabled()) return null;

    let collector: typeof import('../skills/material-collector');
    try {
      collector = await import('../skills/material-collector');
    } catch (error) {
      logger.warn('[path-coordinator] material-collector 加载失败，跳过资料采集（fail-open）', {
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }

    if (!collector.hasMaterialNeed({ needsMaterial })) return null;

    const needs = (Array.isArray(needsMaterial) ? needsMaterial : [needsMaterial])
      .slice(0, MATERIAL_COLLECTION_MAX_NEEDS) as MaterialNeed[];
    const timeoutMs = resolveMaterialCollectionTimeoutMs();
    const controller = new AbortController();
    const startedAt = Date.now();
    try {
      const results = await withTimeout(
        collector.collectMaterialForGoal(needs, { signal: controller.signal }),
        timeoutMs,
        () => controller.abort()
      );
      return Array.isArray(results) ? results : null;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.warn('[path-coordinator] 资料采集失败，已跳过（fail-open，不阻塞路径生成）', {
        needs: needs.map((need) => need?.title).filter(Boolean),
        durationMs: Date.now() - startedAt,
        error: message,
      });
      return [{
        status: 'not_found',
        pack: null,
        provenance: [],
        coverage: { covered: [], missing: [] },
        notes: [`资料采集失败，已跳过（fail-open）：${message}`],
      }];
    }
  }

  private async buildNormalizedGoalInput(input: GoalPathRequest, config: PathAgentInputConfig): Promise<PathGenerationInput> {
    const goalFinalPayload: GoalFinalPayload = {
      sourceConversationId: input.sourceConversationId,
      existingPathId: input.existingPathId,
      rawGoal: input.rawGoal,
      visibleSummary: input.visibleSummary || null,
      conversationHistory: input.conversationHistory || [],
      finalUserVisible: typeof input.finalUserVisible === 'string' ? input.finalUserVisible : null,
      // 用户侧补充说明（path 页面"补充说明重新生成"）
      adjustments: typeof input.adjustments === 'string' && input.adjustments.trim() ? input.adjustments.trim() : null,
      // 前置知识探测结果（goal 层 prerequisiteCheckResults 透传）
      prerequisiteCheckResults: input.prerequisiteCheckResults || null,
      // goal→path 配置式值流转（routings 表抽取；装配时优先于 visibleSummary）
      goalHandoffFields: input.goalHandoffFields || undefined,
    };

    const source = {
      rawGoal: goalFinalPayload.rawGoal,
      visibleSummary: goalFinalPayload.visibleSummary || null,
      understanding: {
        real_problem: goalFinalPayload.visibleSummary?.realProblem || null,
        surface_goal: goalFinalPayload.visibleSummary?.surfaceGoal || null,
        motivation: goalFinalPayload.visibleSummary?.motivation || null,
        urgency: goalFinalPayload.visibleSummary?.urgency || null,
        background_experience: goalFinalPayload.visibleSummary?.backgroundExperience || null,
        learning_signal: goalFinalPayload.visibleSummary?.learningSignal || null,
        pain_points: goalFinalPayload.visibleSummary?.painPoints || [],
        constraints_and_boundaries: goalFinalPayload.visibleSummary?.constraintsAndBoundaries || [],
        scenario: goalFinalPayload.visibleSummary?.scenario || null,
        current_pain_point: goalFinalPayload.visibleSummary?.currentPainPoint || null,
        // 用户侧补充说明：重规划时的最高优先级输入（用户明确说"哪里不合适"）
        adjustments: goalFinalPayload.adjustments,
        background: {
          current_level: goalFinalPayload.visibleSummary?.currentBaseline?.level || null,
          available_time: goalFinalPayload.visibleSummary?.resources?.timeBudget || null,
        },
        current_baseline: goalFinalPayload.visibleSummary?.currentBaseline || null,
        available_resources: {
          time_budget: goalFinalPayload.visibleSummary?.resources?.timeBudget || null,
          time_horizon: goalFinalPayload.visibleSummary?.resources?.timeHorizon || null,
          time_per_session: goalFinalPayload.visibleSummary?.resources?.timePerSession || null,
        },
        deadline_text: goalFinalPayload.visibleSummary?.resources?.deadlineText || null,
        success_criteria: {
          observable_result: goalFinalPayload.visibleSummary?.successCriteria?.observableResult || null,
          acceptance_check: goalFinalPayload.visibleSummary?.successCriteria?.acceptanceCheck || null,
        },
      },
      collected: {
        level: goalFinalPayload.visibleSummary?.currentBaseline?.level || null,
        timePerDay: goalFinalPayload.visibleSummary?.resources?.timeBudget || null,
      },
      conversationHistory: goalFinalPayload.conversationHistory || [],
    };

    const visibleSummary = goalFinalPayload.visibleSummary;
    const normalizedInputV1 = this.buildNormalizedInputV1(
      goalFinalPayload.goalHandoffFields || null,
      visibleSummary,
      goalFinalPayload.rawGoal,
      input.learnerLoadProfile ?? null
    );
    if (goalFinalPayload.prerequisiteCheckResults?.length) {
      normalizedInputV1.prerequisiteCheckResults = goalFinalPayload.prerequisiteCheckResults;
    }
    // 用户侧补充说明：core 规则要求消费 normalizedInput.understanding.adjustments，
    // 但 buildNormalizedInputV1 不产出 understanding ⇒ 该规则永无输入（审计 P1 §2.2a/§2.2c）。
    // 只补这一个键，不把整个 understanding 塞进 normalizedInput。
    if (goalFinalPayload.adjustments) {
      normalizedInputV1.understanding = {
        ...(normalizedInputV1.understanding || {}),
        adjustments: goalFinalPayload.adjustments,
      };
    }

    // goal→path 资料采集：goal 声明了 needsMaterial 才触发（缺省零调用）；采集失败 fail-open。
    // 来源优先配置式 handoff（若后续登记路由），否则 visibleSummary 白名单透传（understanding.needsMaterial）。
    const needsMaterial = (goalFinalPayload.goalHandoffFields as any)?.['understanding.needsMaterial']
      ?? (goalFinalPayload.goalHandoffFields as any)?.needsMaterial
      ?? (visibleSummary as any)?.needsMaterial
      ?? null;
    const materialPacks = [
      // 附件是主线：用户上传的资料优先进入路径（本地读盘，无网络、无 LLM）
      ...this.resolveUploadedMaterialPacks(input.userId),
      // 联网采集只用于补信息（goal 声明 needsMaterial 才触发）
      ...(await this.resolveMaterialPacks(needsMaterial) || []),
    ];

    // 单一挂载点：定帧层（buildFramedNormalizedInput）负责归一化与字段透传，
    // materials 由本处统一合入（附件在前、联网在后），下游 path-planning 按序消费。
    const framedNormalizedInput = buildFramedNormalizedInput(normalizedInputV1) || normalizedInputV1;
    if (materialPacks.length > 0 && framedNormalizedInput && typeof framedNormalizedInput === 'object') {
      framedNormalizedInput.resources = { ...(framedNormalizedInput.resources || {}), materials: materialPacks };
    }

    // L2 声明化装配（只读对账）：状态池形状由 sandbox-resolver 的 path provider 声明，
    // 本链只提供确定性定帧结果。缺键打 warn，不阻断。
    void (async () => {
      try {
        const { checkAgentSandboxRefsFromContext } = await import('../services/sandbox-resolver.service');
        await checkAgentSandboxRefsFromContext(
          'path-planning',
          'path',
          { normalizedInputV1 },
          { warnContext: { sourceConversationId: input.sourceConversationId || null } }
        );
      } catch {
        // 对账失败不影响主流程
      }
    })();

    const description = this.pickFirstDefined(source, config.normalizedInput.descriptionSources)
      || normalizedInputV1.problemSpace.realProblem
      || normalizedInputV1.learnerProfile.surfaceGoal
      || goalFinalPayload.rawGoal;
    const subject = this.pickFirstDefined(source, config.normalizedInput.subjectSources);
    const skillLevel = this.pickFirstDefined(source, config.normalizedInput.skillLevelSources)
      || normalizedInputV1.learnerProfile.currentBaseline.level
      || 'beginner';
    const availableTime = this.pickFirstDefined(source, config.normalizedInput.timePerDaySources)
      || normalizedInputV1.resources.timeBudget
      || normalizedInputV1.resources.timePerWeek
      || '1 小时';
    const deadlineRaw = this.pickFirstDefined(source, config.normalizedInput.deadlineTextSources);

    let deadline: Date | undefined;
    let deadlineText: string | undefined;

    if (deadlineRaw instanceof Date) {
      deadline = deadlineRaw;
    } else if (typeof deadlineRaw === 'string' && deadlineRaw.trim()) {
      if (/^\d{4}-\d{2}-\d{2}/.test(deadlineRaw)) {
        deadline = new Date(deadlineRaw);
      } else {
        const monthsMatch = deadlineRaw.match(/(\d+)\s*个月/);
        const weeksMatch = deadlineRaw.match(/(\d+)\s*周/);
        if (monthsMatch) {
          deadline = new Date();
          deadline.setMonth(deadline.getMonth() + parseInt(monthsMatch[1]));
        } else if (weeksMatch) {
          deadline = new Date();
          deadline.setDate(deadline.getDate() + parseInt(weeksMatch[1]) * 7);
        }
      }
      deadlineText = deadlineRaw;
    }

    return {
      source: input.source || 'goal',
      mode: input.mode || 'generate',
      userId: input.userId,
      sourceConversationId: input.sourceConversationId,
      existingPathId: input.existingPathId,
      generationRunId: input.generationRunId,
      createdPlaceholder: input.createdPlaceholder,
      description,
      subject: typeof subject === 'string' && subject.trim() ? subject.trim() : undefined,
      deadline,
      deadlineText,
      systemPromptOverrides: input.systemPromptOverrides,
      userProfile: {
        skillLevel,
        currentSkillLevel: skillLevel,
        timePerDay: availableTime,
        structuredData: input.structuredData || null,
        confirmedProposal: config.normalizedInput.includeConfirmedProposal ? input.visibleSummary?.confirmedProposal || null : null,
        confidenceScores: null,
        conversationHistory: config.normalizedInput.includeConversationHistory ? input.conversationHistory || [] : [],
        normalizedInput: framedNormalizedInput,
        goalFinalPayload: {
          source: 'goal',
          mode: 'generate',
          sourceConversationId: goalFinalPayload.sourceConversationId || null,
          existingPathId: goalFinalPayload.existingPathId || null,
          rawGoal: goalFinalPayload.rawGoal,
          finalUserVisible: goalFinalPayload.finalUserVisible || null,
          visibleSummary: goalFinalPayload.visibleSummary || null,
          conversationHistory: goalFinalPayload.conversationHistory || [],
          prerequisiteCheckResults: goalFinalPayload.prerequisiteCheckResults || null,
          // 持久化 handoff 字段，支持异步生成/重试/重生成时仍走配置式装配
          goalHandoffFields: goalFinalPayload.goalHandoffFields || null,
        },
      }
    };
  }

  async previewNormalizedGoalInput(input: GoalPathRequest): Promise<PathGenerationInput> {
    const config = await getPathAgentInputConfig();
    return this.buildNormalizedGoalInput(input, config);
  }

  private async normalizeGoalRequest(input: GoalPathRequest): Promise<PathGenerationInput> {
    const config = await getPathAgentInputConfig();
    return this.buildNormalizedGoalInput(input, config);
  }

  async generate(input: PathGenerationInput) {
    logger.info('[path-coordinator] generate start', {
      agentId: this.id,
      source: input.source || 'api',
      mode: input.mode || 'generate',
      userId: input.userId,
      existingPathId: input.existingPathId,
      subject: input.subject
    });

    const result = await learningService.generateLearningPath(input);

    logger.info('[path-coordinator] generate complete', {
      agentId: this.id,
      source: input.source || 'api',
      mode: input.mode || 'generate',
      userId: input.userId,
      existingPathId: input.existingPathId,
      pathId: result?.path?.id || result?.id || input.existingPathId
    });

    return result;
  }

  async generateFromGoal(input: GoalPathRequest) {
    return this.generate(await this.normalizeGoalRequest(input));
  }

  runAsync(
    input: PathGenerationInput,
    hooks?: {
      onSuccess?: () => Promise<void> | void;
      onError?: (error: unknown) => Promise<void> | void;
    }
  ): void {
    if (!backgroundTaskTracker.isAccepting()) {
      const error = new BackgroundTaskRejectedError('learning.path.async-generation');
      void Promise.resolve(hooks?.onError?.(error)).catch(hookError => {
        logger.error('[path-coordinator] async rejection hook failed', {
          userId: input.userId,
          existingPathId: input.existingPathId,
          error: hookError instanceof Error ? hookError.message : String(hookError)
        });
      });
      return;
    }
    runBackgroundTask('learning.path.async-generation', async () => {
      try {
        await this.generate(input);
        logger.info('[path-coordinator] async complete', {
          agentId: this.id,
          userId: input.userId,
          existingPathId: input.existingPathId
        });
        await hooks?.onSuccess?.();
      } catch (error) {
        logger.error('[path-coordinator] async failed', {
          agentId: this.id,
          userId: input.userId,
          existingPathId: input.existingPathId,
          error: error instanceof Error ? error.message : String(error)
        });
        try {
          await hooks?.onError?.(error);
        } catch (hookError) {
          logger.error('[path-coordinator] async error hook failed', {
            agentId: this.id,
            userId: input.userId,
            existingPathId: input.existingPathId,
            error: hookError instanceof Error ? hookError.message : String(hookError)
          });
        }
        throw error;
      }
    }, { userId: input.userId, existingPathId: input.existingPathId });
  }

  runGoalAsync(
    input: GoalPathRequest,
    hooks?: {
      onSuccess?: () => Promise<void> | void;
      onError?: (error: unknown) => Promise<void> | void;
    }
  ): void {
    if (!backgroundTaskTracker.isAccepting()) {
      const error = new BackgroundTaskRejectedError('learning.path.goal-generation');
      void Promise.resolve(hooks?.onError?.(error)).catch(hookError => {
        logger.error('[path-coordinator] goal rejection hook failed', {
          userId: input.userId,
          existingPathId: input.existingPathId,
          error: hookError instanceof Error ? hookError.message : String(hookError)
        });
      });
      return;
    }
    runBackgroundTask('learning.path.goal-generation', async () => {
      try {
        const normalizedInput = await this.normalizeGoalRequest(input);
        await this.generate(normalizedInput);
        await hooks?.onSuccess?.();
      } catch (error) {
        logger.error('[path-coordinator] normalize goal request failed', {
          agentId: this.id,
          userId: input.userId,
          existingPathId: input.existingPathId,
          error: error instanceof Error ? error.message : String(error)
        });
        try {
          await hooks?.onError?.(error);
        } catch (hookError) {
          logger.error('[path-coordinator] goal error hook failed', {
            agentId: this.id,
            userId: input.userId,
            existingPathId: input.existingPathId,
            error: hookError instanceof Error ? hookError.message : String(hookError)
          });
        }
        throw error;
      }
    }, { userId: input.userId, existingPathId: input.existingPathId });
  }
}

export const pathCoordinator = new PathCoordinator();
export default pathCoordinator;


import { logger } from '../utils/logger';
import {
  BackgroundTaskRejectedError,
  backgroundTaskTracker,
  runBackgroundTask
} from '../services/background-task-tracker.service';
import learningService from '../services/learning/learning.service';
import { buildFramedNormalizedInput } from '../services/learning/path-planning-hints';
import {
  getPathAgentInputConfig,
  type PathAgentInputConfig
} from '../services/agentConfig.service';
import type { GoalPathTimeBudgetCadence, GoalPathVisibleSummary } from '../services/learning/goal-path-visible-summary';

const COORDINATOR_ID = 'path-agent';

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
    rawGoal: string | null | undefined
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
      } : null,
      timeDimensions: visibleSummary?.timeDimensions ?? null,
    };
  }
  private buildNormalizedGoalInput(input: GoalPathRequest, config: PathAgentInputConfig): PathGenerationInput {
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
      goalFinalPayload.rawGoal
    );
    if (goalFinalPayload.prerequisiteCheckResults?.length) {
      normalizedInputV1.prerequisiteCheckResults = goalFinalPayload.prerequisiteCheckResults;
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
        normalizedInput: buildFramedNormalizedInput(normalizedInputV1) || normalizedInputV1,
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


import { logger } from '../utils/logger';
import learningService from '../services/learning/learning.service';
import {
  getPathOrchestratorInputConfig,
  type PathOrchestratorInputConfig
} from '../services/orchestratorConfig.service';
import type { GoalPathTimeBudgetCadence, GoalPathVisibleSummary } from '../services/learning/goal-path-visible-summary';

const ORCHESTRATOR_ID = 'path-orchestrator';

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
  userProfile?: any;
}

interface GoalFinalPayload {
  sourceConversationId?: string;
  existingPathId?: string;
  rawGoal: string;
  visibleSummary?: GoalPathVisibleSummary | null;
  conversationHistory?: Array<{ role: string; content: string }>;
  finalUserVisible?: string | null;
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
}

export interface GoalPathRequest {
  userId: string;
  sourceConversationId?: string;
  existingPathId?: string;
  source?: 'goal';
  mode?: 'generate';
  rawGoal: string;
  visibleSummary?: GoalFinalPayload['visibleSummary'];
  conversationHistory?: Array<{ role: string; content: string }>;
  finalUserVisible?: string;
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

class PathOrchestrator {
  readonly id = ORCHESTRATOR_ID;

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

  private buildNormalizedGoalInput(input: GoalPathRequest, config: PathOrchestratorInputConfig): PathGenerationInput {
    const goalFinalPayload: GoalFinalPayload = {
      sourceConversationId: input.sourceConversationId,
      existingPathId: input.existingPathId,
      rawGoal: input.rawGoal,
      visibleSummary: input.visibleSummary || null,
      conversationHistory: input.conversationHistory || [],
      finalUserVisible: typeof input.finalUserVisible === 'string' ? input.finalUserVisible : null,
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
    const normalizedInputV1: NormalizedPathInputV1 = {
      version: '1.0',
      learnerProfile: {
        surfaceGoal: this.normalizeString(visibleSummary?.surfaceGoal) || this.normalizeString(goalFinalPayload.rawGoal),
        currentBaseline: {
          level: this.normalizeString(visibleSummary?.currentBaseline?.level),
          evidence: this.normalizeString(visibleSummary?.currentBaseline?.evidence),
        },
        motivation: this.normalizeString(visibleSummary?.motivation),
        urgency: this.normalizeString(visibleSummary?.urgency),
        backgroundExperience: this.normalizeString(visibleSummary?.backgroundExperience),
        painPoints: this.normalizeStringArray(visibleSummary?.painPoints),
        learningSignal: this.normalizeString(visibleSummary?.learningSignal),
        constraintsAndBoundaries: this.normalizeStringArray(visibleSummary?.constraintsAndBoundaries),
      },
      problemSpace: {
        realProblem: this.normalizeString(visibleSummary?.realProblem),
        scenario: this.normalizeString(visibleSummary?.scenario),
        currentPainPoint: this.normalizeString(visibleSummary?.currentPainPoint),
      },
      resources: {
        timeBudget: this.normalizeString(visibleSummary?.resources?.timeBudget) || this.normalizeString(visibleSummary?.resources?.timePerWeek),
        timeBudgetCadence: this.normalizeCadence(visibleSummary?.resources?.timeBudgetCadence),
        timePerWeek: this.normalizeString(visibleSummary?.resources?.timePerWeek),
        timePerSession: this.normalizeString(visibleSummary?.resources?.timePerSession),
        timeHorizon: this.normalizeString(visibleSummary?.resources?.timeHorizon),
        deadlineText: this.normalizeString(visibleSummary?.resources?.deadlineText),
      },
      successCriteria: {
        observableResult: this.normalizeString(visibleSummary?.successCriteria?.observableResult),
        acceptanceCheck: this.normalizeString(visibleSummary?.successCriteria?.acceptanceCheck),
      },
      confirmedProposal: visibleSummary?.confirmedProposal ? {
        learningDirection: this.normalizeString(visibleSummary.confirmedProposal.learningDirection),
        firstDeliverable: this.normalizeString(visibleSummary.confirmedProposal.firstDeliverable),
        keyStages: this.normalizeStringArray(visibleSummary.confirmedProposal.keyStages),
        outOfScope: this.normalizeStringArray(visibleSummary.confirmedProposal.outOfScope),
      } : null,
    };

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
        const monthsMatch = deadlineRaw.match(/(\d+)\s*个？月/);
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
      description,
      subject: typeof subject === 'string' && subject.trim() ? subject.trim() : undefined,
      deadline,
      deadlineText,
      userProfile: {
        skillLevel,
        currentSkillLevel: skillLevel,
        timePerDay: availableTime,
        structuredData: null,
        confirmedProposal: config.normalizedInput.includeConfirmedProposal ? input.visibleSummary?.confirmedProposal || null : null,
        confidenceScores: null,
        conversationHistory: config.normalizedInput.includeConversationHistory ? input.conversationHistory || [] : [],
        normalizedInput: normalizedInputV1,
        goalFinalPayload: {
          source: 'goal',
          mode: 'generate',
          sourceConversationId: goalFinalPayload.sourceConversationId || null,
          existingPathId: goalFinalPayload.existingPathId || null,
          rawGoal: goalFinalPayload.rawGoal,
          finalUserVisible: goalFinalPayload.finalUserVisible || null,
          visibleSummary: goalFinalPayload.visibleSummary || null,
          conversationHistory: goalFinalPayload.conversationHistory || [],
        },
      }
    };
  }

  async previewNormalizedGoalInput(input: GoalPathRequest): Promise<PathGenerationInput> {
    const config = await getPathOrchestratorInputConfig();
    return this.buildNormalizedGoalInput(input, config);
  }

  private async normalizeGoalRequest(input: GoalPathRequest): Promise<PathGenerationInput> {
    const config = await getPathOrchestratorInputConfig();
    return this.buildNormalizedGoalInput(input, config);
  }

  async generate(input: PathGenerationInput) {
    logger.info('[path-orchestrator] generate start', {
      orchestratorId: this.id,
      source: input.source || 'api',
      mode: input.mode || 'generate',
      userId: input.userId,
      existingPathId: input.existingPathId,
      subject: input.subject
    });

    const result = await learningService.generateLearningPath(input);

    logger.info('[path-orchestrator] generate complete', {
      orchestratorId: this.id,
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
    this.generate(input)
      .then(() => {
        logger.info('[path-orchestrator] async complete', {
          orchestratorId: this.id,
          userId: input.userId,
          existingPathId: input.existingPathId
        });
        if (hooks?.onSuccess) {
          return hooks.onSuccess();
        }
      })
      .catch((error) => {
        logger.error('[path-orchestrator] async failed', {
          orchestratorId: this.id,
          userId: input.userId,
          existingPathId: input.existingPathId,
          error: error instanceof Error ? error.message : String(error)
        });
        if (hooks?.onError) {
          return hooks.onError(error);
        }
      });
  }

  runGoalAsync(
    input: GoalPathRequest,
    hooks?: {
      onSuccess?: () => Promise<void> | void;
      onError?: (error: unknown) => Promise<void> | void;
    }
  ): void {
    this.normalizeGoalRequest(input)
      .then((normalizedInput) => {
        this.runAsync(normalizedInput, hooks);
      })
      .catch((error) => {
        logger.error('[path-orchestrator] normalize goal request failed', {
          orchestratorId: this.id,
          userId: input.userId,
          existingPathId: input.existingPathId,
          error: error instanceof Error ? error.message : String(error)
        });
        if (hooks?.onError) {
          void hooks.onError(error);
        }
      });
  }
}

export const pathOrchestrator = new PathOrchestrator();
export default pathOrchestrator;

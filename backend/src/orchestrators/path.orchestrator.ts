import { logger } from '../utils/logger';
import learningService from '../services/learning/learning.service';
import {
  getPathOrchestratorInputConfig,
  type PathOrchestratorInputConfig
} from '../services/orchestratorConfig.service';

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
  understanding?: any;
  collected?: any;
  structuredData?: any;
  confirmedProposal?: any;
  confidenceScores?: any;
  conversationHistory?: Array<{ role: string; content: string }>;
  finalUserVisible?: string;
  stage?: string;
  confidence?: number;
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
    painPoints: string[];
    learningSignal: string | null;
  };
  problemSpace: {
    realProblem: string | null;
    scenario: string | null;
    currentPainPoint: string | null;
  };
  resources: {
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
  understanding?: any;
  collected?: any;
  structuredData?: any;
  confirmedProposal?: any;
  confidenceScores?: any;
  normalizedGoalState?: any;
  conversationHistory?: Array<{ role: string; content: string }>;
  finalUserVisible?: string;
  stage?: string;
  confidence?: number;
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

  private buildStructuredNormalizedInput(goalFinalPayload: GoalFinalPayload): {
    normalizedInputV1: NormalizedPathInputV1;
  } {
    const understanding = goalFinalPayload.understanding && typeof goalFinalPayload.understanding === 'object'
      ? goalFinalPayload.understanding
      : {};
    const structuredData = goalFinalPayload.structuredData && typeof goalFinalPayload.structuredData === 'object'
      ? goalFinalPayload.structuredData
      : {};
    const confirmedProposal = goalFinalPayload.confirmedProposal && typeof goalFinalPayload.confirmedProposal === 'object'
      ? goalFinalPayload.confirmedProposal
      : null;

    const normalizedInputV1Base: NormalizedPathInputV1 = {
      version: '1.0',
      learnerProfile: {
        surfaceGoal: this.normalizeString(understanding.surface_goal) || this.normalizeString(goalFinalPayload.rawGoal),
        currentBaseline: {
          level: this.normalizeString(understanding.current_baseline?.level) || this.normalizeString(understanding.background?.current_level),
          evidence: this.normalizeString(understanding.current_baseline?.evidence),
        },
        motivation: this.normalizeString(understanding.motivation),
        urgency: this.normalizeString(understanding.urgency),
        painPoints: this.normalizeStringArray(understanding.pain_points),
        learningSignal: this.normalizeString(understanding.learning_signal),
      },
      problemSpace: {
        realProblem: this.normalizeString(understanding.real_problem),
        scenario: this.normalizeString(structuredData.subject) || this.normalizeString(goalFinalPayload.collected?.subject),
        currentPainPoint: this.normalizeStringArray(understanding.pain_points)[0] || null,
      },
      resources: {
        timePerWeek: this.normalizeString(understanding.available_resources?.time_budget) || this.normalizeString(understanding.background?.available_time),
        timePerSession: this.normalizeString(goalFinalPayload.collected?.timePerDay),
        timeHorizon: this.normalizeString(understanding.available_resources?.time_horizon) || this.normalizeString(understanding.deadline_text),
        deadlineText: this.normalizeString(understanding.deadline_text),
      },
      successCriteria: {
        observableResult: this.normalizeString(understanding.success_criteria?.observable_result),
        acceptanceCheck: this.normalizeString(understanding.success_criteria?.acceptance_check),
      },
      confirmedProposal: confirmedProposal ? {
        learningDirection: this.normalizeString(confirmedProposal.learning_direction),
        firstDeliverable: this.normalizeString(confirmedProposal.first_deliverable),
        keyStages: this.normalizeStringArray(confirmedProposal.key_stages),
        outOfScope: this.normalizeStringArray(confirmedProposal.out_of_scope),
      } : null,
    };

    return {
      normalizedInputV1: normalizedInputV1Base,
    };
  }

  private buildNormalizedGoalInput(input: GoalPathRequest, config: PathOrchestratorInputConfig): PathGenerationInput {
    const goalFinalPayload: GoalFinalPayload = {
      sourceConversationId: input.sourceConversationId,
      existingPathId: input.existingPathId,
      rawGoal: input.rawGoal,
      understanding: input.understanding || {},
      collected: input.collected || {},
      structuredData: input.structuredData || null,
      confirmedProposal: input.confirmedProposal || null,
      confidenceScores: input.confidenceScores || null,
      conversationHistory: input.conversationHistory || [],
      finalUserVisible: typeof input.finalUserVisible === 'string' ? input.finalUserVisible : null,
      stage: typeof input.stage === 'string' ? input.stage : null,
      confidence: typeof input.confidence === 'number' ? input.confidence : null,
    };

    const source = {
      rawGoal: goalFinalPayload.rawGoal,
      understanding: goalFinalPayload.understanding || {},
      collected: goalFinalPayload.collected || {},
      structuredData: goalFinalPayload.structuredData || null,
      confirmedProposal: goalFinalPayload.confirmedProposal || null,
      confidenceScores: goalFinalPayload.confidenceScores || null,
      conversationHistory: goalFinalPayload.conversationHistory || [],
    };

    const { normalizedInputV1 } = this.buildStructuredNormalizedInput(goalFinalPayload);

    const description = this.pickFirstDefined(source, config.normalizedInput.descriptionSources)
      || normalizedInputV1.problemSpace.realProblem
      || normalizedInputV1.learnerProfile.surfaceGoal
      || goalFinalPayload.rawGoal;
    const subject = this.pickFirstDefined(source, config.normalizedInput.subjectSources);
    const skillLevel = this.pickFirstDefined(source, config.normalizedInput.skillLevelSources)
      || normalizedInputV1.learnerProfile.currentBaseline.level
      || 'beginner';
    const availableTime = this.pickFirstDefined(source, config.normalizedInput.timePerDaySources)
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
        structuredData: config.normalizedInput.includeStructuredData ? input.structuredData || null : null,
        confirmedProposal: config.normalizedInput.includeConfirmedProposal ? input.confirmedProposal || null : null,
        confidenceScores: config.normalizedInput.includeConfidenceScores ? input.confidenceScores || null : null,
        conversationHistory: config.normalizedInput.includeConversationHistory ? input.conversationHistory || [] : [],
        normalizedInput: normalizedInputV1,
        goalFinalPayload: {
          source: 'goal',
          mode: 'generate',
          sourceConversationId: goalFinalPayload.sourceConversationId || null,
          existingPathId: goalFinalPayload.existingPathId || null,
          rawGoal: goalFinalPayload.rawGoal,
          finalUserVisible: goalFinalPayload.finalUserVisible || null,
          stage: goalFinalPayload.stage || null,
          confidence: goalFinalPayload.confidence ?? null,
          understanding: goalFinalPayload.understanding || {},
          collected: goalFinalPayload.collected || {},
          structuredData: goalFinalPayload.structuredData || null,
          confirmedProposal: goalFinalPayload.confirmedProposal || null,
          confidenceScores: goalFinalPayload.confidenceScores || null,
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

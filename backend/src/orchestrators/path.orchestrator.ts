import { logger } from '../utils/logger';
import learningService from '../services/learning/learning.service';

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

export interface GoalPathRequest {
  userId: string;
  sourceConversationId?: string;
  existingPathId?: string;
  source?: 'goal';
  mode?: 'generate';
  rawGoal: string;
  understanding?: any;
  structuredData?: any;
  confirmedProposal?: any;
  confidenceScores?: any;
  conversationHistory?: Array<{ role: string; content: string }>;
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

  private normalizeGoalRequest(input: GoalPathRequest): PathGenerationInput {
    const understanding = input.understanding || {};
    const currentBaseline = understanding.background || {};
    const realGoal = understanding.real_problem || input.rawGoal;
    const skillLevel = currentBaseline.current_level || 'beginner';
    const availableTime = currentBaseline.available_time || '1 小时';

    let deadline: Date | undefined;
    let deadlineText: string | undefined;
    const deadlineRaw = currentBaseline.deadline || understanding.deadline_text || currentBaseline.deadline_text;

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
      description: realGoal,
      deadline,
      deadlineText,
      userProfile: {
        skillLevel,
        currentSkillLevel: skillLevel,
        timePerDay: availableTime,
        structuredData: input.structuredData || null,
        confirmedProposal: input.confirmedProposal || null,
        confidenceScores: input.confidenceScores || null,
        conversationHistory: input.conversationHistory || [],
      }
    };
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
    return this.generate(this.normalizeGoalRequest(input));
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
    this.runAsync(this.normalizeGoalRequest(input), hooks);
  }
}

export const pathOrchestrator = new PathOrchestrator();
export default pathOrchestrator;

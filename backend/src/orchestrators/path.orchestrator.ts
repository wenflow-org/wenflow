import { logger } from '../utils/logger';
import learningService from '../services/learning/learning.service';

const ORCHESTRATOR_ID = 'path-orchestrator';

export interface PathGenerationInput {
  userId: string;
  description: string;
  subject?: string;
  deadline?: Date;
  deadlineText?: string;
  sourceConversationId?: string;
  existingPathId?: string;
  userProfile?: any;
}

class PathOrchestrator {
  readonly id = ORCHESTRATOR_ID;

  async generate(input: PathGenerationInput) {
    logger.info('[path-orchestrator] generate start', {
      orchestratorId: this.id,
      userId: input.userId,
      existingPathId: input.existingPathId,
      subject: input.subject
    });

    const result = await learningService.generateLearningPath(input);

    logger.info('[path-orchestrator] generate complete', {
      orchestratorId: this.id,
      userId: input.userId,
      existingPathId: input.existingPathId,
      pathId: result?.path?.id || result?.id || input.existingPathId
    });

    return result;
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
}

export const pathOrchestrator = new PathOrchestrator();
export default pathOrchestrator;

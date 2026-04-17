import { logger } from '../utils/logger';
import goalConversationService from '../services/learning/goal-conversation.service';

const ORCHESTRATOR_ID = 'requirement-orchestrator';

class RequirementOrchestrator {
  readonly id = ORCHESTRATOR_ID;

  async start(userId: string, goal: string) {
    logger.info('[requirement-orchestrator] start', {
      orchestratorId: this.id,
      userId,
      goalPreview: goal.slice(0, 120)
    });
    return goalConversationService.startConversation(userId, goal);
  }

  async step(conversationId: string, reply: string, userId: string) {
    logger.info('[requirement-orchestrator] step', {
      orchestratorId: this.id,
      userId,
      conversationId,
      replyPreview: reply.slice(0, 120)
    });
    return goalConversationService.continueConversation(conversationId, reply, userId);
  }

  async regenerate(conversationId: string, userId: string, adjustments?: string) {
    logger.info('[requirement-orchestrator] regenerate', {
      orchestratorId: this.id,
      userId,
      conversationId,
      hasAdjustments: Boolean(adjustments?.trim())
    });
    return goalConversationService.regeneratePath(conversationId, userId, adjustments);
  }

  async reset(conversationId: string, userId: string) {
    logger.info('[requirement-orchestrator] reset', {
      orchestratorId: this.id,
      userId,
      conversationId
    });
    return goalConversationService.deleteConversation(conversationId, userId);
  }

  async getConversation(conversationId: string, userId: string) {
    return goalConversationService.getConversation(conversationId, userId);
  }

  async quickGenerate(userId: string, params: { goal: string; level?: string; timePerDay?: string; learningStyle?: string; }) {
    logger.info('[requirement-orchestrator] quick-generate', {
      orchestratorId: this.id,
      userId,
      goalPreview: params.goal.slice(0, 120)
    });
    return goalConversationService.quickGeneratePath(userId, {
      goal: params.goal,
      level: params.level || 'beginner',
      timePerDay: params.timePerDay || '1 小时',
      learningStyle: params.learningStyle || 'mixed'
    });
  }
}

export const requirementOrchestrator = new RequirementOrchestrator();
export default requirementOrchestrator;

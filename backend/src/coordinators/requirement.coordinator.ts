import { logger } from '../utils/logger';
import goalConversationService from '../services/learning/goal-conversation.service';

const COORDINATOR_ID = 'goal-agent';

class RequirementCoordinator {
  readonly id = COORDINATOR_ID;

  async start(userId: string, goal: string, options?: { contextMode?: 'recent' | 'full' }) {
    logger.info('[requirement-coordinator] start', {
      agentId: this.id,
      userId,
      goalPreview: goal.slice(0, 120),
      contextMode: options?.contextMode || 'recent'
    });
    return goalConversationService.startConversation(userId, goal, options);
  }

  async step(conversationId: string, reply: string, userId: string, options?: { contextMode?: 'recent' | 'full'; confirmProposal?: boolean }) {
    logger.info('[requirement-coordinator] step', {
      agentId: this.id,
      userId,
      conversationId,
      replyPreview: reply.slice(0, 120),
      contextMode: options?.contextMode || 'recent'
    });
    return goalConversationService.continueConversation(conversationId, reply, userId, options);
  }

  async regenerate(conversationId: string, userId: string, adjustments?: string) {
    logger.info('[requirement-coordinator] regenerate', {
      agentId: this.id,
      userId,
      conversationId,
      hasAdjustments: Boolean(adjustments?.trim())
    });
    return goalConversationService.regeneratePath(conversationId, userId, adjustments);
  }

  async reset(conversationId: string, userId: string) {
    logger.info('[requirement-coordinator] reset', {
      agentId: this.id,
      userId,
      conversationId
    });
    return goalConversationService.deleteConversation(conversationId, userId);
  }

  async getConversation(conversationId: string, userId: string) {
    return goalConversationService.getConversation(conversationId, userId);
  }

  async quickGenerate(userId: string, params: { goal: string; level?: string; timePerDay?: string; learningStyle?: string; }) {
    logger.info('[requirement-coordinator] quick-generate', {
      agentId: this.id,
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

export const requirementCoordinator = new RequirementCoordinator();
export default requirementCoordinator;

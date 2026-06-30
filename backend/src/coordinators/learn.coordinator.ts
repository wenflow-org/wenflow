import { logger } from '../utils/logger';
import AITeachingCoordinator from '../services/ai-teaching/AITeachingCoordinator';
import type { TeachingSessionStartInput } from '../services/ai-teaching/AITeachingCoordinator';

/**
 * Learn 阶段协调器（薄壳）
 * ============================================================
 * 与 requirement.coordinator / path.coordinator 同构：为 Learn（授课执行）
 * 阶段提供一个与其它阶段一致的入口对象。
 *
 * id 对齐 agent-manifest.service.ts 的 canonical id：'teaching-agent'
 * coordinatorMembers: skill:teaching-turn / skill:peer-reinforcement / skill:session-wrapup
 *
 * 真实授课逻辑仍由 services/ai-teaching/AITeachingCoordinator 承载（含上下文构建、
 * 知识状态、伴学触发、replan advisory 等），本壳仅做封装 + 统一日志，不重写逻辑。
 */

const COORDINATOR_ID = 'teaching-agent';

class LearnCoordinator {
  readonly id = COORDINATOR_ID;

  async startSession(input: TeachingSessionStartInput) {
    logger.info('[learn-coordinator] start-session', {
      agentId: this.id,
      userId: input.userId,
      taskId: input.taskId,
      forceNew: input.forceNew ?? false,
    });
    return AITeachingCoordinator.startSession(input);
  }

  async processStudentMessage(sessionId: string, message: string) {
    logger.info('[learn-coordinator] teaching-turn', {
      agentId: this.id,
      sessionId,
      messagePreview: message.slice(0, 120),
    });
    return AITeachingCoordinator.processStudentMessage(sessionId, message);
  }

  async triggerPeerSupport(sessionId: string, message: string) {
    logger.info('[learn-coordinator] peer-support', {
      agentId: this.id,
      sessionId,
      messagePreview: message.slice(0, 120),
    });
    return AITeachingCoordinator.processPeerMessage(sessionId, message);
  }

  async completeSession(sessionId: string) {
    logger.info('[learn-coordinator] session-wrapup', {
      agentId: this.id,
      sessionId,
    });
    return AITeachingCoordinator.endSession(sessionId);
  }
}

export const learnCoordinator = new LearnCoordinator();
export default learnCoordinator;


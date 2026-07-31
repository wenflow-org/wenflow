import type { LearningTurnOutput } from '../../skills/learning-turn';
import type { TeachingSessionRecord } from './TeachingSessionRepository';
import { peerTriggerConfig } from '../../config/pedagogy.config';
import { logger } from '../../utils/logger';

export type PeerTriggerReason = 'model-control' | 'help-keyword' | 'low-understanding-window';

export class PeerTriggerService {
  shouldTrigger(
    session: TeachingSessionRecord,
    teachingOutput: LearningTurnOutput,
    studentMessage: string
  ): boolean {
    const reason = this.evaluate(session, teachingOutput, studentMessage);
    if (reason) {
      // peer 触发率量测埋点：分母为 learning-turn skill span（agent_call_logs），
      // 收集一段时间后据此评估是否值得把 peer 文本并入 learning-turn 单次输出。
      logger.info('[peer-trigger] fired', {
        reason,
        sessionId: session.id,
        understanding: teachingOutput.analysis?.understanding ?? null,
      });
      return true;
    }
    return false;
  }

  private evaluate(
    session: TeachingSessionRecord,
    teachingOutput: LearningTurnOutput,
    studentMessage: string
  ): PeerTriggerReason | null {
    if (teachingOutput.control.shouldTriggerPeer) {
      return 'model-control';
    }

    if (peerTriggerConfig.helpKeywords.some((keyword) => studentMessage.includes(keyword))) {
      return 'help-keyword';
    }

    const windowSize = peerTriggerConfig.analysisWindowSize;
    const recentAnalyses = session.messages
      .filter((message) => message.role === 'assistant' && message.analysis)
      .slice(-windowSize)
      .map((message) => message.analysis as any);

    if (recentAnalyses.length >= windowSize) {
      const avgUnderstanding = recentAnalyses.reduce((sum, item) => sum + (item.understanding || 0), 0) / recentAnalyses.length;
      if (avgUnderstanding < peerTriggerConfig.understandingThreshold && teachingOutput.analysis.understanding < peerTriggerConfig.understandingThreshold) {
        return 'low-understanding-window';
      }
    }

    return null;
  }
}

export const peerTriggerService = new PeerTriggerService();

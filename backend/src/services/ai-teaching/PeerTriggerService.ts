import type { TeachingTurnOutput } from '../../skills/teaching-turn';
import type { TeachingSessionRecord } from './TeachingSessionRepository';
import { peerTriggerConfig } from '../../config/pedagogy.config';
import { logger } from '../../utils/logger';

export type PeerTriggerReason = 'model-control' | 'help-keyword' | 'low-understanding-window';

export class PeerTriggerService {
  shouldTrigger(
    session: TeachingSessionRecord,
    teachingOutput: TeachingTurnOutput,
    studentMessage: string
  ): boolean {
    const reason = this.evaluate(session, teachingOutput, studentMessage);
    if (reason) {
      // peer 触发率量测埋点：分母为 teaching-turn skill span（agent_call_logs），
      // 收集一段时间后据此评估是否值得把 peer 文本并入 teaching-turn 单次输出。
      logger.debug('[peer-trigger] fired', {
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
    teachingOutput: TeachingTurnOutput,
    studentMessage: string
  ): PeerTriggerReason | null {
    if (teachingOutput.control.shouldTriggerPeer) {
      return 'model-control';
    }

    // 会话内冷却：紧邻几轮老师消息刚带过伴学插话 → 本轮不再自动触发（给学生的作答和老师的推进留空档，
    // 2026-09-25 真课实测"怎么/为什么"逢问必弹、两轮两弹）。model-control 不受冷却限制——那是教学模型本轮的显式要求。
    if (this.isInCooldown(session)) {
      return null;
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

  /** 最近 cooldownAssistantTurns 条助手消息里是否已有伴学插话（peerMessage 内嵌于老师消息）。 */
  private isInCooldown(session: TeachingSessionRecord): boolean {
    const window = Math.max(1, peerTriggerConfig.cooldownAssistantTurns ?? 2);
    const recentAssistant = session.messages
      .filter((message) => message.role === 'assistant')
      .slice(-window);
    return recentAssistant.some((message) => Boolean((message as any).peerMessage));
  }
}

export const peerTriggerService = new PeerTriggerService();

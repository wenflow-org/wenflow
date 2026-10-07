import type { TeachingTurnOutput } from '../../skills/teaching-turn';
import type { TeachingSessionRecord } from './TeachingSessionRepository';
import {
  peerTriggerConfig,
  hasHelpSignal,
  detectAwaitingLearnerWork,
} from '../../config/pedagogy.config';
import { logger } from '../../utils/logger';

export type PeerTriggerReason = 'model-control' | 'help-keyword' | 'low-understanding-window';

/** 复出口（供 engine 的 retryStrategy/策略层与单测共用同一判据源；判据实现在 config/pedagogy.config.ts）。 */
export { hasHelpSignal, detectAwaitingLearnerWork };

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

    // 等待作答态（P1-14 修复②）：老师本轮正在布置独立作业/等学生自己作答时，自动触发一律让路——
    // 学生尚未作答，此时递出的"类比/反例/边界追问"就是解题钥匙（生产实证：独立证明题被递关键步骤）。
    // model-control 不受限（上方已返回）：那是教学模型本轮的显式要求，与冷却口径一致。
    const awaiting = detectAwaitingLearnerWork(teachingOutput.reply);
    if (awaiting.awaiting) {
      logger.debug('[peer-trigger] suppressed: awaiting-learner-work', {
        reason: awaiting.reason,
        sessionId: session.id,
      });
      return null;
    }

    // 关键词路径（P1-14 修复①）：词边界/语境判据，反问语气的嵌套子串不命中。
    if (hasHelpSignal(studentMessage)) {
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

import type { TeachingTurnOutput } from '../../agents/teaching-turn-agent';
import type { TeachingSessionRecord } from './TeachingSessionRepository';

export class PeerTriggerService {
  shouldTrigger(
    session: TeachingSessionRecord,
    teachingOutput: TeachingTurnOutput,
    studentMessage: string
  ): boolean {
    if (teachingOutput.control.shouldTriggerPeer) {
      return true;
    }

    const helpKeywords = ['不懂', '不会', '为什么', '怎么', '帮助', '不明白', '搞不懂'];
    if (helpKeywords.some((keyword) => studentMessage.includes(keyword))) {
      return true;
    }

    const recentAnalyses = session.messages
      .filter((message) => message.role === 'assistant' && message.analysis)
      .slice(-2)
      .map((message) => message.analysis as any);

    if (recentAnalyses.length >= 2) {
      const avgUnderstanding = recentAnalyses.reduce((sum, item) => sum + (item.understanding || 0), 0) / recentAnalyses.length;
      if (avgUnderstanding < 0.4 && teachingOutput.analysis.understanding < 0.4) {
        return true;
      }
    }

    return false;
  }
}

export const peerTriggerService = new PeerTriggerService();

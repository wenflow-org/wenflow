import type { TeachingTurnOutput } from '../../skills/teaching-turn';
import type { TeachingSessionRecord } from './TeachingSessionRepository';
import { peerTriggerConfig } from '../../config/pedagogy.config';

export class PeerTriggerService {
  shouldTrigger(
    session: TeachingSessionRecord,
    teachingOutput: TeachingTurnOutput,
    studentMessage: string
  ): boolean {
    if (teachingOutput.control.shouldTriggerPeer) {
      return true;
    }

    if (peerTriggerConfig.helpKeywords.some((keyword) => studentMessage.includes(keyword))) {
      return true;
    }

    const windowSize = peerTriggerConfig.analysisWindowSize;
    const recentAnalyses = session.messages
      .filter((message) => message.role === 'assistant' && message.analysis)
      .slice(-windowSize)
      .map((message) => message.analysis as any);

    if (recentAnalyses.length >= windowSize) {
      const avgUnderstanding = recentAnalyses.reduce((sum, item) => sum + (item.understanding || 0), 0) / recentAnalyses.length;
      if (avgUnderstanding < peerTriggerConfig.understandingThreshold && teachingOutput.analysis.understanding < peerTriggerConfig.understandingThreshold) {
        return true;
      }
    }

    return false;
  }
}

export const peerTriggerService = new PeerTriggerService();

import { profileAggregator } from '../../agents/learner-model-agent/profile-aggregator';
import type { LearnerModelProfile } from '../../agents/learner-model-agent/types';

export class LearnerProfileService {
  private cache = new Map<string, { profile: LearnerModelProfile; confidence: number; timestamp: number }>();
  private readonly cacheTtlMs = 5 * 60 * 1000;

  async getProfile(userId: string): Promise<{ profile: LearnerModelProfile; confidence: number }> {
    const cached = this.cache.get(userId);
    if (cached && Date.now() - cached.timestamp < this.cacheTtlMs) {
      return { profile: cached.profile, confidence: cached.confidence };
    }

    const result = await profileAggregator.aggregateProfile(userId);
    this.cache.set(userId, {
      profile: result.profile,
      confidence: result.confidence,
      timestamp: Date.now()
    });
    return { profile: result.profile, confidence: result.confidence };
  }

  clear(userId?: string): void {
    if (userId) this.cache.delete(userId);
    else this.cache.clear();
  }
}

export const learnerProfileService = new LearnerProfileService();

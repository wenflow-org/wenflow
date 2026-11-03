import { profileAggregator } from '../../agents/learner-model-agent/profile-aggregator';
import type { LearnerModelProfile, ProfileFieldSources } from '../../agents/learner-model-agent/types';

export class LearnerProfileService {
  private cache = new Map<string, {
    profile: LearnerModelProfile;
    confidence: number;
    sources: ProfileFieldSources;
    timestamp: number;
  }>();
  private readonly cacheTtlMs = 5 * 60 * 1000;

  /** sources 与 profile 一同缓存：画像页要逐格区分「实测」与「初始默认值」，两者必须同一份聚合结果 */
  async getProfile(userId: string): Promise<{
    profile: LearnerModelProfile;
    confidence: number;
    sources: ProfileFieldSources;
  }> {
    const cached = this.cache.get(userId);
    if (cached && Date.now() - cached.timestamp < this.cacheTtlMs) {
      return { profile: cached.profile, confidence: cached.confidence, sources: cached.sources };
    }

    const result = await profileAggregator.aggregateProfile(userId);
    this.cache.set(userId, {
      profile: result.profile,
      confidence: result.confidence,
      sources: result.sources,
      timestamp: Date.now()
    });
    return { profile: result.profile, confidence: result.confidence, sources: result.sources };
  }

  clear(userId?: string): void {
    if (userId) this.cache.delete(userId);
    else this.cache.clear();
  }
}

export const learnerProfileService = new LearnerProfileService();

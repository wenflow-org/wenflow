/**
 * User Profile Agent 测试
 */

import { profileAggregator } from '../profile-aggregator';
import { personalizationEngine } from '../personalization';
import { UnifiedUserProfile } from '../types';

const mockProfile: UnifiedUserProfile = {
  userId: 'test-user',
  lastUpdated: new Date().toISOString(),
  
  cognitive: {
    metacognitionLevel: 'high',
    thinkingStyle: 'logical',
    confusionPattern: 'none',
    priorKnowledgeStructure: 'systematic',
    selfAssessmentAccuracy: 'accurate'
  },
  
  behavioral: {
    avgResponseTime: 15,
    avgMessageLength: 80,
    avgInteractionInterval: 8,
    engagementLevel: 0.7,
    consistencyScore: 0.8
  },
  
  learning: {
    ktl: 45,
    lf: 25,
    lss: 30,
    masteryByTopic: {},
    recentProgress: 'improving',
    streak: 5
  },
  
  preferences: {
    preferredStyle: 'practice',
    theoryVsPractice: 'practice-first',
    sessionLength: 'medium',
    preferredDifficulty: 'medium',
    prefersHints: true
  },
  
  emotional: {
    motivationTrigger: 'problem-solving',
    urgencyLevel: 'medium',
    confidenceLevel: 'confident',
    frustrationTolerance: 0.6,
    rewardSensitivity: 'medium'
  },
  
  history: {
    totalSessions: 10,
    totalMessages: 150,
    avgSessionDuration: 25,
    topicsExplored: ['Python', 'Data Analysis'],
    conceptsStruggled: [],
    conceptsMastered: ['Variables', 'Functions']
  },
  
  derivedInsights: {
    learningVelocity: 0.6,
    optimalSessionLength: 30,
    recommendedDifficulty: 'medium',
    suggestedApproach: '继续实践导向学习',
    riskFactors: [],
    strengths: ['元认知能力强', '学习习惯稳定']
  }
};

describe('Profile Aggregator', () => {
  describe('aggregateProfile', () => {
    it('should aggregate profile from multiple sources', async () => {
      const result = await profileAggregator.aggregateProfile('test-user');
      
      expect(result).toHaveProperty('profile');
      expect(result).toHaveProperty('changes');
      expect(result).toHaveProperty('confidence');
      expect(result.profile).toHaveProperty('cognitive');
      expect(result.profile).toHaveProperty('behavioral');
      expect(result.profile).toHaveProperty('learning');
      expect(result.profile).toHaveProperty('preferences');
      expect(result.profile).toHaveProperty('emotional');
      expect(result.profile).toHaveProperty('derivedInsights');
    });
  });
});

describe('Personalization Engine', () => {
  describe('generateConfig', () => {
    it('should generate personalization config from profile', () => {
      const config = personalizationEngine.generateConfig(mockProfile);
      
      expect(config).toHaveProperty('contentStyle');
      expect(config).toHaveProperty('pacing');
      expect(config).toHaveProperty('interaction');
      expect(config).toHaveProperty('pathAdjustment');
      
      expect(config.contentStyle).toHaveProperty('useAnalogies');
      expect(config.contentStyle).toHaveProperty('detailLevel');
      expect(config.contentStyle).toHaveProperty('exampleFrequency');
      
      expect(config.pacing).toHaveProperty('initialDifficulty');
      expect(config.pacing).toHaveProperty('difficultyProgression');
      
      expect(config.interaction).toHaveProperty('hintTiming');
      expect(config.interaction).toHaveProperty('encouragementFrequency');
    });
    
    it('should adjust for visual thinkers', () => {
      const visualProfile = {
        ...mockProfile,
        cognitive: {
          ...mockProfile.cognitive,
          thinkingStyle: 'visual' as const
        }
      };
      
      const config = personalizationEngine.generateConfig(visualProfile);
      
      expect(config.contentStyle.useAnalogies).toBe(true);
    });
    
    it('should adjust for low metacognition', () => {
      const lowMetaProfile = {
        ...mockProfile,
        cognitive: {
          ...mockProfile.cognitive,
          metacognitionLevel: 'low' as const
        }
      };
      
      const config = personalizationEngine.generateConfig(lowMetaProfile);
      
      expect(config.contentStyle.detailLevel).toBe('detailed');
      expect(config.interaction.hintTiming).toBe('immediate');
    });
    
    it('should adjust for anxious learners', () => {
      const anxiousProfile = {
        ...mockProfile,
        emotional: {
          ...mockProfile.emotional,
          confidenceLevel: 'anxious' as const
        }
      };
      
      const config = personalizationEngine.generateConfig(anxiousProfile);
      
      expect(config.interaction.encouragementFrequency).toBe('high');
      expect(config.interaction.challengeFrequency).toBe('low');
    });
  });
  
  describe('generatePromptEnhancement', () => {
    it('should generate prompt enhancement string', () => {
      const enhancement = personalizationEngine.generatePromptEnhancement(mockProfile);
      
      expect(typeof enhancement).toBe('string');
      expect(enhancement.length).toBeGreaterThan(0);
    });
    
    it('should include visual preference for visual thinkers', () => {
      const visualProfile = {
        ...mockProfile,
        cognitive: {
          ...mockProfile.cognitive,
          thinkingStyle: 'visual' as const
        }
      };
      
      const enhancement = personalizationEngine.generatePromptEnhancement(visualProfile);
      
      expect(enhancement).toContain('可视化');
    });
  });
  
  describe('generateContentHints', () => {
    it('should generate content hints', () => {
      const hints = personalizationEngine.generateContentHints(mockProfile);
      
      expect(hints).toHaveProperty('preferredFormats');
      expect(hints).toHaveProperty('avoidFormats');
      expect(hints).toHaveProperty('emphasisAreas');
      
      expect(Array.isArray(hints.preferredFormats)).toBe(true);
      expect(Array.isArray(hints.avoidFormats)).toBe(true);
      expect(Array.isArray(hints.emphasisAreas)).toBe(true);
    });
    
    it('should suggest practice formats for practice-first learners', () => {
      const practiceProfile = {
        ...mockProfile,
        preferences: {
          ...mockProfile.preferences,
          preferredStyle: 'practice' as const
        }
      };
      
      const hints = personalizationEngine.generateContentHints(practiceProfile);
      
      expect(hints.preferredFormats).toContain('代码练习');
    });
  });
});
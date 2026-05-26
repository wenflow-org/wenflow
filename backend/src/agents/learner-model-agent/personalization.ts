/**
 * 个性化参数生成器
 * 
 * 基于学习者模型生成其他Agent可用的个性化配置
 */

import {
  LearnerModelProfile,
  LearnerPersonalizationConfig
} from './types';

export class PersonalizationEngine {
  
  generateConfig(profile: LearnerModelProfile): LearnerPersonalizationConfig {
    return {
      contentStyle: this.generateContentStyle(profile),
      pacing: this.generatePacing(profile),
      interaction: this.generateInteraction(profile),
      pathAdjustment: this.generatePathAdjustment(profile)
    };
  }
  
  private generateContentStyle(profile: LearnerModelProfile): LearnerPersonalizationConfig['contentStyle'] {
    const { cognitive, preferences, narrativeInsights } = profile;
    
    const useAnalogies = cognitive.thinkingStyle === 'intuitive' || 
                         cognitive.thinkingStyle === 'visual' ||
                         cognitive.priorKnowledgeStructure === 'blank';
    
    let detailLevel: 'concise' | 'moderate' | 'detailed' = 'moderate';
    if (cognitive.metacognitionLevel === 'high' && cognitive.priorKnowledgeStructure === 'systematic') {
      detailLevel = 'concise';
    } else if (cognitive.metacognitionLevel === 'low' || cognitive.confusionPattern !== 'none') {
      detailLevel = 'detailed';
    }
    
    let exampleFrequency: 'minimal' | 'moderate' | 'frequent' = 'moderate';
    if (cognitive.thinkingStyle === 'practical' || cognitive.confusionPattern === 'application-difficulty') {
      exampleFrequency = 'frequent';
    } else if (cognitive.metacognitionLevel === 'high' && cognitive.priorKnowledgeStructure === 'systematic') {
      exampleFrequency = 'minimal';
    }
    if (narrativeInsights.practicePreferenceNote.includes('边学边做') || narrativeInsights.effectiveTeachingPattern.includes('立刻做一个小验证')) {
      exampleFrequency = 'frequent';
    }
    
    let codeCommentDetail: 'minimal' | 'moderate' | 'extensive' = 'moderate';
    if (cognitive.metacognitionLevel === 'low' || cognitive.confusionPattern === 'principle-misunderstanding') {
      codeCommentDetail = 'extensive';
    }
    
    return {
      useAnalogies,
      detailLevel,
      exampleFrequency,
      codeCommentDetail
    };
  }
  
  private generatePacing(profile: LearnerModelProfile): LearnerPersonalizationConfig['pacing'] {
    const { learning, cognitive, derivedInsights, curriculumControls } = profile;
    
    const initialDifficulty: 'easy' | 'medium' | 'hard' = derivedInsights.recommendedDifficulty;
    
    let difficultyProgression: 'slow' | 'moderate' | 'fast' = 'moderate';
    if (learning.recentProgress === 'improving' && cognitive.metacognitionLevel === 'high') {
      difficultyProgression = 'fast';
    } else if (learning.lf > 5 || cognitive.metacognitionLevel === 'low') {
      difficultyProgression = 'slow';
    }
    
    const breakFrequency = learning.lf > 5 ? 2 : 
                           learning.lf > 3 ? 3 : 4;
    
    let reviewFrequency: 'minimal' | 'moderate' | 'frequent' = 'moderate';
    if (cognitive.confusionPattern !== 'none' || cognitive.priorKnowledgeStructure === 'scattered') {
      reviewFrequency = 'frequent';
    } else if (cognitive.metacognitionLevel === 'high' && learning.ktl > 5) {
      reviewFrequency = 'minimal';
    }
    if (curriculumControls.reviewFrequencyLevel === 'high') {
      reviewFrequency = 'frequent';
    }
    
    return {
      initialDifficulty,
      difficultyProgression,
      breakFrequency,
      reviewFrequency
    };
  }
  
  private generateInteraction(profile: LearnerModelProfile): LearnerPersonalizationConfig['interaction'] {
    const { cognitive, emotional, learning, narrativeInsights } = profile;
    
    let hintTiming: 'immediate' | 'delayed' | 'on-request' = 'delayed';
    if (cognitive.metacognitionLevel === 'low' || emotional.confidenceLevel === 'anxious') {
      hintTiming = 'immediate';
    } else if (cognitive.metacognitionLevel === 'high') {
      hintTiming = 'on-request';
    }
    
    let encouragementFrequency: 'low' | 'medium' | 'high' = 'medium';
    if (emotional.confidenceLevel === 'anxious' || emotional.rewardSensitivity === 'high') {
      encouragementFrequency = 'high';
    } else if (emotional.confidenceLevel === 'confident' && emotional.rewardSensitivity === 'low') {
      encouragementFrequency = 'low';
    }
    
    let challengeFrequency: 'low' | 'medium' | 'high' = 'medium';
    if (learning.recentProgress === 'improving' && cognitive.metacognitionLevel === 'high') {
      challengeFrequency = 'high';
    } else if (emotional.confidenceLevel === 'anxious' || learning.lf > 5) {
      challengeFrequency = 'low';
    }
    if (narrativeInsights.supportStyleNote.includes('避免连续追问')) {
      challengeFrequency = 'low';
    }
    
    return {
      hintTiming,
      encouragementFrequency,
      challengeFrequency
    };
  }
  
  private generatePathAdjustment(profile: LearnerModelProfile): LearnerPersonalizationConfig['pathAdjustment'] {
    const { learning, behavioral, cognitive, curriculumControls } = profile;
    
    let compressionThreshold = 0.7;
    if (cognitive.metacognitionLevel === 'high' && learning.ktl > 5) {
      compressionThreshold = 0.6;
    }
    
    let extensionThreshold = 0.4;
    if (cognitive.metacognitionLevel === 'low' || learning.lf > 4) {
      extensionThreshold = 0.5;
    }
    
    let skipMasteryLevel = 0.8;
    if (learning.recentProgress === 'improving') {
      skipMasteryLevel = 0.75;
    }
    
    if (behavioral.consistencyScore < 0.4) {
      extensionThreshold = Math.min(0.6, extensionThreshold + 0.1);
    }
    if (curriculumControls.taskGranularityLevel === 'small') {
      extensionThreshold = Math.min(0.65, extensionThreshold + 0.1);
      compressionThreshold = Math.max(0.65, compressionThreshold);
    }
    
    return {
      compressionThreshold,
      extensionThreshold,
      skipMasteryLevel
    };
  }
  
  generatePromptEnhancement(profile: LearnerModelProfile): string {
    const parts: string[] = [];
    
    const { cognitive, preferences, emotional, derivedInsights, narrativeInsights, curriculumControls } = profile;
    
    if (cognitive.thinkingStyle === 'visual') {
      parts.push('学习者偏好可视化内容，请多使用图表、流程图说明');
    }
    if (cognitive.thinkingStyle === 'practical') {
      parts.push('学习者偏好实践，请先给出示例再解释原理');
    }
    if (cognitive.metacognitionLevel === 'low') {
      parts.push('学习者元认知能力较弱，请给出明确的学习步骤');
    }
    if (emotional.confidenceLevel === 'anxious') {
      parts.push('学习者自信心不足，请多给予正向反馈和鼓励');
    }
    if (preferences.theoryVsPractice === 'practice-first') {
      parts.push('学习者偏好"先练后讲"，请先安排动手任务');
    }
    if (narrativeInsights.contentReceptionPattern) {
      parts.push(`内容接受方式：${narrativeInsights.contentReceptionPattern}`);
    }
    if (narrativeInsights.frictionPatternNote) {
      parts.push(`认知摩擦：${narrativeInsights.frictionPatternNote}`);
    }
    if (narrativeInsights.supportStyleNote) {
      parts.push(`支持方式：${narrativeInsights.supportStyleNote}`);
    }
    if (curriculumControls.progressionStrategyNote) {
      parts.push(`课程推进建议：${curriculumControls.progressionStrategyNote}`);
    }
    if (derivedInsights.riskFactors.length > 0) {
      parts.push(`注意风险：${derivedInsights.riskFactors.join('；')}`);
    }
    
    return parts.length > 0 ? `\n\n【个性化要求】\n${parts.join('。\n')}` : '';
  }
  
  generateContentHints(profile: LearnerModelProfile): {
    preferredFormats: string[];
    avoidFormats: string[];
    emphasisAreas: string[];
  } {
    const preferredFormats: string[] = [];
    const avoidFormats: string[] = [];
    const emphasisAreas: string[] = [];
    
    const { cognitive, preferences, narrativeInsights } = profile;
    
    switch (preferences.preferredStyle) {
      case 'video':
        preferredFormats.push('视频教程', '动画演示');
        avoidFormats.push('长篇文字');
        break;
      case 'reading':
        preferredFormats.push('文章', '文档');
        break;
      case 'practice':
        preferredFormats.push('代码练习', '项目实战');
        avoidFormats.push('纯理论讲解');
        break;
      case 'mixed':
      default:
        preferredFormats.push('图文结合', '交互式教程');
    }
    
    if (cognitive.confusionPattern === 'application-difficulty') {
      emphasisAreas.push('实际应用案例');
    }
    if (cognitive.confusionPattern === 'concept-confusion') {
      emphasisAreas.push('概念对比辨析');
    }
    if (cognitive.priorKnowledgeStructure === 'scattered') {
      emphasisAreas.push('知识体系梳理');
    }
    if (narrativeInsights.practicePreferenceNote.includes('边学边做')) {
      emphasisAreas.push('讲解后立刻验证');
    }
    
    return { preferredFormats, avoidFormats, emphasisAreas };
  }
}

export const personalizationEngine = new PersonalizationEngine();

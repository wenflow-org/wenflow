/**
 * 个性化参数生成器
 * 
 * 基于学习者模型生成其他Agent可用的个性化配置
 */

import {
  LearnerModelProfile,
  LearnerPersonalizationConfig
} from './types';
import { classifyLoad } from '../../services/learning/learning-load-verdict';

export class PersonalizationEngine {
  
  generateConfig(profile: LearnerModelProfile): LearnerPersonalizationConfig {
    /* 2026-11-09 画像链路核查：contentStyle / pacing / pathAdjustment 三段全仓零消费，
       且阈值与快照的 ACWR 口径冲突，已从契约删除。这里只保留真正被
       LearnerSnapshotService 搬进 dynamicState.recommendedInteraction 的三项。 */
    return {
      interaction: this.generateInteraction(profile)
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
    // 口径统一（收尾 2026-11-09）：原为绝对阈值 `learning.lf > 5`，与 fatigueRisk 的 ACWR 判据冲突。
    } else if (emotional.confidenceLevel === 'anxious' || classifyLoad(learning).fatigueRisk !== 'low') {
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
